const { withTenant } = require('../db/tenant');
const crypto = require('crypto');

function hashCpf(cpf) {
  return crypto.createHash('sha256').update(cpf).digest('hex');
}

module.exports = async function (fastify) {
  // POST /patients — create subject (human or animal based on tenant module)
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, module } = request.user;
    const { name, birth_date, sex, cpf, species, owner_cpf } = request.body;

    if (module === 'human') {
      if (!name || !birth_date || !sex) {
        return reply.status(400).send({ error: 'name, birth_date and sex are required for human module' });
      }
      const subject = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO subjects (tenant_id, name, birth_date, sex, cpf_hash, subject_type)
           VALUES ($1, $2, $3, $4, $5, 'human')
           RETURNING id, name, birth_date, sex, subject_type, created_at`,
          [tenant_id, name, birth_date, sex, cpf ? hashCpf(cpf) : null]
        );
        return rows[0];
      });
      return reply.status(201).send(subject);
    }

    // module === 'veterinary'
    if (!name || !sex || !species || !owner_cpf) {
      return reply.status(400).send({ error: 'name, sex, species and owner_cpf are required for veterinary module' });
    }
    const VALID_SPECIES = ['dog', 'cat', 'equine', 'bovine'];
    if (!VALID_SPECIES.includes(species)) {
      return reply.status(400).send({ error: `species must be one of: ${VALID_SPECIES.join(', ')}` });
    }

    const subject = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO subjects (tenant_id, name, sex, species, owner_cpf_hash, subject_type)
         VALUES ($1, $2, $3, $4, $5, 'animal')
         RETURNING id, name, sex, species, subject_type, created_at`,
        [tenant_id, name, sex, species, hashCpf(owner_cpf)]
      );
      return rows[0];
    });
    return reply.status(201).send(subject);
  });

  // GET /patients — list subjects for tenant
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, birth_date, sex, subject_type, species, created_at
         FROM subjects ORDER BY created_at DESC`
      );
      return rows;
    });
  });

  // GET /patients/search — animal lookup by owner CPF (veterinary module)
  fastify.get('/search', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { owner_cpf } = request.query;
    if (!owner_cpf) return reply.status(400).send({ error: 'owner_cpf query param required' });

    const hash = hashCpf(owner_cpf);
    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, sex, species, created_at
         FROM subjects
         WHERE owner_cpf_hash = $1 AND subject_type = 'animal'
         ORDER BY name`,
        [hash]
      );
      return rows;
    });
  });

  // GET /patients/:id
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const subject = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, birth_date, sex, subject_type, species, created_at
         FROM subjects WHERE id = $1`,
        [id]
      );
      return rows[0] || null;
    });

    if (!subject) return reply.status(404).send({ error: 'Patient not found' });
    return subject;
  });
};
