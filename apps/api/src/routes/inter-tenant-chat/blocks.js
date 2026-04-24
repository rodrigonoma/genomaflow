const { withTenant } = require('../../db/tenant');

const ADMIN_ONLY = async function (request, reply) {
  if (request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Chat entre tenants é restrito a admins.' });
  }
};

module.exports = async function (fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const rows = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows: r } = await client.query(
        `SELECT b.blocker_tenant_id, b.blocked_tenant_id, b.reason, b.created_at,
                t.name AS blocked_tenant_name
         FROM tenant_blocks b
         LEFT JOIN tenants t ON t.id = b.blocked_tenant_id
         WHERE b.blocker_tenant_id = $1
         ORDER BY b.created_at DESC`,
        [tenant_id]
      );
      return r;
    });
    return { results: rows };
  });

  fastify.post('/', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { blocked_tenant_id, reason } = request.body || {};

    if (!blocked_tenant_id || typeof blocked_tenant_id !== 'string') {
      return reply.status(400).send({ error: 'blocked_tenant_id obrigatório' });
    }
    if (blocked_tenant_id === tenant_id) {
      return reply.status(400).send({ error: 'Não é possível bloquear a própria clínica.' });
    }
    if (reason != null && (typeof reason !== 'string' || reason.length > 500)) {
      return reply.status(400).send({ error: 'reason deve ser string com até 500 chars' });
    }

    try {
      await withTenant(fastify.pg, tenant_id, async (client) => {
        await client.query(
          `INSERT INTO tenant_blocks (blocker_tenant_id, blocked_tenant_id, reason)
           VALUES ($1, $2, $3)
           ON CONFLICT (blocker_tenant_id, blocked_tenant_id) DO NOTHING`,
          [tenant_id, blocked_tenant_id, reason || null]
        );
      });
      return reply.status(201).send({ blocker_tenant_id: tenant_id, blocked_tenant_id });
    } catch (err) {
      if (err.code === '22P02') {
        return reply.status(400).send({ error: 'blocked_tenant_id inválido' });
      }
      throw err;
    }
  });

  fastify.delete('/:tenantId', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { tenantId: blocked_tenant_id } = request.params;

    try {
      const deleted = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rowCount } = await client.query(
          `DELETE FROM tenant_blocks
           WHERE blocker_tenant_id = $1 AND blocked_tenant_id = $2`,
          [tenant_id, blocked_tenant_id]
        );
        return rowCount;
      });
      if (deleted === 0) return reply.status(404).send({ error: 'Bloqueio não encontrado.' });
      return reply.status(204).send();
    } catch (err) {
      if (err.code === '22P02') {
        return reply.status(400).send({ error: 'tenant_id inválido' });
      }
      throw err;
    }
  });
};
