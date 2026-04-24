const crypto = require('crypto');
const { withConversationAccess, ConversationAccessDeniedError } = require('../../db/conversation');
const { anonymizeAiAnalysis } = require('./anonymize');
const { extractPdfText, checkPii } = require('./pii');
const { uploadFile, getSignedDownloadUrl } = require('../../storage/s3');

const ADMIN_ONLY = async function (request, reply) {
  if (request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Chat entre tenants é restrito a admins.' });
  }
};

function mapAccessDenied(err, reply) {
  if (err instanceof ConversationAccessDeniedError) {
    return reply.status(403).send({ error: 'Sem acesso a esta conversa.' });
  }
  throw err;
}

module.exports = async function (fastify) {
  // GET /conversations/:id/messages?before=&limit=
  fastify.get('/conversations/:id/messages', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const before = request.query?.before || null;
    const limit = Math.min(100, Math.max(1, parseInt(request.query?.limit) || 50));

    try {
      const rows = await withConversationAccess(fastify.pg, id, tenant_id, async (client) => {
        const { rows: r } = await client.query(
          `SELECT m.id, m.conversation_id, m.sender_tenant_id, m.sender_user_id, m.body,
                  m.has_attachment, m.created_at,
                  COALESCE(
                    (SELECT jsonb_agg(jsonb_build_object(
                      'id', a.id, 'kind', a.kind, 'payload', a.payload,
                      'original_size_bytes', a.original_size_bytes, 'created_at', a.created_at
                    ))
                     FROM tenant_message_attachments a WHERE a.message_id = m.id),
                    '[]'::jsonb
                  ) AS attachments,
                  COALESCE(
                    (SELECT jsonb_agg(jsonb_build_object(
                      'emoji', r.emoji, 'count', r.n,
                      'reacted_by_me', EXISTS(
                        SELECT 1 FROM tenant_message_reactions r2
                        WHERE r2.message_id = m.id AND r2.emoji = r.emoji AND r2.reactor_tenant_id = $4
                      )
                    ))
                     FROM (
                       SELECT emoji, count(*)::int AS n
                       FROM tenant_message_reactions
                       WHERE message_id = m.id
                       GROUP BY emoji
                     ) r),
                    '[]'::jsonb
                  ) AS reactions
           FROM tenant_messages m
           WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
             AND ($2::timestamptz IS NULL OR m.created_at < $2)
           ORDER BY m.created_at DESC
           LIMIT $3`,
          [id, before, limit, tenant_id]
        );
        return r;
      });
      return { results: rows };
    } catch (err) { return mapAccessDenied(err, reply); }
  });

  // ══════════════════════════════════════════════════════════════════════
  // Reactions
  // ══════════════════════════════════════════════════════════════════════
  const ALLOWED_EMOJIS = ['👍', '❤️', '🤔', '✅', '🚨', '📌'];

  // POST /messages/:messageId/reactions — toggle
  fastify.post('/messages/:messageId/reactions', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { messageId } = request.params;
    const { emoji } = request.body || {};

    if (!emoji || typeof emoji !== 'string' || !ALLOWED_EMOJIS.includes(emoji)) {
      return reply.status(400).send({
        error: 'Emoji inválido. Permitidos: ' + ALLOWED_EMOJIS.join(' '),
        allowed: ALLOWED_EMOJIS,
      });
    }

    // Descobre a conversa via message pra reutilizar withConversationAccess
    const { rows: msgRows } = await fastify.pg.query(
      `SELECT m.id, m.conversation_id, c.tenant_a_id, c.tenant_b_id
       FROM tenant_messages m
       JOIN tenant_conversations c ON c.id = m.conversation_id
       WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [messageId]
    );
    if (msgRows.length === 0) return reply.status(404).send({ error: 'Mensagem não encontrada.' });
    const { conversation_id, tenant_a_id, tenant_b_id } = msgRows[0];
    if (tenant_a_id !== tenant_id && tenant_b_id !== tenant_id) {
      return reply.status(403).send({ error: 'Sem acesso a esta conversa.' });
    }

    try {
      const result = await withConversationAccess(fastify.pg, conversation_id, tenant_id, async (client, conv) => {
        // toggle: se existe, remove; se não, insere
        const { rowCount: deletedCount } = await client.query(
          `DELETE FROM tenant_message_reactions
           WHERE message_id = $1 AND reactor_user_id = $2 AND emoji = $3`,
          [messageId, user_id, emoji]
        );
        let action;
        if (deletedCount > 0) {
          action = 'removed';
        } else {
          await client.query(
            `INSERT INTO tenant_message_reactions (message_id, reactor_tenant_id, reactor_user_id, emoji)
             VALUES ($1, $2, $3, $4)`,
            [messageId, tenant_id, user_id, emoji]
          );
          action = 'added';
        }
        // recount
        const { rows: cRows } = await client.query(
          `SELECT count(*)::int AS n FROM tenant_message_reactions
           WHERE message_id = $1 AND emoji = $2`,
          [messageId, emoji]
        );
        const counterpart = conv.tenant_a_id === tenant_id ? conv.tenant_b_id : conv.tenant_a_id;
        return { action, count: cRows[0].n, counterpart };
      });

      // Notifica counterpart via WS (best-effort)
      try {
        if (fastify.notifyTenant) {
          fastify.notifyTenant(result.counterpart, {
            event: 'chat:reaction_changed',
            conversation_id,
            message_id: messageId,
            emoji,
            count: result.count,
            action: result.action,
          });
        }
      } catch (_) {}

      return { action: result.action, emoji, count: result.count };
    } catch (err) { return mapAccessDenied(err, reply); }
  });

  // POST /conversations/:id/messages — rate limit 200/dia
  fastify.post('/conversations/:id/messages', {
    preHandler: [fastify.authenticate, ADMIN_ONLY],
    config: { rateLimit: {
      max: 200, timeWindow: '24 hours',
      keyGenerator: (req) => `msg:${req.user?.tenant_id || req.ip}`,
    } }
  }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;
    const { body, ai_analysis_card, pdf, image } = request.body || {};

    const bodyTrim = typeof body === 'string' ? body.trim() : '';

    if (!bodyTrim && !ai_analysis_card && !pdf && !image) {
      return reply.status(400).send({ error: 'body ou attachment obrigatório' });
    }
    if (bodyTrim.length > 5000) {
      return reply.status(400).send({ error: 'body muito longo (max 5000 chars)' });
    }

    if (ai_analysis_card) {
      const { exam_id, agent_types } = ai_analysis_card;
      if (!exam_id || typeof exam_id !== 'string') {
        return reply.status(400).send({ error: 'ai_analysis_card.exam_id obrigatório' });
      }
      if (!Array.isArray(agent_types) || agent_types.length === 0) {
        return reply.status(400).send({ error: 'ai_analysis_card.agent_types deve ser array não-vazio' });
      }
    }

    if (pdf) {
      if (typeof pdf !== 'object') return reply.status(400).send({ error: 'pdf inválido' });
      if (!pdf.filename || typeof pdf.filename !== 'string') return reply.status(400).send({ error: 'pdf.filename obrigatório' });
      if (!pdf.data_base64 || typeof pdf.data_base64 !== 'string') return reply.status(400).send({ error: 'pdf.data_base64 obrigatório' });
      if (pdf.mime_type && pdf.mime_type !== 'application/pdf') {
        return reply.status(400).send({ error: 'somente PDF suportado nesta fase' });
      }
    }

    if (image) {
      if (typeof image !== 'object') return reply.status(400).send({ error: 'image inválida' });
      if (!image.filename || typeof image.filename !== 'string') return reply.status(400).send({ error: 'image.filename obrigatório' });
      if (!image.data_base64 || typeof image.data_base64 !== 'string') return reply.status(400).send({ error: 'image.data_base64 obrigatório' });
      if (!['image/png', 'image/jpeg'].includes(image.mime_type)) {
        return reply.status(400).send({ error: 'image.mime_type deve ser image/png ou image/jpeg' });
      }
      if (image.user_confirmed_anonymized !== true) {
        return reply.status(400).send({
          error: 'Confirmação obrigatória: user_confirmed_anonymized deve ser true.',
          hint: 'Usuário deve confirmar explicitamente que removeu dados pessoais da imagem.'
        });
      }
    }

    // Processa o PDF ANTES da transação — PII check + upload S3 são operações
    // caras e não devem acontecer dentro da tx. Se falhar, nada muda no banco.
    let pdfStaged = null;
    if (pdf) {
      let buffer;
      try {
        buffer = Buffer.from(pdf.data_base64, 'base64');
      } catch (_) {
        return reply.status(400).send({ error: 'pdf.data_base64 inválido' });
      }
      if (buffer.length === 0) return reply.status(400).send({ error: 'pdf vazio' });
      if (buffer.length > 10 * 1024 * 1024) return reply.status(400).send({ error: 'PDF excede 10MB' });

      const text = await extractPdfText(buffer);
      const piiResult = await checkPii(text);

      if (piiResult.has_pii) {
        return reply.status(400).send({
          error: 'PDF contém dados pessoais — remova antes de anexar.',
          detected_kinds: piiResult.detected_kinds,
          region_count: piiResult.region_count,
        });
      }

      // Upload S3 (fora da tx)
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const safeFilename = pdf.filename.replace(/[^\w.-]/g, '_').slice(0, 100);
      const s3key = `inter-tenant-chat/${id}/${Date.now()}-${hash.slice(0, 8)}-${safeFilename}`;
      try {
        await uploadFile(s3key, buffer, 'application/pdf');
      } catch (err) {
        request.log?.error({ err }, 'S3 upload failed');
        return reply.status(503).send({ error: 'Falha no upload do PDF. Tente novamente.' });
      }

      pdfStaged = {
        s3_key: s3key,
        filename: pdf.filename,
        size_bytes: buffer.length,
        hash,
        pii_result: piiResult,
      };
    }

    // Processa imagem (sem OCR nesta fase — user_confirmed_anonymized é obrigatório)
    let imageStaged = null;
    if (image) {
      let buffer;
      try {
        buffer = Buffer.from(image.data_base64, 'base64');
      } catch (_) {
        return reply.status(400).send({ error: 'image.data_base64 inválido' });
      }
      if (buffer.length === 0) return reply.status(400).send({ error: 'imagem vazia' });
      if (buffer.length > 10 * 1024 * 1024) return reply.status(400).send({ error: 'Imagem excede 10MB' });

      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const ext = image.mime_type === 'image/png' ? 'png' : 'jpg';
      const safeFilename = image.filename.replace(/[^\w.-]/g, '_').slice(0, 100);
      const s3key = `inter-tenant-chat/${id}/${Date.now()}-${hash.slice(0, 8)}-${safeFilename}`;
      try {
        await uploadFile(s3key, buffer, image.mime_type);
      } catch (err) {
        request.log?.error({ err }, 'S3 upload image failed');
        return reply.status(503).send({ error: 'Falha no upload da imagem. Tente novamente.' });
      }

      imageStaged = {
        s3_key: s3key,
        filename: image.filename,
        mime_type: image.mime_type,
        size_bytes: buffer.length,
        hash,
      };
    }

    try {
      const result = await withConversationAccess(fastify.pg, id, tenant_id, async (client, conv) => {
        // 1. prepara payload do attachment se houver
        let attachmentPayload = null;
        if (ai_analysis_card) {
          const { exam_id, agent_types } = ai_analysis_card;

          const { rows: examRows } = await client.query(
            `SELECT id, tenant_id, subject_id, created_at, status
             FROM exams
             WHERE id = $1 AND tenant_id = $2 AND status = 'done'`,
            [exam_id, tenant_id]
          );
          if (examRows.length === 0) {
            const e = new Error('exam_not_found'); e.code = 'EXAM_NOT_FOUND'; throw e;
          }
          const exam = examRows[0];

          const { rows: subjectRows } = await client.query(
            `SELECT id, tenant_id, subject_type, birth_date, sex, species, breed, weight
             FROM subjects
             WHERE id = $1 AND tenant_id = $2`,
            [exam.subject_id, tenant_id]
          );
          if (subjectRows.length === 0) {
            const e = new Error('subject_not_found'); e.code = 'SUBJECT_NOT_FOUND'; throw e;
          }
          const subject = subjectRows[0];

          const { rows: resultRows } = await client.query(
            `SELECT agent_type, interpretation, risk_scores, alerts, recommendations
             FROM clinical_results
             WHERE exam_id = $1 AND tenant_id = $2 AND agent_type = ANY($3)`,
            [exam.id, tenant_id, agent_types]
          );
          if (resultRows.length === 0) {
            const e = new Error('no_results_for_agents'); e.code = 'NO_RESULTS'; throw e;
          }

          attachmentPayload = anonymizeAiAnalysis({ exam, subject, results: resultRows });
        }

        // 2. insere mensagem (body pode ser '' se só anexo)
        const hasAttachment = !!attachmentPayload || !!pdfStaged || !!imageStaged;
        const { rows: msgRows } = await client.query(
          `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body, has_attachment)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, conversation_id, sender_tenant_id, sender_user_id, body, has_attachment, created_at`,
          [id, tenant_id, user_id, bodyTrim, hasAttachment]
        );
        const msg = msgRows[0];

        const attachments = [];
        if (attachmentPayload) {
          const { rows: attRows } = await client.query(
            `INSERT INTO tenant_message_attachments (message_id, kind, payload)
             VALUES ($1, 'ai_analysis_card', $2)
             RETURNING id, kind, payload, created_at`,
            [msg.id, JSON.stringify(attachmentPayload)]
          );
          attachments.push(attRows[0]);
        }
        if (pdfStaged) {
          const { rows: pdfRows } = await client.query(
            `INSERT INTO tenant_message_attachments
              (message_id, kind, s3_key, payload, original_size_bytes, redacted_hash)
             VALUES ($1, 'pdf', $2, $3::jsonb, $4, $5)
             RETURNING id, kind, s3_key, payload, original_size_bytes, created_at`,
            [msg.id, pdfStaged.s3_key, JSON.stringify({ filename: pdfStaged.filename }),
             pdfStaged.size_bytes, pdfStaged.hash]
          );
          attachments.push(pdfRows[0]);

          // Audit PII check (status=clean porque chegamos aqui)
          await client.query(
            `INSERT INTO tenant_message_pii_checks (attachment_id, detected_kinds, region_count, status, confirmed_by_user_id)
             VALUES ($1, $2, $3, 'clean', $4)`,
            [pdfRows[0].id, pdfStaged.pii_result.detected_kinds, pdfStaged.pii_result.region_count, user_id]
          );
        }

        if (imageStaged) {
          const { rows: imgRows } = await client.query(
            `INSERT INTO tenant_message_attachments
              (message_id, kind, s3_key, payload, original_size_bytes, redacted_hash)
             VALUES ($1, 'image', $2, $3::jsonb, $4, $5)
             RETURNING id, kind, s3_key, payload, original_size_bytes, created_at`,
            [msg.id, imageStaged.s3_key,
             JSON.stringify({ filename: imageStaged.filename, mime_type: imageStaged.mime_type }),
             imageStaged.size_bytes, imageStaged.hash]
          );
          attachments.push(imgRows[0]);

          // Audit: usuário confirmou manualmente (sem OCR/análise automática nesta fase)
          // status='clean' com marker 'user_manual_confirm' em detected_kinds pra distinguir
          // de PDFs que passaram pela análise automática.
          await client.query(
            `INSERT INTO tenant_message_pii_checks (attachment_id, detected_kinds, region_count, status, confirmed_by_user_id)
             VALUES ($1, $2, 0, 'clean', $3)`,
            [imgRows[0].id, ['user_manual_confirm'], user_id]
          );
        }

        await client.query(
          `UPDATE tenant_conversations SET last_message_at = NOW() WHERE id = $1`,
          [id]
        );
        const counterpart = conv.tenant_a_id === tenant_id ? conv.tenant_b_id : conv.tenant_a_id;
        return { msg, attachments, counterpart };
      });

      // Notifica counterpart via WS (best-effort)
      try {
        if (fastify.notifyTenant) {
          const attachmentTypes = (result.attachments || []).map(a => a.kind);
          let preview;
          if (result.msg.body) {
            preview = result.msg.body.length > 120 ? result.msg.body.slice(0, 120) + '…' : result.msg.body;
          } else if (attachmentTypes.includes('pdf')) {
            preview = '[PDF anexado]';
          } else if (attachmentTypes.includes('image')) {
            preview = '[imagem anexada]';
          } else if (attachmentTypes.includes('ai_analysis_card')) {
            preview = '[análise IA anexada]';
          } else {
            preview = '';
          }
          fastify.notifyTenant(result.counterpart, {
            event: 'chat:message_received',
            conversation_id: id,
            message_id: result.msg.id,
            sender_tenant_id: tenant_id,
            body_preview: preview,
            created_at: result.msg.created_at,
          });
          fastify.notifyTenant(result.counterpart, {
            event: 'chat:unread_change',
            conversation_id: id,
            delta: 1,
          });
        }
      } catch (_) {}

      return reply.status(201).send({
        ...result.msg,
        attachments: result.attachments || [],
      });
    } catch (err) {
      if (err instanceof ConversationAccessDeniedError) return mapAccessDenied(err, reply);
      if (err.code === 'EXAM_NOT_FOUND') return reply.status(404).send({ error: 'Exame não encontrado ou não está finalizado.' });
      if (err.code === 'SUBJECT_NOT_FOUND') return reply.status(404).send({ error: 'Paciente do exame não encontrado.' });
      if (err.code === 'NO_RESULTS') return reply.status(400).send({ error: 'Nenhum resultado de análise IA para os agent_types selecionados.' });
      throw err;
    }
  });

  // GET /attachments/:id/url — signed download URL (1h TTL)
  fastify.get('/attachments/:id/url', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `SELECT a.s3_key, a.kind
       FROM tenant_message_attachments a
       JOIN tenant_messages m ON m.id = a.message_id
       JOIN tenant_conversations c ON c.id = m.conversation_id
       WHERE a.id = $1
         AND a.s3_key IS NOT NULL
         AND (c.tenant_a_id = $2 OR c.tenant_b_id = $2)`,
      [id, tenant_id]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Anexo não encontrado.' });
    try {
      const url = await getSignedDownloadUrl(rows[0].s3_key, 3600);
      return { url, expires_in: 3600 };
    } catch (err) {
      request.log?.error({ err }, 'signed url failed');
      return reply.status(503).send({ error: 'Falha ao gerar URL de download.' });
    }
  });

  // GET /conversations/:id/search?q=
  fastify.get('/conversations/:id/search', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const q = request.query?.q;

    if (!q || typeof q !== 'string' || !q.trim()) {
      return reply.status(400).send({ error: 'q é obrigatório' });
    }

    try {
      const rows = await withConversationAccess(fastify.pg, id, tenant_id, async (client) => {
        const { rows: r } = await client.query(
          `SELECT id, sender_tenant_id, body, created_at,
                  ts_headline('portuguese', body, plainto_tsquery('portuguese', $2),
                              'StartSel=<mark>, StopSel=</mark>, MaxWords=20, MinWords=5') AS snippet
           FROM tenant_messages
           WHERE conversation_id = $1 AND deleted_at IS NULL
             AND body_tsv @@ plainto_tsquery('portuguese', $2)
           ORDER BY created_at DESC
           LIMIT 50`,
          [id, q.trim()]
        );
        return r;
      });
      return { results: rows };
    } catch (err) { return mapAccessDenied(err, reply); }
  });
};
