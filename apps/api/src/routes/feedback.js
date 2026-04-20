module.exports = async function (fastify) {
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { type, message, screenshot } = request.body || {};

    if (!type || !['bug', 'feature'].includes(type)) {
      return reply.status(400).send({ error: 'type deve ser "bug" ou "feature"' });
    }
    if (!message || !message.trim()) {
      return reply.status(400).send({ error: 'message é obrigatório' });
    }

    const { rows } = await fastify.pg.query(
      `INSERT INTO feedback (tenant_id, user_id, type, message, screenshot)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, type, created_at`,
      [tenant_id, user_id, type, message.trim(), screenshot ?? null]
    );
    return reply.status(201).send(rows[0]);
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Acesso restrito' });

    const { rows } = await fastify.pg.query(
      `SELECT f.id, f.type, f.message, f.created_at,
              u.email as user_email, t.name as tenant_name
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       LEFT JOIN tenants t ON t.id = f.tenant_id
       ORDER BY f.created_at DESC
       LIMIT 200`
    );
    return rows;
  });
};
