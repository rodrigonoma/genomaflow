const { withTenant } = require('../../db/tenant');

const ADMIN_ONLY = async function (request, reply) {
  if (request.user.role !== 'admin' && request.user.role !== 'master') {
    return reply.status(403).send({ error: 'Restrito a admin.' });
  }
};

const DISTINCT_REPORTERS_FOR_SUSPENSION = 3;
const SUSPENSION_WINDOW_DAYS = 30;

/**
 * Checa se o tenant está suspenso no chat — 3+ denúncias pending de
 * reporters distintos nos últimos 30 dias.
 */
async function isTenantSuspended(pg, tenantId) {
  const { rows } = await pg.query(
    `SELECT COUNT(DISTINCT reporter_tenant_id)::int AS n
     FROM tenant_chat_reports
     WHERE reported_tenant_id = $1
       AND status = 'pending'
       AND created_at >= NOW() - INTERVAL '${SUSPENSION_WINDOW_DAYS} days'`,
    [tenantId]
  );
  return rows[0].n >= DISTINCT_REPORTERS_FOR_SUSPENSION;
}

module.exports = async function (fastify) {
  // POST / — cria denúncia
  fastify.post('/', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { reported_tenant_id, reason, related_message_id } = request.body || {};

    if (!reported_tenant_id || typeof reported_tenant_id !== 'string') {
      return reply.status(400).send({ error: 'reported_tenant_id obrigatório' });
    }
    if (reported_tenant_id === tenant_id) {
      return reply.status(400).send({ error: 'Não é possível denunciar a própria clínica.' });
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return reply.status(400).send({ error: 'reason é obrigatório (mín 10 caracteres)' });
    }
    if (reason.length > 2000) {
      return reply.status(400).send({ error: 'reason muito longa (max 2000 chars)' });
    }

    try {
      const row = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO tenant_chat_reports
             (reporter_tenant_id, reported_tenant_id, reason, related_message_id, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, reported_tenant_id, reason, status, created_at`,
          [tenant_id, reported_tenant_id, reason.trim(), related_message_id || null, user_id]
        );
        return rows[0];
      });
      return reply.status(201).send(row);
    } catch (err) {
      if (err.code === '23505') {
        return reply.status(409).send({ error: 'Você já tem uma denúncia pendente para essa clínica.' });
      }
      if (err.code === '22P02') {
        return reply.status(400).send({ error: 'ID inválido.' });
      }
      throw err;
    }
  });

  // GET / — lista denúncias feitas pelo próprio tenant
  fastify.get('/', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id, role } = request.user;

    if (role === 'master') {
      const { rows } = await fastify.pg.query(
        `SELECT r.id, r.reporter_tenant_id, r.reported_tenant_id, r.reason,
                r.status, r.created_at, r.resolved_at,
                rp.name AS reporter_tenant_name, rd.name AS reported_tenant_name
         FROM tenant_chat_reports r
         JOIN tenants rp ON rp.id = r.reporter_tenant_id
         JOIN tenants rd ON rd.id = r.reported_tenant_id
         ORDER BY r.created_at DESC
         LIMIT 200`
      );
      return { results: rows };
    }

    const rows = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows: r } = await client.query(
        `SELECT r.id, r.reporter_tenant_id, r.reported_tenant_id, r.reason,
                r.status, r.created_at, r.resolved_at,
                rd.name AS reported_tenant_name
         FROM tenant_chat_reports r
         JOIN tenants rd ON rd.id = r.reported_tenant_id
         WHERE r.reporter_tenant_id = $1
         ORDER BY r.created_at DESC
         LIMIT 100`,
        [tenant_id]
      );
      return r;
    });
    return { results: rows };
  });

  // POST /:id/resolve — master-only action on report
  fastify.post('/:id/resolve', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, role } = request.user;
    if (role !== 'master') return reply.status(403).send({ error: 'Restrito a master.' });
    const { id } = request.params;
    const { action } = request.body || {};
    if (!['dismissed', 'actioned'].includes(action)) {
      return reply.status(400).send({ error: 'action deve ser dismissed ou actioned' });
    }
    const { rows } = await fastify.pg.query(
      `UPDATE tenant_chat_reports
       SET status = $1, resolved_at = NOW(), resolved_by_user_id = $2
       WHERE id = $3 AND status = 'pending'
       RETURNING id, status`,
      [action, user_id, id]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Denúncia não encontrada ou já resolvida.' });
    return rows[0];
  });
};

module.exports.isTenantSuspended = isTenantSuspended;
module.exports.DISTINCT_REPORTERS_FOR_SUSPENSION = DISTINCT_REPORTERS_FOR_SUSPENSION;
