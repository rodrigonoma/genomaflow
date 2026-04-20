module.exports = async function (fastify) {
  fastify.post('/', async (request, reply) => {
    const { url, method, status_code, error_message } = request.body || {};

    let tenant_id = null;
    let user_id = null;
    try {
      await fastify.authenticate(request, reply);
      tenant_id = request.user?.tenant_id ?? null;
      user_id = request.user?.user_id ?? null;
    } catch (_) { /* unauthenticated errors are still logged */ }

    await fastify.pg.query(
      `INSERT INTO error_log (tenant_id, user_id, url, method, status_code, error_message)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenant_id, user_id, url ?? null, method ?? null, status_code ?? null, error_message ?? null]
    );

    return reply.status(204).send();
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Acesso restrito' });

    const { rows } = await fastify.pg.query(
      `SELECT e.id, e.url, e.method, e.status_code, e.error_message, e.created_at,
              u.email as user_email, t.name as tenant_name
       FROM error_log e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN tenants t ON t.id = e.tenant_id
       ORDER BY e.created_at DESC
       LIMIT 500`
    );
    return rows;
  });
};
