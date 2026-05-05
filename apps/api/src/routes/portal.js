'use strict';

/**
 * Portal do tutor/paciente — read-only via token público.
 *
 * Endpoints:
 *   POST   /portal/tokens                      admin gera token (subject_id OU owner_id)
 *   GET    /portal/tokens                      admin lista tokens do tenant
 *   DELETE /portal/tokens/:id                  admin revoga
 *
 *   GET    /portal/:token                      público — info inicial (nome, tenant_name)
 *   GET    /portal/:token/agenda               público — próximas consultas
 *   GET    /portal/:token/exams                público — exames recentes (status + datas)
 *   GET    /portal/:token/prescriptions        público — prescrições
 *   GET    /portal/:token/documents            público — atestados/encaminhamentos
 *   GET    /portal/:token/vaccines             público — carteira (vet)
 *
 * Segurança:
 *   - Token = 32 hex random + TTL 90 dias
 *   - Scope subject_id (1 paciente humano OU 1 animal) OU owner_id (todos animais do tutor)
 *   - revoked_at marca como inválido (admin pode revogar)
 *   - Cada acesso atualiza last_accessed_at + access_count++ (rate limiting future)
 *   - Rate limit 60/min por token
 */

const { randomBytes } = require('crypto');
const { withTenant } = require('../db/tenant');

const TOKEN_TTL_DAYS = 90;

// ── Helpers ──────────────────────────────────────────────────────────────

async function resolvePortalToken(fastify, tokenStr) {
  if (!/^[a-f0-9]{32}$/i.test(tokenStr)) return null;
  const { rows } = await fastify.pg.query(
    `SELECT id, tenant_id, subject_id, owner_id, expires_at, revoked_at
     FROM portal_tokens
     WHERE token = $1`,
    [tokenStr]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.revoked_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  // Atualiza acesso (best-effort)
  fastify.pg.query(
    `UPDATE portal_tokens SET last_accessed_at = NOW(), access_count = access_count + 1
     WHERE id = $1`,
    [row.id]
  ).catch(() => {});

  return row;
}

module.exports = async function (fastify) {

  // ─── Admin: tokens management ────────────────────────────────────

  fastify.post('/tokens', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, role } = request.user;
    if (role !== 'admin' && role !== 'master') return reply.status(403).send({ error: 'Apenas admin' });

    const { subject_id, owner_id } = request.body || {};
    if ((!subject_id && !owner_id) || (subject_id && owner_id)) {
      return reply.status(400).send({ error: 'subject_id OU owner_id obrigatório (apenas um)' });
    }

    const token = randomBytes(16).toString('hex');
    const expires_at = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    try {
      const result = await withTenant(fastify.pg, tenant_id, async (client) => {
        // Valida scope alvo no mesmo tenant
        if (subject_id) {
          const { rows } = await client.query(
            `SELECT id FROM subjects WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
            [subject_id, tenant_id]
          );
          if (rows.length === 0) {
            const e = new Error('subject_invalid'); e.code = 'SUBJECT'; throw e;
          }
        } else {
          const { rows } = await client.query(
            `SELECT id FROM owners WHERE id = $1 AND tenant_id = $2`,
            [owner_id, tenant_id]
          );
          if (rows.length === 0) {
            const e = new Error('owner_invalid'); e.code = 'OWNER'; throw e;
          }
        }

        const { rows } = await client.query(
          `INSERT INTO portal_tokens (tenant_id, subject_id, owner_id, token, expires_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [tenant_id, subject_id || null, owner_id || null, token, expires_at.toISOString(), user_id]
        );
        return rows[0];
      }, { userId: user_id, channel: 'ui' });

      const frontendUrl = process.env.FRONTEND_URL || 'https://app.genomaflow.com.br';
      return reply.status(201).send({ ...result, link: `${frontendUrl}/portal/${token}` });
    } catch (err) {
      if (err.code === 'SUBJECT') return reply.status(400).send({ error: 'subject_id inválido' });
      if (err.code === 'OWNER') return reply.status(400).send({ error: 'owner_id inválido' });
      throw err;
    }
  });

  fastify.get('/tokens', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin' && role !== 'master') return reply.status(403).send({ error: 'Apenas admin' });

    const { rows } = await fastify.pg.query(
      `SELECT pt.id, pt.subject_id, pt.owner_id, pt.expires_at, pt.revoked_at, pt.created_at,
              pt.last_accessed_at, pt.access_count,
              s.name AS subject_name,
              o.name AS owner_name
       FROM portal_tokens pt
       LEFT JOIN subjects s ON s.id = pt.subject_id AND s.tenant_id = pt.tenant_id
       LEFT JOIN owners o ON o.id = pt.owner_id AND o.tenant_id = pt.tenant_id
       WHERE pt.tenant_id = $1
       ORDER BY pt.created_at DESC
       LIMIT 200`,
      [tenant_id]
    );
    return { items: rows };
  });

  fastify.delete('/tokens/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, role } = request.user;
    if (role !== 'admin' && role !== 'master') return reply.status(403).send({ error: 'Apenas admin' });
    const { id } = request.params;

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE portal_tokens SET revoked_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL
         RETURNING id`,
        [id, tenant_id]
      );
      return rows[0] || null;
    }, { userId: user_id, channel: 'ui' });

    if (!result) return reply.status(404).send({ error: 'token not found or already revoked' });
    return reply.status(204).send();
  });

  // ─── Public read-only endpoints ──────────────────────────────────

  // Rate limit 60/min por token (basic — usa keyGenerator com token na URL)
  const portalRateLimit = {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
        keyGenerator: (req) => `portal:${req.params?.token || req.ip}`,
      },
    },
  };

  fastify.get('/:token', portalRateLimit, async (request, reply) => {
    const { token } = request.params;
    const t = await resolvePortalToken(fastify, token);
    if (!t) return reply.status(404).send({ error: 'token inválido ou expirado' });

    return withTenant(fastify.pg, t.tenant_id, async (client) => {
      const { rows: tenantRows } = await client.query(
        `SELECT name, module, whatsapp_phone, phone, clinic_logo_url FROM tenants WHERE id = $1`, [t.tenant_id]
      );
      const tenant = tenantRows[0] || {};

      let subject = null;
      let owner = null;
      let subjects = [];

      if (t.subject_id) {
        const { rows } = await client.query(
          `SELECT id, name, subject_type, species, breed, birth_date, sex
           FROM subjects WHERE id = $1 AND deleted_at IS NULL`,
          [t.subject_id]
        );
        subject = rows[0] || null;
      }
      if (t.owner_id) {
        const { rows: ownerRows } = await client.query(
          `SELECT id, name, phone, email FROM owners WHERE id = $1`,
          [t.owner_id]
        );
        owner = ownerRows[0] || null;
        const { rows: subRows } = await client.query(
          `SELECT id, name, subject_type, species, breed, birth_date
           FROM subjects WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY name`,
          [t.owner_id]
        );
        subjects = subRows;
      }

      // Fallback: usa phone se whatsapp_phone não setado (clínica costuma ter
      // o mesmo número pra fixo + WhatsApp em ICP pequeno)
      const whatsapp = tenant.whatsapp_phone || tenant.phone || null;
      return {
        tenant: { name: tenant.name, module: tenant.module, whatsapp_phone: whatsapp, clinic_logo_url: tenant.clinic_logo_url || null },
        scope: t.subject_id ? 'subject' : 'owner',
        subject,
        owner,
        subjects,
        expires_at: t.expires_at,
      };
    });
  });

  fastify.get('/:token/agenda', portalRateLimit, async (request, reply) => {
    const { token } = request.params;
    const t = await resolvePortalToken(fastify, token);
    if (!t) return reply.status(404).send({ error: 'token inválido ou expirado' });

    return withTenant(fastify.pg, t.tenant_id, async (client) => {
      let sql, params;
      if (t.subject_id) {
        sql = `SELECT id, start_at, duration_minutes, status, appointment_type, reason
               FROM appointments
               WHERE tenant_id = $1 AND subject_id = $2
                 AND start_at >= NOW() - INTERVAL '7 days'
               ORDER BY start_at ASC LIMIT 50`;
        params = [t.tenant_id, t.subject_id];
      } else {
        sql = `SELECT a.id, a.start_at, a.duration_minutes, a.status, a.appointment_type, a.reason,
                      a.subject_id, s.name AS subject_name
               FROM appointments a
               LEFT JOIN subjects s ON s.id = a.subject_id
               WHERE a.tenant_id = $1 AND s.owner_id = $2
                 AND a.start_at >= NOW() - INTERVAL '7 days'
               ORDER BY a.start_at ASC LIMIT 50`;
        params = [t.tenant_id, t.owner_id];
      }
      const { rows } = await client.query(sql, params);
      return { items: rows };
    });
  });

  fastify.get('/:token/exams', portalRateLimit, async (request, reply) => {
    const { token } = request.params;
    const t = await resolvePortalToken(fastify, token);
    if (!t) return reply.status(404).send({ error: 'token inválido ou expirado' });

    return withTenant(fastify.pg, t.tenant_id, async (client) => {
      const subjectsClause = t.subject_id
        ? `subject_id = $2`
        : `subject_id IN (SELECT id FROM subjects WHERE owner_id = $2 AND deleted_at IS NULL)`;
      const { rows } = await client.query(
        `SELECT id, subject_id, status, file_type, created_at
         FROM exams
         WHERE tenant_id = $1 AND ${subjectsClause}
         ORDER BY created_at DESC LIMIT 50`,
        [t.tenant_id, t.subject_id || t.owner_id]
      );
      return { items: rows };
    });
  });

  fastify.get('/:token/prescriptions', portalRateLimit, async (request, reply) => {
    const { token } = request.params;
    const t = await resolvePortalToken(fastify, token);
    if (!t) return reply.status(404).send({ error: 'token inválido ou expirado' });

    return withTenant(fastify.pg, t.tenant_id, async (client) => {
      const subjectsClause = t.subject_id
        ? `subject_id = $2`
        : `subject_id IN (SELECT id FROM subjects WHERE owner_id = $2 AND deleted_at IS NULL)`;
      const { rows } = await client.query(
        `SELECT id, subject_id, agent_type, items, notes, created_at
         FROM prescriptions
         WHERE tenant_id = $1 AND ${subjectsClause}
         ORDER BY created_at DESC LIMIT 50`,
        [t.tenant_id, t.subject_id || t.owner_id]
      );
      return { items: rows };
    });
  });

  fastify.get('/:token/documents', portalRateLimit, async (request, reply) => {
    const { token } = request.params;
    const t = await resolvePortalToken(fastify, token);
    if (!t) return reply.status(404).send({ error: 'token inválido ou expirado' });

    return withTenant(fastify.pg, t.tenant_id, async (client) => {
      const subjectsClause = t.subject_id
        ? `subject_id = $2`
        : `subject_id IN (SELECT id FROM subjects WHERE owner_id = $2 AND deleted_at IS NULL)`;
      const { rows } = await client.query(
        `SELECT id, subject_id, doc_type, title, signed_at, pdf_s3_key, created_at
         FROM clinical_documents
         WHERE tenant_id = $1 AND ${subjectsClause}
         ORDER BY created_at DESC LIMIT 50`,
        [t.tenant_id, t.subject_id || t.owner_id]
      );
      return { items: rows };
    });
  });

  fastify.get('/:token/vaccines', portalRateLimit, async (request, reply) => {
    const { token } = request.params;
    const t = await resolvePortalToken(fastify, token);
    if (!t) return reply.status(404).send({ error: 'token inválido ou expirado' });

    return withTenant(fastify.pg, t.tenant_id, async (client) => {
      const subjectsClause = t.subject_id
        ? `subject_id = $2`
        : `subject_id IN (SELECT id FROM subjects WHERE owner_id = $2 AND deleted_at IS NULL)`;
      const { rows } = await client.query(
        `SELECT id, subject_id, vaccine_name, manufacturer, applied_at, next_dose_date
         FROM vaccines
         WHERE tenant_id = $1 AND ${subjectsClause}
         ORDER BY applied_at DESC LIMIT 100`,
        [t.tenant_id, t.subject_id || t.owner_id]
      );
      return { items: rows };
    });
  });
};
