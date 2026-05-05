'use strict';

/**
 * NPS — pesquisa de satisfação pós-encontro.
 *
 * Endpoints:
 *   POST /nps/send                        admin-only — agenda envio (cria token + envia email)
 *   GET  /nps/responses?period=           admin-only — lista respostas do tenant
 *   GET  /nps/:token                      público — retorna info pra UI da resposta (subject_name, encounter_at)
 *   POST /nps/:token/respond              público — submete score + feedback (uma vez)
 *
 * Implementação:
 *   - Token: 32 hex chars random (crypto.randomBytes)
 *   - TTL: 30 dias (expires_at)
 *   - Email via SES mailer já existente (lib/mailer)
 *   - Rotas públicas (`/nps/:token*`) não usam fastify.authenticate
 *   - Idempotência: respond só funciona se responded_at IS NULL
 */

const { randomBytes } = require('crypto');
const { withTenant } = require('../db/tenant');

const TOKEN_TTL_DAYS = 30;

// ── Email helper ──────────────────────────────────────────────────────────
// Usa o mailer SES via aws-sdk (segue padrão de auth-email.js que envia
// verification e reset). Se SES_MOCK=1, só loga. Falha silenciosa não derruba
// criação de NPS — token segue válido pra reenvio manual.
async function sendNpsEmail({ fastify, to, subject_name, token }) {
  if (process.env.SES_MOCK === '1' || process.env.SES_MOCK === 'true') {
    fastify.log.info({ to, subject_name, token }, 'SES_MOCK: NPS email');
    return;
  }
  const frontendUrl = process.env.FRONTEND_URL || 'https://app.genomaflow.com.br';
  const link = `${frontendUrl}/nps/${token}`;
  const fromEmail = process.env.SES_FROM_EMAIL || 'noreply@genomaflow.com.br';

  let SESClient, SendEmailCommand;
  try {
    ({ SESv2Client: SESClient, SendEmailCommand } = require('@aws-sdk/client-sesv2'));
  } catch (e) {
    fastify.log.error('aws-sdk client-sesv2 não disponível — NPS email skipped');
    return;
  }
  const ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
  await ses.send(new SendEmailCommand({
    FromEmailAddress: fromEmail,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: 'Como foi sua experiência?', Charset: 'UTF-8' },
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: `
              <p>Olá!</p>
              <p>Sua opinião sobre o atendimento de <strong>${escapeHtml(subject_name)}</strong> é muito importante.</p>
              <p>Em uma escala de 0 a 10, o quanto você recomendaria nosso serviço?</p>
              <p><a href="${link}" style="display:inline-block;padding:12px 24px;background:#c0c1ff;color:#4b4d83;text-decoration:none;border-radius:4px;font-family:sans-serif;font-weight:bold;">Responder pesquisa</a></p>
              <p style="color:#888;font-size:12px;">O link expira em 30 dias. Sua resposta é anônima para o profissional e ajuda a melhorar nosso atendimento.</p>
            `,
          },
        },
      },
    },
  }));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// ── Module ────────────────────────────────────────────────────────────────

module.exports = async function (fastify) {

  // POST /nps/send — agenda envio (admin only)
  fastify.post('/send', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, role } = request.user;
    if (role !== 'admin' && role !== 'master') return reply.status(403).send({ error: 'Apenas admin' });

    const { subject_id, encounter_id, appointment_id, sent_to, sent_via } = request.body || {};
    if (!subject_id || typeof subject_id !== 'string') {
      return reply.status(400).send({ error: 'subject_id obrigatório' });
    }
    if (!sent_to || typeof sent_to !== 'string' || !sent_to.includes('@')) {
      return reply.status(400).send({ error: 'sent_to (email) obrigatório' });
    }
    const via = sent_via || 'email';
    if (!['email', 'whatsapp', 'manual'].includes(via)) {
      return reply.status(400).send({ error: 'sent_via inválido' });
    }
    if (via === 'whatsapp') {
      // Fase 3 entrega WhatsApp via Z-API. Por ora, aceita marker mas não envia.
      return reply.status(400).send({ error: 'sent_via=whatsapp ainda não disponível (Fase 3)' });
    }

    const token = randomBytes(16).toString('hex');
    const expires_at = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      // Subject existe + retorna nome pra mensagem
      const { rows: subRows } = await client.query(
        `SELECT id, name FROM subjects WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [subject_id, tenant_id]
      );
      if (subRows.length === 0) {
        const e = new Error('subject_invalid'); e.code = 'SUBJECT_INVALID'; throw e;
      }
      const subject_name = subRows[0].name;

      const { rows } = await client.query(
        `INSERT INTO nps_surveys (
           tenant_id, subject_id, encounter_id, appointment_id,
           token, expires_at, sent_via, sent_to
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [tenant_id, subject_id, encounter_id || null, appointment_id || null,
         token, expires_at.toISOString(), via, sent_to]
      );
      return { row: rows[0], subject_name };
    }, { userId: user_id, channel: 'ui' });

    // Envia email best-effort
    try {
      if (via === 'email') {
        await sendNpsEmail({ fastify, to: sent_to, subject_name: result.subject_name, token });
      }
    } catch (err) {
      fastify.log.error({ err, token }, 'Falha ao enviar email NPS — token criado, reenvio manual possível');
    }

    return reply.status(201).send(result.row);
  });

  // GET /nps/responses — lista respostas (admin)
  // Wrapper withTenant pq subjects.RLS é direto (sem NULLIF) — sem contexto JOIN trazia NULL.
  fastify.get('/responses', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, role } = request.user;
    if (role !== 'admin' && role !== 'master') return reply.status(403).send({ error: 'Apenas admin' });

    const period = parseInt(request.query?.period, 10) || 90;
    const days = Math.min(365, Math.max(1, period));

    const rows = await withTenant(fastify.pg, tenant_id, async (client) => {
      const r = await client.query(
        `SELECT n.id, n.subject_id, n.encounter_id, n.score, n.feedback, n.responded_at, n.sent_at, n.sent_via,
                s.name AS subject_name
         FROM nps_surveys n
         LEFT JOIN subjects s ON s.id = n.subject_id AND s.tenant_id = n.tenant_id
         WHERE n.tenant_id = $1
           AND n.sent_at >= NOW() - ($2::int || ' days')::interval
         ORDER BY n.sent_at DESC
         LIMIT 500`,
        [tenant_id, days]
      );
      return r.rows;
    });

    // Agregação simples
    const responded = rows.filter(r => r.score !== null);
    const promoters = responded.filter(r => r.score >= 9).length;
    const detractors = responded.filter(r => r.score <= 6).length;
    const passives = responded.filter(r => r.score >= 7 && r.score <= 8).length;
    const nps_score = responded.length > 0
      ? Math.round(((promoters - detractors) / responded.length) * 100)
      : null;

    return {
      items: rows,
      stats: {
        total_sent: rows.length,
        total_responded: responded.length,
        nps_score,
        promoters,
        passives,
        detractors,
      },
      period_days: days,
    };
  });

  // GET /nps/:token — público — retorna info pra UI render
  fastify.get('/:token', async (request, reply) => {
    const { token } = request.params;
    if (!token || !/^[a-f0-9]{32}$/.test(token)) {
      return reply.status(400).send({ error: 'token inválido' });
    }

    const { rows } = await fastify.pg.query(
      `SELECT n.id, n.responded_at, n.expires_at, s.name AS subject_name, n.tenant_id
       FROM nps_surveys n
       LEFT JOIN subjects s ON s.id = n.subject_id
       WHERE n.token = $1`,
      [token]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'token não encontrado' });
    const row = rows[0];
    if (new Date(row.expires_at) < new Date()) {
      return reply.status(410).send({ error: 'token expirado' });
    }
    return {
      subject_name: row.subject_name,
      already_responded: row.responded_at !== null,
      expires_at: row.expires_at,
    };
  });

  // POST /nps/:token/respond — público — submete resposta
  fastify.post('/:token/respond', async (request, reply) => {
    const { token } = request.params;
    if (!token || !/^[a-f0-9]{32}$/.test(token)) {
      return reply.status(400).send({ error: 'token inválido' });
    }
    const { score, feedback } = request.body || {};
    if (!Number.isInteger(score) || score < 0 || score > 10) {
      return reply.status(400).send({ error: 'score deve ser inteiro 0–10' });
    }
    if (feedback !== undefined && feedback !== null) {
      if (typeof feedback !== 'string') return reply.status(400).send({ error: 'feedback deve ser string' });
      if (feedback.length > 5000) return reply.status(400).send({ error: 'feedback excede 5000 chars' });
    }

    const xff = request.headers['x-forwarded-for'];
    const ip = xff ? String(xff).split(',')[0].trim() : request.ip;

    // UPDATE com WHERE responded_at IS NULL pra idempotência
    const { rows } = await fastify.pg.query(
      `UPDATE nps_surveys
       SET score = $1,
           feedback = $2,
           responded_at = NOW(),
           responded_ip = $3
       WHERE token = $4
         AND responded_at IS NULL
         AND expires_at > NOW()
       RETURNING id`,
      [score, feedback || null, ip, token]
    );

    if (rows.length === 0) {
      // Pode ser: já respondeu, expirou, ou token não existe. Não vazamos qual.
      return reply.status(409).send({ error: 'pesquisa não disponível (já respondida ou expirada)' });
    }

    return { ok: true };
  });
};
