'use strict';

/**
 * Prontuário clínico — encontros (consultas/evoluções) com sinais vitais.
 *
 * Spec: docs/superpowers/specs/2026-05-05-clinical-pms-expansion-design.md
 *
 * Endpoints (todos preHandler: [fastify.authenticate]):
 *   POST   /encounters                              cria encontro + vital signs
 *   GET    /encounters?subject_id=&cursor=&limit=  lista encontros do paciente (cursor pagination)
 *   GET    /encounters/:id                          detalhe completo
 *   PATCH  /encounters/:id                          atualiza (24h após criar OU se assinado = 409)
 *   POST   /encounters/:id/sign                     assina, vira imutável
 *   GET    /subjects/:id/timeline?cursor=&limit=    timeline unificada (encontros+exames+prescr+análises)
 *
 * Decisões 2026-05-05 (autorizado pelo usuário, sem aprovação prévia):
 *   - 24h pra autor editar; depois 409, força adendo (cliente cria novo encounter_type='retorno')
 *   - signed_at = imutável (qualquer PATCH retorna 409)
 *   - Profissional vê encontros de qualquer profissional do mesmo tenant (clínica colaborativa)
 *   - Cross-module fields (medical_history em vet, hydration em human) → 400
 */

const { withTenant } = require('../db/tenant');
const copilot = require('../services/encounter-copilot');

const VALID_ENCOUNTER_TYPES = ['consulta', 'retorno', 'evolucao', 'procedimento', 'telemedicina', 'outro'];
const VALID_HYDRATION = ['normal', 'leve', 'moderada', 'severa'];
const VALID_MUCOSA = ['normocoradas', 'hipocoradas', 'cianoticas', 'ictericas', 'congestas'];

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

const HUMAN_ONLY_ENCOUNTER_FIELDS = ['medical_history', 'medications_in_use', 'allergies'];
const VET_ONLY_VITAL_FIELDS = ['hydration', 'mucosa'];
const HUMAN_ONLY_VITAL_FIELDS = ['blood_pressure_systolic', 'blood_pressure_diastolic'];

// ── Validators ────────────────────────────────────────────────────────────

function validateEncounterBody(body, module, isUpdate = false) {
  if (!body || typeof body !== 'object') return 'body inválido';

  if (!isUpdate) {
    if (!body.subject_id || typeof body.subject_id !== 'string') {
      return 'subject_id obrigatório';
    }
  }

  if (body.encounter_type !== undefined) {
    if (!VALID_ENCOUNTER_TYPES.includes(body.encounter_type)) {
      return `encounter_type inválido (use: ${VALID_ENCOUNTER_TYPES.join(', ')})`;
    }
  }

  // Cross-module strict equality: rejeita campos do outro módulo
  if (module === 'veterinary') {
    for (const f of HUMAN_ONLY_ENCOUNTER_FIELDS) {
      if (body[f] !== undefined && body[f] !== null && body[f] !== '') {
        return `campo "${f}" não disponível em módulo veterinário`;
      }
    }
  }

  if (body.appointment_id !== undefined && body.appointment_id !== null) {
    if (typeof body.appointment_id !== 'string') return 'appointment_id deve ser uuid string ou null';
  }

  if (body.related_aesthetic_analysis_id !== undefined && body.related_aesthetic_analysis_id !== null) {
    if (typeof body.related_aesthetic_analysis_id !== 'string') {
      return 'related_aesthetic_analysis_id deve ser uuid string ou null';
    }
  }

  // Strings textuais — limita tamanho razoável
  for (const f of ['chief_complaint', 'anamnesis', 'physical_exam', 'hypothesis', 'conduct',
                   'return_recommendation', 'medical_history', 'medications_in_use', 'allergies']) {
    if (body[f] !== undefined && body[f] !== null) {
      if (typeof body[f] !== 'string') return `${f} deve ser string`;
      if (body[f].length > 20000) return `${f} excede 20.000 caracteres`;
    }
  }

  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments)) return 'attachments deve ser array';
    if (body.attachments.length > 20) return 'attachments: máximo 20';
    for (const att of body.attachments) {
      if (!att || typeof att !== 'object') return 'attachment inválido';
      if (typeof att.filename !== 'string' || typeof att.s3_key !== 'string' || typeof att.mime !== 'string') {
        return 'attachment requer filename, s3_key, mime';
      }
    }
  }

  return null;
}

function validateVitalSigns(vs, module) {
  if (vs === undefined || vs === null) return null;
  if (typeof vs !== 'object' || Array.isArray(vs)) return 'vital_signs deve ser objeto';

  // Cross-module strict
  if (module === 'human') {
    for (const f of VET_ONLY_VITAL_FIELDS) {
      if (vs[f] !== undefined && vs[f] !== null && vs[f] !== '') {
        return `vital_signs.${f} não disponível em módulo humano`;
      }
    }
  } else if (module === 'veterinary') {
    for (const f of HUMAN_ONLY_VITAL_FIELDS) {
      if (vs[f] !== undefined && vs[f] !== null) {
        return `vital_signs.${f} não disponível em módulo veterinário`;
      }
    }
  }

  // Numeric range checks
  if (vs.weight_kg !== undefined && vs.weight_kg !== null) {
    if (typeof vs.weight_kg !== 'number' || vs.weight_kg < 0 || vs.weight_kg > 2000) {
      return 'weight_kg fora do range 0–2000';
    }
  }
  if (vs.temperature_c !== undefined && vs.temperature_c !== null) {
    if (typeof vs.temperature_c !== 'number' || vs.temperature_c < 25 || vs.temperature_c > 45) {
      return 'temperature_c fora do range 25–45';
    }
  }
  if (vs.heart_rate_bpm !== undefined && vs.heart_rate_bpm !== null) {
    if (!Number.isInteger(vs.heart_rate_bpm) || vs.heart_rate_bpm < 0 || vs.heart_rate_bpm > 400) {
      return 'heart_rate_bpm fora do range 0–400';
    }
  }
  if (vs.respiratory_rate_rpm !== undefined && vs.respiratory_rate_rpm !== null) {
    if (!Number.isInteger(vs.respiratory_rate_rpm) || vs.respiratory_rate_rpm < 0 || vs.respiratory_rate_rpm > 200) {
      return 'respiratory_rate_rpm fora do range 0–200';
    }
  }
  if (vs.pain_score !== undefined && vs.pain_score !== null) {
    if (!Number.isInteger(vs.pain_score) || vs.pain_score < 0 || vs.pain_score > 10) {
      return 'pain_score deve ser inteiro 0–10';
    }
  }
  if (vs.blood_pressure_systolic !== undefined && vs.blood_pressure_systolic !== null) {
    if (!Number.isInteger(vs.blood_pressure_systolic) || vs.blood_pressure_systolic < 30 || vs.blood_pressure_systolic > 300) {
      return 'blood_pressure_systolic fora do range 30–300';
    }
  }
  if (vs.blood_pressure_diastolic !== undefined && vs.blood_pressure_diastolic !== null) {
    if (!Number.isInteger(vs.blood_pressure_diastolic) || vs.blood_pressure_diastolic < 20 || vs.blood_pressure_diastolic > 200) {
      return 'blood_pressure_diastolic fora do range 20–200';
    }
  }
  if (vs.hydration !== undefined && vs.hydration !== null) {
    if (!VALID_HYDRATION.includes(vs.hydration)) return `hydration inválido (use: ${VALID_HYDRATION.join(', ')})`;
  }
  if (vs.mucosa !== undefined && vs.mucosa !== null) {
    if (!VALID_MUCOSA.includes(vs.mucosa)) return `mucosa inválido (use: ${VALID_MUCOSA.join(', ')})`;
  }

  return null;
}

// ── Cursor helpers ────────────────────────────────────────────────────────

// Cursor é base64 de "ISOdate|uuid". Sem JSON pra menos overhead.
function encodeCursor(createdAt, id) {
  return Buffer.from(`${new Date(createdAt).toISOString()}|${id}`).toString('base64');
}
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const [iso, id] = decoded.split('|');
    if (!iso || !id) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    if (!/^[0-9a-f]{8}-/i.test(id)) return null;
    return { createdAt: d.toISOString(), id };
  } catch {
    return null;
  }
}

function clampLimit(raw, def = 50, max = 200) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

// ── Module ────────────────────────────────────────────────────────────────

module.exports = async function (fastify) {

  // POST /encounters
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, module } = request.user;
    const body = request.body || {};

    const err = validateEncounterBody(body, module, false);
    if (err) return reply.status(400).send({ error: err });

    const vs = body.vital_signs;
    const vsErr = validateVitalSigns(vs, module);
    if (vsErr) return reply.status(400).send({ error: vsErr });

    try {
      const result = await withTenant(fastify.pg, tenant_id, async (client) => {
        // Subject existe + mesmo tenant
        const { rows: subRows } = await client.query(
          `SELECT id FROM subjects WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          [body.subject_id, tenant_id]
        );
        if (subRows.length === 0) {
          const e = new Error('subject_invalid'); e.code = 'SUBJECT_INVALID'; throw e;
        }

        // Appointment se passado, valida tenant
        if (body.appointment_id) {
          const { rows: apRows } = await client.query(
            `SELECT id FROM appointments WHERE id = $1 AND tenant_id = $2`,
            [body.appointment_id, tenant_id]
          );
          if (apRows.length === 0) {
            const e = new Error('appointment_invalid'); e.code = 'APPOINTMENT_INVALID'; throw e;
          }
        }

        // Aesthetic analysis link — valida existência + tenant + mesmo subject
        if (body.related_aesthetic_analysis_id) {
          const { rows: aaRows } = await client.query(
            `SELECT id FROM aesthetic_analyses
             WHERE id = $1 AND tenant_id = $2 AND subject_id = $3 AND deleted_at IS NULL`,
            [body.related_aesthetic_analysis_id, tenant_id, body.subject_id]
          );
          if (aaRows.length === 0) {
            const e = new Error('invalid_aesthetic_link'); e.code = 'INVALID_AESTHETIC_LINK'; throw e;
          }
        }

        const { rows: encRows } = await client.query(
          `INSERT INTO clinical_encounters (
            tenant_id, subject_id, professional_user_id, appointment_id, encounter_type,
            chief_complaint, anamnesis, physical_exam, hypothesis, conduct, return_recommendation,
            medical_history, medications_in_use, allergies,
            attachments, related_aesthetic_analysis_id
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11,
            $12, $13, $14,
            $15::jsonb, $16
          ) RETURNING *`,
          [
            tenant_id, body.subject_id, user_id, body.appointment_id || null,
            body.encounter_type || 'consulta',
            body.chief_complaint || null, body.anamnesis || null, body.physical_exam || null,
            body.hypothesis || null, body.conduct || null, body.return_recommendation || null,
            body.medical_history || null, body.medications_in_use || null, body.allergies || null,
            JSON.stringify(body.attachments || []),
            body.related_aesthetic_analysis_id || null,
          ]
        );
        const encounter = encRows[0];

        // Vital signs (1:1) — só insere se algum campo estiver presente
        let vitalSigns = null;
        if (vs && Object.keys(vs).some(k => vs[k] !== undefined && vs[k] !== null && vs[k] !== '')) {
          const { rows: vsRows } = await client.query(
            `INSERT INTO vital_signs (
              tenant_id, encounter_id, subject_id,
              weight_kg, temperature_c, heart_rate_bpm, respiratory_rate_rpm, pain_score,
              blood_pressure_systolic, blood_pressure_diastolic,
              hydration, mucosa, notes
            ) VALUES (
              $1, $2, $3,
              $4, $5, $6, $7, $8,
              $9, $10,
              $11, $12, $13
            ) RETURNING *`,
            [
              tenant_id, encounter.id, body.subject_id,
              vs.weight_kg ?? null, vs.temperature_c ?? null, vs.heart_rate_bpm ?? null,
              vs.respiratory_rate_rpm ?? null, vs.pain_score ?? null,
              vs.blood_pressure_systolic ?? null, vs.blood_pressure_diastolic ?? null,
              vs.hydration || null, vs.mucosa || null, vs.notes || null,
            ]
          );
          vitalSigns = vsRows[0];

          // Snapshot de peso atual no subject (vet usa, humano também útil)
          if (vs.weight_kg) {
            await client.query(
              `UPDATE subjects SET current_weight_kg = $1 WHERE id = $2 AND tenant_id = $3`,
              [vs.weight_kg, body.subject_id, tenant_id]
            );
          }
        }

        return { ...encounter, vital_signs: vitalSigns };
      }, { userId: user_id, channel: 'ui' });

      return reply.status(201).send(result);
    } catch (err) {
      if (err.code === 'SUBJECT_INVALID') return reply.status(400).send({ error: 'subject_id inválido' });
      if (err.code === 'APPOINTMENT_INVALID') return reply.status(400).send({ error: 'appointment_id inválido' });
      if (err.code === 'INVALID_AESTHETIC_LINK') return reply.status(400).send({ error: 'INVALID_AESTHETIC_LINK', message: 'Análise estética não encontrada ou não pertence ao paciente' });
      throw err;
    }
  });

  // GET /encounters?subject_id=...&cursor=...&limit=
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { subject_id, cursor: rawCursor } = request.query || {};
    const limit = clampLimit(request.query?.limit);

    if (!subject_id || typeof subject_id !== 'string') {
      return reply.status(400).send({ error: 'subject_id obrigatório' });
    }

    const cursor = decodeCursor(rawCursor);
    let sql = `
      SELECT e.*,
             u.email AS professional_email,
             vs.weight_kg, vs.temperature_c, vs.heart_rate_bpm, vs.respiratory_rate_rpm,
             vs.pain_score, vs.blood_pressure_systolic, vs.blood_pressure_diastolic,
             vs.hydration, vs.mucosa, vs.notes AS vs_notes
      FROM clinical_encounters e
      LEFT JOIN users u ON u.id = e.professional_user_id
      LEFT JOIN vital_signs vs ON vs.encounter_id = e.id
      WHERE e.tenant_id = $1 AND e.subject_id = $2
    `;
    const params = [tenant_id, subject_id];
    if (cursor) {
      sql += ` AND (e.created_at, e.id) < ($3::timestamptz, $4::uuid)`;
      params.push(cursor.createdAt, cursor.id);
    }
    sql += ` ORDER BY e.created_at DESC, e.id DESC LIMIT ${limit + 1}`;

    const { rows } = await fastify.pg.query(sql, params);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeCursor(items[items.length - 1].created_at, items[items.length - 1].id) : null;

    return { items, next_cursor: nextCursor, has_more: hasMore };
  });

  // GET /encounters/:id
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const { rows } = await fastify.pg.query(
      `SELECT e.*,
              u.email AS professional_email,
              vs.id AS vital_signs_id, vs.weight_kg, vs.temperature_c, vs.heart_rate_bpm,
              vs.respiratory_rate_rpm, vs.pain_score, vs.blood_pressure_systolic,
              vs.blood_pressure_diastolic, vs.hydration, vs.mucosa, vs.notes AS vs_notes
       FROM clinical_encounters e
       LEFT JOIN users u ON u.id = e.professional_user_id
       LEFT JOIN vital_signs vs ON vs.encounter_id = e.id
       WHERE e.id = $1 AND e.tenant_id = $2`,
      [id, tenant_id]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'encounter not found' });
    return rows[0];
  });

  // PATCH /encounters/:id
  fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, module } = request.user;
    const { id } = request.params;
    const body = request.body || {};

    const err = validateEncounterBody(body, module, true);
    if (err) return reply.status(400).send({ error: err });

    if (body.vital_signs !== undefined) {
      const vsErr = validateVitalSigns(body.vital_signs, module);
      if (vsErr) return reply.status(400).send({ error: vsErr });
    }

    try {
      const result = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows: existing } = await client.query(
          `SELECT id, professional_user_id, signed_at, created_at
           FROM clinical_encounters WHERE id = $1 AND tenant_id = $2`,
          [id, tenant_id]
        );
        if (existing.length === 0) {
          const e = new Error('not_found'); e.code = 'NOT_FOUND'; throw e;
        }
        const enc = existing[0];

        if (enc.signed_at) {
          const e = new Error('signed_immutable'); e.code = 'SIGNED'; throw e;
        }

        // Só autor pode editar
        if (enc.professional_user_id !== user_id) {
          const e = new Error('forbidden_other_author'); e.code = 'FORBIDDEN_AUTHOR'; throw e;
        }

        // 24h após criação
        const ageMs = Date.now() - new Date(enc.created_at).getTime();
        if (ageMs > EDIT_WINDOW_MS) {
          const e = new Error('edit_window_expired'); e.code = 'EDIT_WINDOW'; throw e;
        }

        // Aesthetic analysis link update — valida se passado
        if (body.related_aesthetic_analysis_id) {
          // Need subject_id of existing encounter for validation
          const { rows: encSubRows } = await client.query(
            `SELECT subject_id FROM clinical_encounters WHERE id = $1 AND tenant_id = $2`,
            [id, tenant_id]
          );
          const subjectId = encSubRows[0]?.subject_id;
          const { rows: aaCheckRows } = await client.query(
            `SELECT id FROM aesthetic_analyses
             WHERE id = $1 AND tenant_id = $2 AND subject_id = $3 AND deleted_at IS NULL`,
            [body.related_aesthetic_analysis_id, tenant_id, subjectId]
          );
          if (aaCheckRows.length === 0) {
            const e = new Error('invalid_aesthetic_link'); e.code = 'INVALID_AESTHETIC_LINK'; throw e;
          }
        }

        // Update encounter fields
        const setParts = [];
        const values = [];
        let i = 1;
        const updatable = [
          'encounter_type', 'chief_complaint', 'anamnesis', 'physical_exam', 'hypothesis',
          'conduct', 'return_recommendation', 'medical_history', 'medications_in_use', 'allergies',
        ];
        for (const f of updatable) {
          if (body[f] !== undefined) {
            setParts.push(`${f} = $${i++}`);
            values.push(body[f]);
          }
        }
        if (body.attachments !== undefined) {
          setParts.push(`attachments = $${i++}::jsonb`);
          values.push(JSON.stringify(body.attachments));
        }
        if (body.related_aesthetic_analysis_id !== undefined) {
          setParts.push(`related_aesthetic_analysis_id = $${i++}`);
          values.push(body.related_aesthetic_analysis_id);
        }
        if (setParts.length > 0) {
          values.push(id, tenant_id);
          await client.query(
            `UPDATE clinical_encounters SET ${setParts.join(', ')}
             WHERE id = $${i++} AND tenant_id = $${i++}`,
            values
          );
        }

        // Update vital signs (UPSERT — se não tinha, cria)
        if (body.vital_signs !== undefined) {
          const vs = body.vital_signs;
          // Pega subject_id do encounter pra inserir VS
          const { rows: encRows } = await client.query(
            `SELECT subject_id FROM clinical_encounters WHERE id = $1`, [id]
          );
          const subject_id = encRows[0].subject_id;

          await client.query(
            `INSERT INTO vital_signs (
              tenant_id, encounter_id, subject_id,
              weight_kg, temperature_c, heart_rate_bpm, respiratory_rate_rpm, pain_score,
              blood_pressure_systolic, blood_pressure_diastolic,
              hydration, mucosa, notes
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT (encounter_id) DO UPDATE SET
              weight_kg = EXCLUDED.weight_kg,
              temperature_c = EXCLUDED.temperature_c,
              heart_rate_bpm = EXCLUDED.heart_rate_bpm,
              respiratory_rate_rpm = EXCLUDED.respiratory_rate_rpm,
              pain_score = EXCLUDED.pain_score,
              blood_pressure_systolic = EXCLUDED.blood_pressure_systolic,
              blood_pressure_diastolic = EXCLUDED.blood_pressure_diastolic,
              hydration = EXCLUDED.hydration,
              mucosa = EXCLUDED.mucosa,
              notes = EXCLUDED.notes`,
            [
              tenant_id, id, subject_id,
              vs.weight_kg ?? null, vs.temperature_c ?? null, vs.heart_rate_bpm ?? null,
              vs.respiratory_rate_rpm ?? null, vs.pain_score ?? null,
              vs.blood_pressure_systolic ?? null, vs.blood_pressure_diastolic ?? null,
              vs.hydration || null, vs.mucosa || null, vs.notes || null,
            ]
          );

          if (vs.weight_kg) {
            await client.query(
              `UPDATE subjects SET current_weight_kg = $1 WHERE id = $2 AND tenant_id = $3`,
              [vs.weight_kg, subject_id, tenant_id]
            );
          }
        }

        const { rows: updated } = await client.query(
          `SELECT e.*,
                  vs.weight_kg, vs.temperature_c, vs.heart_rate_bpm, vs.respiratory_rate_rpm,
                  vs.pain_score, vs.blood_pressure_systolic, vs.blood_pressure_diastolic,
                  vs.hydration, vs.mucosa, vs.notes AS vs_notes
           FROM clinical_encounters e
           LEFT JOIN vital_signs vs ON vs.encounter_id = e.id
           WHERE e.id = $1`,
          [id]
        );
        return updated[0];
      }, { userId: user_id, channel: 'ui' });

      return result;
    } catch (err) {
      if (err.code === 'NOT_FOUND') return reply.status(404).send({ error: 'encounter not found' });
      if (err.code === 'SIGNED') return reply.status(409).send({ error: 'encontro assinado é imutável' });
      if (err.code === 'FORBIDDEN_AUTHOR') return reply.status(403).send({ error: 'apenas o autor pode editar este encontro' });
      if (err.code === 'EDIT_WINDOW') return reply.status(409).send({ error: 'janela de edição expirou (24h). Crie um adendo (encounter_type=retorno).' });
      if (err.code === 'INVALID_AESTHETIC_LINK') return reply.status(400).send({ error: 'INVALID_AESTHETIC_LINK', message: 'Análise estética não encontrada ou não pertence ao paciente' });
      throw err;
    }
  });

  // POST /encounters/:id/sign
  fastify.post('/:id/sign', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;

    try {
      const result = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows: existing } = await client.query(
          `SELECT id, professional_user_id, signed_at FROM clinical_encounters
           WHERE id = $1 AND tenant_id = $2`,
          [id, tenant_id]
        );
        if (existing.length === 0) {
          const e = new Error('not_found'); e.code = 'NOT_FOUND'; throw e;
        }
        if (existing[0].signed_at) {
          const e = new Error('already_signed'); e.code = 'ALREADY_SIGNED'; throw e;
        }
        if (existing[0].professional_user_id !== user_id) {
          const e = new Error('forbidden'); e.code = 'FORBIDDEN'; throw e;
        }

        const { rows } = await client.query(
          `UPDATE clinical_encounters
           SET signed_at = NOW(), signed_by_user_id = $1
           WHERE id = $2 AND tenant_id = $3
           RETURNING *`,
          [user_id, id, tenant_id]
        );
        return rows[0];
      }, { userId: user_id, channel: 'ui' });

      return result;
    } catch (err) {
      if (err.code === 'NOT_FOUND') return reply.status(404).send({ error: 'encounter not found' });
      if (err.code === 'ALREADY_SIGNED') return reply.status(409).send({ error: 'encontro já assinado' });
      if (err.code === 'FORBIDDEN') return reply.status(403).send({ error: 'apenas o autor pode assinar' });
      throw err;
    }
  });

  // POST /encounters/copilot — IA analisa rascunho do prontuário e sugere
  // hipóteses + exames + red flags (4.4). Não persiste — só análise on-demand.
  fastify.post('/copilot', {
    preHandler: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { subject_id, chief_complaint, anamnesis, physical_exam, hypothesis, vital_signs } = request.body || {};
    if (!subject_id || typeof subject_id !== 'string') {
      return reply.status(400).send({ error: 'subject_id obrigatório' });
    }

    // Pega contexto demográfico mínimo do paciente (idade + sexo + species + módulo)
    const ctx = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT s.subject_type, s.sex, s.species, s.birth_date, t.module
         FROM subjects s JOIN tenants t ON t.id = s.tenant_id
         WHERE s.id = $1 AND s.tenant_id = $2 AND s.deleted_at IS NULL`,
        [subject_id, tenant_id]
      );
      return rows[0] || null;
    });
    if (!ctx) return reply.status(404).send({ error: 'subject not found' });

    let age_years = null;
    if (ctx.birth_date) {
      const ms = Date.now() - new Date(ctx.birth_date).getTime();
      age_years = Math.floor(ms / (365.25 * 24 * 3600 * 1000));
    }

    try {
      const result = await copilot.analyze({
        module: ctx.module || 'human',
        species: ctx.species,
        age_years,
        sex: ctx.sex,
        chief_complaint, anamnesis, physical_exam, hypothesis, vital_signs,
      });

      // Debita 0.5 crédito por análise (custo intermediário entre chat 0.25
      // e ai_suggestion 1.0 — co-piloto pode ser usado várias vezes durante
      // construção do prontuário). Best-effort.
      try {
        await fastify.pg.query(
          `INSERT INTO credit_ledger (tenant_id, amount, kind, description)
           VALUES ($1, -0.5, 'encounter_copilot', 'Co-piloto IA durante consulta')`,
          [tenant_id]
        );
      } catch (billingErr) {
        request.log.warn({ err: billingErr.message }, 'encounter_copilot: billing debit failed');
      }

      return result;
    } catch (err) {
      if (err.code === 'INPUT_TOO_SHORT') {
        return reply.status(400).send({
          error: `Preencha mais campos antes de pedir análise (mínimo ${err.minChars} caracteres totais).`,
          code: 'INPUT_TOO_SHORT',
        });
      }
      if (err.code === 'BAD_LLM_OUTPUT') {
        request.log.error({ err: err.message, raw: err.raw }, 'Copilot: bad LLM output');
        return reply.status(502).send({ error: 'IA retornou resposta inválida. Tente novamente.' });
      }
      throw err;
    }
  });
};
