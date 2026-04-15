const bcrypt = require('bcrypt');
const { withTenant } = require('../db/tenant');

const VALID_ROLES = ['doctor', 'lab_tech', 'admin'];

module.exports = async function (fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { role, tenant_id } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Forbidden' });

    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, email, role, created_at FROM users
         WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenant_id]
      );
      return rows;
    });
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { role, tenant_id } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Forbidden' });

    const { email, password, role: newRole } = request.body;
    if (!VALID_ROLES.includes(newRole)) {
      return reply.status(400).send({ error: 'Invalid role' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, role, created_at`,
        [tenant_id, email, hash, newRole]
      );
      return rows[0];
    });

    return reply.status(201).send(user);
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { role, tenant_id, user_id } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Forbidden' });

    const { id } = request.params;
    if (id === user_id) {
      return reply.status(400).send({ error: 'Cannot delete yourself' });
    }

    try {
      await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rowCount } = await client.query(
          `DELETE FROM users WHERE id = $1 AND tenant_id = $2`,
          [id, tenant_id]
        );
        if (rowCount === 0) {
          const err = new Error('User not found');
          err.statusCode = 404;
          throw err;
        }
      });
    } catch (err) {
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      throw err;
    }

    return reply.status(204).send();
  });
};
