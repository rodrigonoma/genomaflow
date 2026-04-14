const { withTenant } = require('../db/tenant');

module.exports = async function (fastify) {
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { name, birth_date, sex, cpf_hash } = request.body;

    const patient = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO patients (tenant_id, name, birth_date, sex, cpf_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, birth_date, sex, created_at`,
        [tenant_id, name, birth_date, sex, cpf_hash || null]
      );
      return rows[0];
    });

    return reply.status(201).send(patient);
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, birth_date, sex, created_at FROM patients ORDER BY created_at DESC`
      );
      return rows;
    });
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const patient = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, birth_date, sex, created_at FROM patients WHERE id = $1`,
        [id]
      );
      return rows[0] || null;
    });

    if (!patient) return reply.status(404).send({ error: 'Patient not found' });
    return patient;
  });
};
