const { withTenant } = require('../../db/tenant');

const ADMIN_ONLY = async function (request, reply) {
  if (request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Chat entre tenants é restrito a admins.' });
  }
};

module.exports = async function (fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id, module: userModule } = request.user;
    const { uf, specialty, q } = request.query || {};
    const page = Math.max(1, parseInt(request.query?.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(request.query?.page_size) || 20));
    const offset = (page - 1) * pageSize;

    const wheres = [`module = $1`];
    const params = [userModule];
    let idx = 2;

    if (uf && /^[A-Z]{2}$/i.test(uf)) {
      wheres.push(`region_uf = $${idx++}`);
      params.push(uf.toUpperCase());
    }
    if (specialty && typeof specialty === 'string') {
      wheres.push(`$${idx++} = ANY(specialties)`);
      params.push(specialty);
    }
    if (q && typeof q === 'string' && q.trim().length > 0) {
      wheres.push(`(name ILIKE $${idx} OR similarity(name, $${idx + 1}) > 0.1)`);
      params.push('%' + q.trim() + '%');
      params.push(q.trim());
      idx += 2;
    }

    // Self-exclude (não mostrar própria clínica)
    wheres.push(`tenant_id <> $${idx++}`);
    params.push(tenant_id);

    const whereSql = wheres.join(' AND ');
    const sql = `
      SELECT tenant_id, name, module, region_uf, region_city, specialties, last_active_month
      FROM tenant_directory_listing
      WHERE ${whereSql}
      ORDER BY name ASC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    params.push(pageSize, offset);

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(sql, params);
      return rows;
    });

    return { results: result, page, page_size: pageSize };
  });
};
