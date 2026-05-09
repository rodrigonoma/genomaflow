module.exports = async function (fastify) {
  fastify.post('/', async (request, reply) => {
    const {
      url, method, status_code, error_message, stack_trace, request_body,
      tenant_id: bodyTenantId, user_id: bodyUserId,
    } = request.body || {};

    let tenant_id = bodyTenantId ?? null;
    let user_id = bodyUserId ?? null;
    try {
      await fastify.authenticate(request, reply);
      tenant_id = request.user?.tenant_id ?? tenant_id;
      user_id = request.user?.user_id ?? user_id;
    } catch (_) { /* unauthenticated errors are still logged with body fallback */ }

    // user_agent vem do header — útil pra forense (qual browser/versão estava)
    const user_agent = request.headers['user-agent'] || null;

    // Trunca campos longos pra não estourar storage
    const truncate = (s, n) => (typeof s === 'string' && s.length > n) ? s.slice(0, n) : s;

    await fastify.pg.query(
      `INSERT INTO error_log
         (tenant_id, user_id, url, method, status_code, error_message,
          stack_trace, user_agent, request_body)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenant_id, user_id,
        truncate(url, 2000) ?? null, method ?? null, status_code ?? null,
        truncate(error_message, 4000) ?? null,
        truncate(stack_trace, 16000) ?? null,
        truncate(user_agent, 500),
        truncate(request_body, 8000) ?? null,
      ]
    );

    return reply.status(204).send();
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { role } = request.user;
    // Apenas role 'master' (superusuário) pode ver error logs de todas as clínicas.
    // 'admin' é role de tenant (clínica) — NUNCA pode ver dados cross-tenant.
    if (role !== 'master') return reply.status(403).send({ error: 'Acesso restrito' });

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
