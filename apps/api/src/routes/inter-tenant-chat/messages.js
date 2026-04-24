const { withConversationAccess, ConversationAccessDeniedError } = require('../../db/conversation');
const { anonymizeAiAnalysis } = require('./anonymize');

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
                      'id', a.id, 'kind', a.kind, 'payload', a.payload, 'created_at', a.created_at
                    ))
                     FROM tenant_message_attachments a WHERE a.message_id = m.id),
                    '[]'::jsonb
                  ) AS attachments
           FROM tenant_messages m
           WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
             AND ($2::timestamptz IS NULL OR m.created_at < $2)
           ORDER BY m.created_at DESC
           LIMIT $3`,
          [id, before, limit]
        );
        return r;
      });
      return { results: rows };
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
    const { body, ai_analysis_card } = request.body || {};

    const bodyTrim = typeof body === 'string' ? body.trim() : '';

    // precisa de body OU anexo
    if (!bodyTrim && !ai_analysis_card) {
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
        const { rows: msgRows } = await client.query(
          `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body, has_attachment)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, conversation_id, sender_tenant_id, sender_user_id, body, has_attachment, created_at`,
          [id, tenant_id, user_id, bodyTrim, !!attachmentPayload]
        );
        const msg = msgRows[0];

        let attachment = null;
        if (attachmentPayload) {
          const { rows: attRows } = await client.query(
            `INSERT INTO tenant_message_attachments (message_id, kind, payload)
             VALUES ($1, 'ai_analysis_card', $2)
             RETURNING id, kind, payload, created_at`,
            [msg.id, JSON.stringify(attachmentPayload)]
          );
          attachment = attRows[0];
        }

        await client.query(
          `UPDATE tenant_conversations SET last_message_at = NOW() WHERE id = $1`,
          [id]
        );
        const counterpart = conv.tenant_a_id === tenant_id ? conv.tenant_b_id : conv.tenant_a_id;
        return { msg, attachment, counterpart };
      });

      // Notifica counterpart via WS (best-effort)
      try {
        if (fastify.notifyTenant) {
          const preview = result.msg.body
            ? (result.msg.body.length > 120 ? result.msg.body.slice(0, 120) + '…' : result.msg.body)
            : (result.attachment ? '[análise IA anexada]' : '');
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
        attachments: result.attachment ? [result.attachment] : [],
      });
    } catch (err) {
      if (err instanceof ConversationAccessDeniedError) return mapAccessDenied(err, reply);
      if (err.code === 'EXAM_NOT_FOUND') return reply.status(404).send({ error: 'Exame não encontrado ou não está finalizado.' });
      if (err.code === 'SUBJECT_NOT_FOUND') return reply.status(404).send({ error: 'Paciente do exame não encontrado.' });
      if (err.code === 'NO_RESULTS') return reply.status(400).send({ error: 'Nenhum resultado de análise IA para os agent_types selecionados.' });
      throw err;
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
