const { withTenant } = require('../db/tenant');
const crypto = require('crypto');

function publishSubjectUpserted(fastify, tenant_id, subject_id) {
  try {
    fastify.redis.publish(`subject:upserted:${tenant_id}`, JSON.stringify({ subject_id }));
  } catch (_) {}
}

function hashCpf(cpf) {
  return crypto.createHash('sha256').update(cpf.replace(/\D/g, '')).digest('hex');
}

function cpfLast4(cpf) {
  const digits = cpf.replace(/\D/g, '');
  return digits.slice(-4);
}

module.exports = async function (fastify) {

  // ── OWNERS (veterinary) ────────────────────────────────────

  fastify.get('/owners', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, cpf_last4, phone, email, address, notes, created_at
         FROM owners ORDER BY name`
      );
      return rows;
    });
  });

  fastify.post('/owners', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { name, cpf, phone, email, address, notes } = request.body;
    if (!name) return reply.status(400).send({ error: 'name is required' });

    const owner = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO owners (tenant_id, name, cpf_hash, cpf_last4, phone, email, address, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, name, cpf_last4, phone, email, address, notes, created_at`,
        [tenant_id, name,
         cpf ? hashCpf(cpf) : null,
         cpf ? cpfLast4(cpf) : null,
         phone || null, email || null, address || null, notes || null]
      );
      return rows[0];
    });
    return reply.status(201).send(owner);
  });

  fastify.put('/owners/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const { name, phone, email, address, notes } = request.body;

    const owner = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE owners SET
           name    = COALESCE($1, name),
           phone   = COALESCE($2, phone),
           email   = COALESCE($3, email),
           address = COALESCE($4, address),
           notes   = COALESCE($5, notes)
         WHERE id = $6
         RETURNING id, name, cpf_last4, phone, email, address, notes, updated_at`,
        [name, phone, email, address, notes, id]
      );
      return rows[0] || null;
    });
    if (!owner) return reply.status(404).send({ error: 'Owner not found' });
    return owner;
  });

  // ── SUBJECTS ───────────────────────────────────────────────

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, module } = request.user;
    const {
      name, birth_date, sex, cpf, phone,
      weight, height, blood_type, allergies, comorbidities, notes,
      // veterinary
      species, owner_id, breed, color, microchip, neutered
    } = request.body;

    if (module === 'human') {
      if (!name || !birth_date || !sex)
        return reply.status(400).send({ error: 'name, birth_date and sex are required' });

      const subject = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO subjects
             (tenant_id, name, birth_date, sex, cpf_hash, phone,
              weight, height, blood_type, allergies, comorbidities, notes, subject_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'human')
           RETURNING id, name, birth_date, sex, subject_type,
                     weight, height, blood_type, allergies, comorbidities, notes, phone, created_at`,
          [tenant_id, name, birth_date, sex,
           cpf ? hashCpf(cpf) : null, phone || null,
           weight || null, height || null, blood_type || null,
           allergies || null, comorbidities || null, notes || null]
        );
        return rows[0];
      });
      publishSubjectUpserted(fastify, tenant_id, subject.id);
      return reply.status(201).send(subject);
    }

    // veterinary
    const VALID_SPECIES = ['dog', 'cat', 'equine', 'bovine', 'bird', 'reptile', 'other'];
    if (!name || !sex || !species)
      return reply.status(400).send({ error: 'name, sex and species are required' });
    if (!VALID_SPECIES.includes(species))
      return reply.status(400).send({ error: `species must be one of: ${VALID_SPECIES.join(', ')}` });

    const subject = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO subjects
           (tenant_id, name, birth_date, sex, species, owner_id,
            breed, color, microchip, neutered,
            weight, allergies, comorbidities, notes, subject_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'animal')
         RETURNING id, name, birth_date, sex, species, subject_type,
                   owner_id, breed, color, microchip, neutered,
                   weight, allergies, comorbidities, notes, created_at`,
        [tenant_id, name, birth_date || null, sex,
         species, owner_id || null,
         breed || null, color || null, microchip || null, neutered ?? null,
         weight || null, allergies || null, comorbidities || null, notes || null]
      );
      return rows[0];
    });
    publishSubjectUpserted(fastify, tenant_id, subject.id);
    return reply.status(201).send(subject);
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT s.id, s.name, s.birth_date, s.sex, s.subject_type, s.species,
                s.weight, s.breed, s.created_at, s.cpf_last4,
                o.name AS owner_name, o.cpf_last4 AS owner_cpf_last4, o.phone AS owner_phone
         FROM subjects s
         LEFT JOIN owners o ON o.id = s.owner_id
         WHERE s.deleted_at IS NULL
         ORDER BY s.created_at DESC`
      );
      return rows;
    });
  });

  fastify.get('/search', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { owner_cpf } = request.query;
    if (!owner_cpf) return reply.status(400).send({ error: 'owner_cpf query param required' });

    const hash = hashCpf(owner_cpf);
    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT s.id, s.name, s.sex, s.species, s.subject_type, s.created_at,
                o.name AS owner_name
         FROM subjects s
         LEFT JOIN owners o ON o.id = s.owner_id
         WHERE (s.owner_cpf_hash = $1 OR o.cpf_hash = $1)
           AND s.subject_type = 'animal'
           AND s.deleted_at IS NULL
         ORDER BY s.name`,
        [hash]
      );
      return rows;
    });
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const subject = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT s.*,
                o.name AS owner_name, o.cpf_last4 AS owner_cpf_last4,
                o.phone AS owner_phone, o.email AS owner_email
         FROM subjects s
         LEFT JOIN owners o ON o.id = s.owner_id
         WHERE s.id = $1 AND s.deleted_at IS NULL`,
        [id]
      );
      return rows[0] || null;
    });
    if (!subject) return reply.status(404).send({ error: 'Patient not found' });
    return subject;
  });

  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const {
      name, birth_date, sex, phone,
      weight, height, blood_type, allergies, comorbidities, notes,
      breed, color, microchip, neutered, owner_id,
      medications, smoking, alcohol, diet_type, physical_activity, family_history
    } = request.body;

    const subject = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE subjects SET
           name              = COALESCE($1,  name),
           birth_date        = COALESCE($2,  birth_date),
           sex               = COALESCE($3,  sex),
           phone             = COALESCE($4,  phone),
           weight            = COALESCE($5,  weight),
           height            = COALESCE($6,  height),
           blood_type        = COALESCE($7,  blood_type),
           allergies         = COALESCE($8,  allergies),
           comorbidities     = COALESCE($9,  comorbidities),
           notes             = COALESCE($10, notes),
           breed             = COALESCE($11, breed),
           color             = COALESCE($12, color),
           microchip         = COALESCE($13, microchip),
           neutered          = COALESCE($14, neutered),
           owner_id          = COALESCE($15, owner_id),
           medications       = COALESCE($16, medications),
           smoking           = COALESCE($17, smoking),
           alcohol           = COALESCE($18, alcohol),
           diet_type         = COALESCE($19, diet_type),
           physical_activity = COALESCE($20, physical_activity),
           family_history    = COALESCE($21, family_history)
         WHERE id = $22 AND deleted_at IS NULL
         RETURNING *`,
        [name, birth_date, sex, phone,
         weight, height, blood_type, allergies, comorbidities, notes,
         breed, color, microchip, neutered, owner_id,
         medications ?? null, smoking ?? null, alcohol ?? null,
         diet_type ?? null, physical_activity ?? null, family_history ?? null,
         id]
      );
      return rows[0] || null;
    });
    if (!subject) return reply.status(404).send({ error: 'Patient not found' });
    publishSubjectUpserted(fastify, tenant_id, subject.id);
    return subject;
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const deleted = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE subjects SET deleted_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id`, [id]
      );
      return rows[0] || null;
    });
    if (!deleted) return reply.status(404).send({ error: 'Patient not found' });
    return reply.status(204).send();
  });

  // ── TREATMENT PLANS ────────────────────────────────────────

  fastify.get('/:id/treatments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT tp.*,
                json_agg(ti ORDER BY ti.sort_order) FILTER (WHERE ti.id IS NOT NULL) AS items
         FROM treatment_plans tp
         LEFT JOIN treatment_items ti ON ti.plan_id = tp.id
         WHERE tp.subject_id = $1
         GROUP BY tp.id
         ORDER BY tp.created_at DESC`,
        [id]
      );
      return rows;
    });
  });

  fastify.post('/:id/treatments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id: subject_id } = request.params;
    const { type, title, description, exam_id, items = [] } = request.body;

    if (!type || !title)
      return reply.status(400).send({ error: 'type and title are required' });

    const plan = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO treatment_plans
           (tenant_id, subject_id, exam_id, created_by, type, title, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [tenant_id, subject_id, exam_id || null, user_id, type, title, description || null]
      );
      const plan = rows[0];

      if (items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const { label, value, frequency, duration, notes } = items[i];
          await client.query(
            `INSERT INTO treatment_items (plan_id, label, value, frequency, duration, notes, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [plan.id, label, value || null, frequency || null, duration || null, notes || null, i]
          );
        }
      }
      return plan;
    });
    return reply.status(201).send(plan);
  });

  fastify.put('/treatments/:plan_id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { plan_id } = request.params;
    const { status, title, description, items } = request.body;

    const plan = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE treatment_plans SET
           status      = COALESCE($1, status),
           title       = COALESCE($2, title),
           description = COALESCE($3, description)
         WHERE id = $4
         RETURNING *`,
        [status, title, description, plan_id]
      );
      if (!rows[0]) return null;
      const plan = rows[0];

      if (items) {
        await client.query(`DELETE FROM treatment_items WHERE plan_id = $1`, [plan_id]);
        for (let i = 0; i < items.length; i++) {
          const { label, value, frequency, duration, notes } = items[i];
          await client.query(
            `INSERT INTO treatment_items (plan_id, label, value, frequency, duration, notes, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [plan_id, label, value || null, frequency || null, duration || null, notes || null, i]
          );
        }
      }
      return plan;
    });
    if (!plan) return reply.status(404).send({ error: 'Treatment plan not found' });
    return plan;
  });

  fastify.get('/treatments/:plan_id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { plan_id } = request.params;

    const plan = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT tp.*,
                json_agg(ti ORDER BY ti.sort_order) FILTER (WHERE ti.id IS NOT NULL) AS items
         FROM treatment_plans tp
         LEFT JOIN treatment_items ti ON ti.plan_id = tp.id
         WHERE tp.id = $1
         GROUP BY tp.id`,
        [plan_id]
      );
      return rows[0] || null;
    });
    if (!plan) return reply.status(404).send({ error: 'Treatment plan not found' });
    return plan;
  });
};
