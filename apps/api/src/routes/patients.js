const { withTenant } = require('../db/tenant');
const crypto = require('crypto');
const { validatePhoneBR } = require('../utils/phone');
const { validateCPF, validateCpfOrCnpj } = require('../utils/documents');
const aiSuggestions = require('../services/ai-suggestions');

/**
 * Validador único pra phone — DDD obrigatório.
 * Aceita null/undefined/string vazia (campo é opcional na maioria das rotas).
 * Rejeita string não-vazia que não passa em validatePhoneBR.
 */
function checkPhone(value, fieldLabel = 'Telefone') {
  if (value == null || String(value).trim() === '') return null;
  if (!validatePhoneBR(String(value))) {
    return `${fieldLabel} inválido. Use formato com DDD: (11) 99999-9999`;
  }
  return null;
}

function checkCPF(value, fieldLabel = 'CPF') {
  if (value == null || String(value).trim() === '') return null;
  if (!validateCPF(String(value))) {
    return `${fieldLabel} inválido. Verifique os dígitos.`;
  }
  return null;
}

function checkCpfOrCnpj(value, fieldLabel = 'CPF/CNPJ') {
  if (value == null || String(value).trim() === '') return null;
  if (!validateCpfOrCnpj(String(value))) {
    return `${fieldLabel} inválido. Verifique os dígitos.`;
  }
  return null;
}

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
        `SELECT id, name, cpf_last4, phone, email, address, notes, created_at,
                cep, street, number, complement, neighborhood, city, state
         FROM owners WHERE tenant_id = $1 ORDER BY name`,
        [tenant_id]
      );
      return rows;
    });
  });

  fastify.post('/owners', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const {
      name, cpf, phone, email, notes,
      cep, street, number, complement, neighborhood, city, state
    } = request.body;
    if (!name) return reply.status(400).send({ error: 'name is required' });
    const phoneErr = checkPhone(phone, 'Telefone do tutor');
    if (phoneErr) return reply.status(400).send({ error: phoneErr });
    const cpfErr = checkCpfOrCnpj(cpf, 'CPF/CNPJ do tutor');
    if (cpfErr) return reply.status(400).send({ error: cpfErr });

    const owner = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO owners (tenant_id, name, cpf_hash, cpf_last4, phone, email, notes,
                             cep, street, number, complement, neighborhood, city, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id, name, cpf_last4, phone, email, notes, created_at,
                   cep, street, number, complement, neighborhood, city, state`,
        [tenant_id, name,
         cpf ? hashCpf(cpf) : null,
         cpf ? cpfLast4(cpf) : null,
         phone || null, email || null, notes || null,
         cep || null, street || null, number || null, complement || null,
         neighborhood || null, city || null, state || null]
      );
      return rows[0];
    });
    return reply.status(201).send(owner);
  });

  fastify.put('/owners/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const {
      name, phone, email, notes,
      cep, street, number, complement, neighborhood, city, state,
      observations,
    } = request.body;
    const phoneErr = checkPhone(phone, 'Telefone do tutor');
    if (phoneErr) return reply.status(400).send({ error: phoneErr });

    const owner = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE owners SET
           name         = COALESCE($1,  name),
           phone        = COALESCE($2,  phone),
           email        = COALESCE($3,  email),
           notes        = COALESCE($4,  notes),
           cep          = COALESCE($5,  cep),
           street       = COALESCE($6,  street),
           number       = COALESCE($7,  number),
           complement   = COALESCE($8,  complement),
           neighborhood = COALESCE($9,  neighborhood),
           city         = COALESCE($10, city),
           state        = COALESCE($11, state),
           observations = COALESCE($12, observations)
         WHERE id = $13 AND tenant_id = $14
         RETURNING id, name, cpf_last4, phone, email, notes, observations, updated_at,
                   cep, street, number, complement, neighborhood, city, state`,
        [name, phone, email, notes,
         cep, street, number, complement, neighborhood, city, state,
         observations ?? null,
         id, tenant_id]
      );
      return rows[0] || null;
    });
    if (!owner) return reply.status(404).send({ error: 'Owner not found' });
    return owner;
  });

  // ── SUBJECTS ───────────────────────────────────────────────

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, module } = request.user;
    const {
      name, birth_date, sex, cpf, phone,
      weight, height, blood_type, allergies, comorbidities, notes,
      consent_given,
      // veterinary
      species, owner_id, breed, color, microchip, neutered
    } = request.body;

    const phoneErr = checkPhone(phone, 'Telefone do paciente');
    if (phoneErr) return reply.status(400).send({ error: phoneErr });
    // Em humano: apenas CPF (11). Em vet: subjects raramente têm CPF (animal),
    // mas o code aceita por extensão pra dono digitar; validamos como CPF.
    const cpfErr = checkCPF(cpf, 'CPF do paciente');
    if (cpfErr) return reply.status(400).send({ error: cpfErr });

    // Consentimento LGPD — se o profissional marcou, registra quem e quando.
    const consentAt = consent_given ? new Date() : null;
    const consentBy = consent_given ? user_id : null;

    if (module === 'human') {
      if (!name || !birth_date || !sex)
        return reply.status(400).send({ error: 'name, birth_date and sex are required' });

      const subject = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO subjects
             (tenant_id, name, birth_date, sex, cpf_hash, phone,
              weight, height, blood_type, allergies, comorbidities, notes, subject_type,
              consent_given_at, consent_given_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'human',$13,$14)
           RETURNING id, name, birth_date, sex, subject_type,
                     weight, height, blood_type, allergies, comorbidities, notes, phone,
                     consent_given_at, consent_given_by, created_at`,
          [tenant_id, name, birth_date, sex,
           cpf ? hashCpf(cpf) : null, phone || null,
           weight || null, height || null, blood_type || null,
           allergies || null, comorbidities || null, notes || null,
           consentAt, consentBy]
        );
        return rows[0];
      }, { userId: user_id, channel: 'ui' });
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
            weight, allergies, comorbidities, notes, subject_type,
            consent_given_at, consent_given_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'animal',$15,$16)
         RETURNING id, name, birth_date, sex, species, subject_type,
                   owner_id, breed, color, microchip, neutered,
                   weight, allergies, comorbidities, notes,
                   consent_given_at, consent_given_by, created_at`,
        [tenant_id, name, birth_date || null, sex,
         species, owner_id || null,
         breed || null, color || null, microchip || null, neutered ?? null,
         weight || null, allergies || null, comorbidities || null, notes || null,
         consentAt, consentBy]
      );
      return rows[0];
    }, { userId: user_id, channel: 'ui' });
    publishSubjectUpserted(fastify, tenant_id, subject.id);
    return reply.status(201).send(subject);
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    // Defesa em profundidade: filtra por tenant_id explícito ALÉM do RLS.
    // Garante isolamento mesmo se RLS falhar por qualquer motivo (user com
    // BYPASSRLS, app.tenant_id não setado, configuração de prod diferente).
    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT s.id, s.name, s.birth_date, s.sex, s.subject_type, s.species,
                s.weight, s.breed, s.created_at, s.cpf_last4,
                o.name AS owner_name, o.cpf_last4 AS owner_cpf_last4, o.phone AS owner_phone
         FROM subjects s
         LEFT JOIN owners o ON o.id = s.owner_id AND o.tenant_id = $1
         WHERE s.tenant_id = $1 AND s.deleted_at IS NULL
         ORDER BY s.created_at DESC`,
        [tenant_id]
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
         LEFT JOIN owners o ON o.id = s.owner_id AND o.tenant_id = $2
         WHERE s.tenant_id = $2 AND (s.owner_cpf_hash = $1 OR o.cpf_hash = $1)
           AND s.subject_type = 'animal'
           AND s.deleted_at IS NULL
         ORDER BY s.name`,
        [hash, tenant_id]
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
         LEFT JOIN owners o ON o.id = s.owner_id AND o.tenant_id = $2
         WHERE s.id = $1 AND s.tenant_id = $2 AND s.deleted_at IS NULL`,
        [id, tenant_id]
      );
      return rows[0] || null;
    });
    if (!subject) return reply.status(404).send({ error: 'Patient not found' });
    return subject;
  });

  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;
    const {
      name, birth_date, sex, phone,
      weight, height, blood_type, allergies, comorbidities, notes,
      breed, color, microchip, neutered, owner_id,
      medications, smoking, alcohol, diet_type, physical_activity, family_history,
      consent_given,
      // Fase 1 extended fields
      allergies_text, current_weight_kg,
      emergency_contact_name, emergency_contact_phone, insurance_name,
      // Aesthetic F1 (Task 11): só aplicado pra subject_type='human' em tenants module='estetica'.
      // Schema permite NULL — front envia null pra "Não informado".
      fitzpatrick_type, skin_concerns,
    } = request.body;

    // Validação defensiva: fitzpatrick_type aceita null OU inteiro 1..6.
    // CHECK constraint no DB (migration 079) também rejeita, mas falha cedo aqui.
    if (fitzpatrick_type !== undefined && fitzpatrick_type !== null) {
      const ft = Number(fitzpatrick_type);
      if (!Number.isInteger(ft) || ft < 1 || ft > 6) {
        return reply.status(400).send({ error: 'fitzpatrick_type deve ser inteiro entre 1 e 6.' });
      }
    }
    if (skin_concerns !== undefined && skin_concerns !== null && !Array.isArray(skin_concerns)) {
      return reply.status(400).send({ error: 'skin_concerns deve ser array de strings.' });
    }

    const phoneErr = checkPhone(phone, 'Telefone do paciente');
    if (phoneErr) return reply.status(400).send({ error: phoneErr });
    const emergencyErr = checkPhone(emergency_contact_phone, 'Telefone de contato de emergência');
    if (emergencyErr) return reply.status(400).send({ error: emergencyErr });

    // Consentimento LGPD: apenas seta se o campo vier true. Não aceita revogação por aqui.
    const consentAt = consent_given === true ? new Date() : null;
    const consentBy = consent_given === true ? user_id : null;

    const subject = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE subjects SET
           name                    = COALESCE($1,  name),
           birth_date              = COALESCE($2,  birth_date),
           sex                     = COALESCE($3,  sex),
           phone                   = COALESCE($4,  phone),
           weight                  = COALESCE($5,  weight),
           height                  = COALESCE($6,  height),
           blood_type              = COALESCE($7,  blood_type),
           allergies               = COALESCE($8,  allergies),
           comorbidities           = COALESCE($9,  comorbidities),
           notes                   = COALESCE($10, notes),
           breed                   = COALESCE($11, breed),
           color                   = COALESCE($12, color),
           microchip               = COALESCE($13, microchip),
           neutered                = COALESCE($14, neutered),
           owner_id                = $15,
           medications             = COALESCE($16, medications),
           smoking                 = COALESCE($17, smoking),
           alcohol                 = COALESCE($18, alcohol),
           diet_type               = COALESCE($19, diet_type),
           physical_activity       = COALESCE($20, physical_activity),
           family_history          = COALESCE($21, family_history),
           consent_given_at        = COALESCE($22, consent_given_at),
           consent_given_by        = COALESCE($23, consent_given_by),
           allergies_text          = COALESCE($24, allergies_text),
           current_weight_kg       = COALESCE($25, current_weight_kg),
           emergency_contact_name  = COALESCE($26, emergency_contact_name),
           emergency_contact_phone = COALESCE($27, emergency_contact_phone),
           insurance_name          = COALESCE($28, insurance_name),
           fitzpatrick_type        = COALESCE($29, fitzpatrick_type),
           skin_concerns           = COALESCE($30::jsonb, skin_concerns)
         WHERE id = $31 AND tenant_id = $32 AND deleted_at IS NULL
         RETURNING *`,
        [name, birth_date, sex, phone,
         weight, height, blood_type, allergies, comorbidities, notes,
         breed, color, microchip, neutered, owner_id,
         medications ?? null, smoking ?? null, alcohol ?? null,
         diet_type ?? null, physical_activity ?? null, family_history ?? null,
         consentAt, consentBy,
         allergies_text ?? null, current_weight_kg ?? null,
         emergency_contact_name ?? null, emergency_contact_phone ?? null, insurance_name ?? null,
         fitzpatrick_type ?? null,
         skin_concerns !== undefined && skin_concerns !== null ? JSON.stringify(skin_concerns) : null,
         id, tenant_id]
      );
      return rows[0] || null;
    }, { userId: user_id, channel: 'ui' });
    if (!subject) return reply.status(404).send({ error: 'Patient not found' });
    publishSubjectUpserted(fastify, tenant_id, subject.id);
    return subject;
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;
    const deleted = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE subjects SET deleted_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         RETURNING id`, [id, tenant_id]
      );
      return rows[0] || null;
    }, { userId: user_id, channel: 'ui' });
    if (!deleted) return reply.status(404).send({ error: 'Patient not found' });
    return reply.status(204).send();
  });

  // ── TIMELINE UNIFICADA (encontros + exames + prescrições + análises IA) ──
  // Cursor pagination via base64 de "ISOdate|uuid" — maior performance que OFFSET.
  // UNION ALL pra performance (vs N queries no app server). Cada source vira um row
  // com event_type discriminator. Frontend renderiza por tipo.
  // Wrapper withTenant pq exams/clinical_results/prescriptions têm RLS direto (sem NULLIF).
  fastify.get('/:id/timeline', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id: subject_id } = request.params;
    const rawCursor = request.query?.cursor;
    const rawLimit = parseInt(request.query?.limit, 10);
    const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50, 200);

    let cursor = null;
    if (rawCursor) {
      try {
        const decoded = Buffer.from(rawCursor, 'base64').toString('utf8');
        const [iso, cid] = decoded.split('|');
        const d = new Date(iso);
        if (!isNaN(d.getTime()) && cid && /^[0-9a-f]{8}-/i.test(cid)) {
          cursor = { iso: d.toISOString(), id: cid };
        }
      } catch (_) {}
    }

    const cursorClause = cursor ? `AND (event_at, event_id) < ($3::timestamptz, $4::uuid)` : '';
    const params = cursor ? [tenant_id, subject_id, cursor.iso, cursor.id] : [tenant_id, subject_id];

    const sql = `
      WITH events AS (
        SELECT 'encounter'::text AS event_type, e.id AS event_id, e.created_at AS event_at,
               jsonb_build_object(
                 'id', e.id,
                 'encounter_type', e.encounter_type,
                 'chief_complaint', e.chief_complaint,
                 'professional_user_id', e.professional_user_id,
                 'signed_at', e.signed_at
               ) AS payload
        FROM clinical_encounters e
        WHERE e.tenant_id = $1 AND e.subject_id = $2

        UNION ALL

        SELECT 'exam'::text, ex.id, ex.created_at,
               jsonb_build_object(
                 'id', ex.id,
                 'status', ex.status,
                 'file_type', ex.file_type,
                 'file_path', ex.file_path
               )
        FROM exams ex
        WHERE ex.tenant_id = $1 AND ex.subject_id = $2

        UNION ALL

        SELECT 'prescription'::text, p.id, p.created_at,
               jsonb_build_object(
                 'id', p.id,
                 'created_by', p.created_by,
                 'exam_id', p.exam_id,
                 'agent_type', p.agent_type,
                 'item_count', COALESCE(jsonb_array_length(p.items), 0)
               )
        FROM prescriptions p
        WHERE p.tenant_id = $1 AND p.subject_id = $2

        UNION ALL

        SELECT 'ai_analysis'::text, cr.id, cr.created_at,
               jsonb_build_object(
                 'id', cr.id,
                 'agent_type', cr.agent_type,
                 'exam_id', cr.exam_id,
                 'risk_scores', cr.risk_scores
               )
        FROM clinical_results cr
        JOIN exams ex_cr ON ex_cr.id = cr.exam_id
        WHERE cr.tenant_id = $1 AND ex_cr.subject_id = $2
      )
      SELECT * FROM events
      WHERE 1=1 ${cursorClause}
      ORDER BY event_at DESC, event_id DESC
      LIMIT ${limit + 1}
    `;

    const rows = await withTenant(fastify.pg, tenant_id, async (client) => {
      const r = await client.query(sql, params);
      return r.rows;
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? Buffer.from(`${new Date(items[items.length - 1].event_at).toISOString()}|${items[items.length - 1].event_id}`).toString('base64')
      : null;

    return { items, next_cursor: nextCursor, has_more: hasMore };
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
         WHERE tp.subject_id = $1 AND tp.tenant_id = $2
         GROUP BY tp.id
         ORDER BY tp.created_at DESC`,
        [id, tenant_id]
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
         WHERE id = $4 AND tenant_id = $5
         RETURNING *`,
        [status, title, description, plan_id, tenant_id]
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
         WHERE tp.id = $1 AND tp.tenant_id = $2
         GROUP BY tp.id`,
        [plan_id, tenant_id]
      );
      return rows[0] || null;
    });
    if (!plan) return reply.status(404).send({ error: 'Treatment plan not found' });
    return plan;
  });

  // ─── AI Suggestions (4.3) ─────────────────────────────────────────────
  // GET /:id/ai-suggestions — retorna cache (ou null se nunca gerado)
  fastify.get('/:id/ai-suggestions', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id: subject_id } = request.params;
    const cached = await withTenant(fastify.pg, tenant_id, async (client) =>
      aiSuggestions.getCached(client, { tenant_id, subject_id })
    , { userId: user_id, channel: 'ui' });
    if (!cached) return { cached: null };
    const expired = new Date(cached.expires_at) < new Date();
    return { cached, expired };
  });

  // POST /:id/ai-suggestions/refresh — gera (ou regenera) sugestões.
  // Qualquer profissional autenticado do tenant pode pedir refresh — RLS
  // protege dados. Antes era admin-only por engano (clínica com múltiplos
  // médicos não conseguia regerar pra próprios pacientes).
  fastify.post('/:id/ai-suggestions/refresh', {
    preHandler: [fastify.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id: subject_id } = request.params;
    try {
      const result = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows: tRows } = await client.query(`SELECT module FROM tenants WHERE id = $1`, [tenant_id]);
        const moduleName = tRows[0]?.module || 'human';
        return aiSuggestions.refreshSuggestions(client, {
          tenant_id, subject_id, user_id, module: moduleName,
        });
      }, { userId: user_id, channel: 'ui' });

      // Debita 1 crédito por refresh (cache 24h ameniza recorrência).
      // Best-effort — não derruba a request se billing falhar.
      try {
        await fastify.pg.query(
          `INSERT INTO credit_ledger (tenant_id, amount, kind, description)
           VALUES ($1, -1, 'ai_suggestion', 'Sugestões pró-ativas IA (paciente)')`,
          [tenant_id]
        );
      } catch (billingErr) {
        request.log.warn({ err: billingErr.message }, 'ai_suggestion: billing debit failed');
      }

      return result;
    } catch (err) {
      if (err.code === 'NOT_FOUND') return reply.status(404).send({ error: 'subject not found' });
      if (err.code === 'BAD_LLM_OUTPUT') {
        request.log.error({ err: err.message, raw: err.raw }, 'AI suggestions: bad LLM output');
        return reply.status(502).send({ error: 'IA retornou resposta inválida. Tente novamente.' });
      }
      throw err;
    }
  });

  // POST /:id/ai-suggestions/dismiss — marca uma sugestão como descartada
  fastify.post('/:id/ai-suggestions/dismiss', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id: subject_id } = request.params;
    const { suggestion_id } = request.body || {};
    if (!suggestion_id || typeof suggestion_id !== 'string') {
      return reply.status(400).send({ error: 'suggestion_id obrigatório' });
    }
    const updated = await withTenant(fastify.pg, tenant_id, async (client) =>
      aiSuggestions.dismissSuggestion(client, { tenant_id, subject_id, suggestion_id })
    , { userId: user_id, channel: 'ui' });
    if (!updated) return reply.status(404).send({ error: 'cache not found' });
    return updated;
  });
};
