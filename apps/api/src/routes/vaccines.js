'use strict';

/**
 * Vacinas (módulo veterinário).
 *
 * Spec: docs/superpowers/specs/2026-05-05-clinical-pms-expansion-design.md
 *
 * Endpoints (todos preHandler: [fastify.authenticate]):
 *   GET    /vaccines/protocols?species=          lista protocolos (globais + tenant)
 *   POST   /vaccines/protocols                    cria protocolo customizado do tenant
 *   PUT    /vaccines/protocols/:id                edita protocolo do tenant
 *   DELETE /vaccines/protocols/:id                deleta protocolo do tenant (não global)
 *
 *   GET    /vaccines?subject_id=                  lista vacinas do animal
 *   POST   /vaccines                              registra vacina aplicada
 *   GET    /vaccines/:id                          detalhe
 *   PATCH  /vaccines/:id                          atualiza
 *   DELETE /vaccines/:id                          remove (com audit)
 *
 *   GET    /vaccines/upcoming?days=30             vacinas próximas (next_dose_date entre hoje e hoje+N)
 *   GET    /vaccines/overdue                      vacinas vencidas (next_dose_date < hoje)
 *
 * Decisão Fase 2: vacinas é vet-only via gating de UI (`tenant.module=veterinary`
 * mostra a aba). Backend não rejeita por módulo — subject pode ser humano teoricamente,
 * mas frontend não expõe. Vacinas humano (pediátrica/COVID) ficam Fase 4+.
 */

const { withTenant } = require('../db/tenant');

const VALID_SPECIES = ['dog', 'cat', 'equine', 'bovine', 'bird', 'reptile', 'other'];

// ── Validators ────────────────────────────────────────────────────────────

function validateProtocolBody(body, isUpdate = false) {
  if (!body || typeof body !== 'object') return 'body inválido';
  if (!isUpdate && !body.species) return 'species obrigatório';
  if (body.species && !VALID_SPECIES.includes(body.species)) {
    return `species inválido (use: ${VALID_SPECIES.join(', ')})`;
  }
  if (!isUpdate && (!body.name || typeof body.name !== 'string' || !body.name.trim())) {
    return 'name obrigatório';
  }
  if (body.name && body.name.length > 200) return 'name excede 200 chars';
  if (body.description && body.description.length > 2000) return 'description excede 2000 chars';
  if (body.doses !== undefined) {
    if (!Array.isArray(body.doses)) return 'doses deve ser array';
    if (body.doses.length > 20) return 'doses: máximo 20';
    for (const d of body.doses) {
      if (!d || typeof d !== 'object') return 'dose inválida';
      if (typeof d.label !== 'string') return 'dose.label obrigatório';
      if (d.age_min_days !== undefined && (!Number.isInteger(d.age_min_days) || d.age_min_days < 0 || d.age_min_days > 36500)) {
        return 'dose.age_min_days fora do range';
      }
      if (d.age_max_days !== undefined && (!Number.isInteger(d.age_max_days) || d.age_max_days < 0 || d.age_max_days > 36500)) {
        return 'dose.age_max_days fora do range';
      }
    }
  }
  return null;
}

function validateVaccineBody(body, isUpdate = false) {
  if (!body || typeof body !== 'object') return 'body inválido';
  if (!isUpdate) {
    if (!body.subject_id) return 'subject_id obrigatório';
    if (!body.vaccine_name || typeof body.vaccine_name !== 'string' || !body.vaccine_name.trim()) {
      return 'vaccine_name obrigatório';
    }
    if (!body.applied_at) return 'applied_at obrigatório (YYYY-MM-DD)';
  }
  if (body.vaccine_name && body.vaccine_name.length > 200) return 'vaccine_name excede 200 chars';
  if (body.manufacturer && body.manufacturer.length > 200) return 'manufacturer excede 200 chars';
  if (body.lot_number && body.lot_number.length > 100) return 'lot_number excede 100 chars';
  if (body.notes && body.notes.length > 5000) return 'notes excede 5000 chars';

  if (body.applied_at !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.applied_at)) return 'applied_at deve ser YYYY-MM-DD';
  }
  if (body.next_dose_date !== undefined && body.next_dose_date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.next_dose_date)) return 'next_dose_date deve ser YYYY-MM-DD';
  }
  if (body.protocol_dose_index !== undefined && body.protocol_dose_index !== null) {
    if (!Number.isInteger(body.protocol_dose_index) || body.protocol_dose_index < 0 || body.protocol_dose_index > 50) {
      return 'protocol_dose_index inválido';
    }
  }
  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments)) return 'attachments deve ser array';
    if (body.attachments.length > 10) return 'attachments: máximo 10';
  }
  return null;
}

// ── Module ────────────────────────────────────────────────────────────────

module.exports = async function (fastify) {

  // ─── Protocols ───────────────────────────────────────────────────────

  fastify.get('/protocols', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    const { species } = request.query || {};

    let sql = `
      SELECT id, tenant_id, species, name, description, doses, active, created_at, updated_at
      FROM vaccine_protocols
      WHERE active = TRUE
        AND (tenant_id IS NULL OR tenant_id = $1)
    `;
    const params = [tenant_id];
    if (species && VALID_SPECIES.includes(species)) {
      sql += ` AND species = $2`;
      params.push(species);
    }
    sql += ` ORDER BY tenant_id NULLS LAST, species, name`;
    const { rows } = await fastify.pg.query(sql, params);
    return { items: rows };
  });

  fastify.post('/protocols', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, role } = request.user;
    if (role !== 'admin' && role !== 'master') {
      return reply.status(403).send({ error: 'Apenas admin pode criar protocolos' });
    }
    const err = validateProtocolBody(request.body || {}, false);
    if (err) return reply.status(400).send({ error: err });
    const { species, name, description, doses } = request.body;

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO vaccine_protocols (tenant_id, species, name, description, doses)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING *`,
        [tenant_id, species, name.trim(), description || null, JSON.stringify(doses || [])]
      );
      return rows[0];
    }, { userId: user_id, channel: 'ui' });
    return reply.status(201).send(result);
  });

  fastify.put('/protocols/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, role } = request.user;
    if (role !== 'admin' && role !== 'master') return reply.status(403).send({ error: 'Apenas admin' });
    const { id } = request.params;
    const err = validateProtocolBody(request.body || {}, true);
    if (err) return reply.status(400).send({ error: err });
    const body = request.body || {};

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE vaccine_protocols SET
           name        = COALESCE($1, name),
           description = COALESCE($2, description),
           doses       = COALESCE($3::jsonb, doses),
           active      = COALESCE($4, active)
         WHERE id = $5 AND tenant_id = $6
         RETURNING *`,
        [body.name?.trim() ?? null, body.description ?? null,
         body.doses ? JSON.stringify(body.doses) : null,
         body.active ?? null, id, tenant_id]
      );
      return rows[0] || null;
    }, { userId: user_id, channel: 'ui' });

    if (!result) return reply.status(404).send({ error: 'Protocolo não encontrado ou é global (não editável)' });
    return result;
  });

  fastify.delete('/protocols/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, role } = request.user;
    if (role !== 'admin' && role !== 'master') return reply.status(403).send({ error: 'Apenas admin' });
    const { id } = request.params;

    const deleted = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `DELETE FROM vaccine_protocols WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenant_id]
      );
      return rows[0] || null;
    }, { userId: user_id, channel: 'ui' });

    if (!deleted) return reply.status(404).send({ error: 'Protocolo não encontrado ou é global (não removível)' });
    return reply.status(204).send();
  });

  // ─── Vaccines ────────────────────────────────────────────────────────

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { subject_id } = request.query || {};
    if (!subject_id || typeof subject_id !== 'string') {
      return reply.status(400).send({ error: 'subject_id obrigatório' });
    }

    const { rows } = await fastify.pg.query(
      `SELECT v.*,
              u.email AS professional_email,
              vp.name AS protocol_name, vp.species AS protocol_species
       FROM vaccines v
       LEFT JOIN users u ON u.id = v.professional_user_id
       LEFT JOIN vaccine_protocols vp ON vp.id = v.protocol_id
       WHERE v.tenant_id = $1 AND v.subject_id = $2
       ORDER BY v.applied_at DESC, v.id DESC
       LIMIT 200`,
      [tenant_id, subject_id]
    );
    return { items: rows };
  });

  fastify.get('/upcoming', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    const days = Math.min(180, Math.max(1, parseInt(request.query?.days, 10) || 30));

    const { rows } = await fastify.pg.query(
      `SELECT v.id, v.subject_id, v.vaccine_name, v.next_dose_date,
              s.name AS subject_name, s.species
       FROM vaccines v
       JOIN subjects s ON s.id = v.subject_id AND s.tenant_id = v.tenant_id AND s.deleted_at IS NULL
       WHERE v.tenant_id = $1
         AND v.next_dose_date IS NOT NULL
         AND v.next_dose_date >= CURRENT_DATE
         AND v.next_dose_date <= CURRENT_DATE + ($2::int || ' days')::interval
       ORDER BY v.next_dose_date ASC
       LIMIT 500`,
      [tenant_id, days]
    );
    return { items: rows, days };
  });

  fastify.get('/overdue', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;

    const { rows } = await fastify.pg.query(
      `SELECT v.id, v.subject_id, v.vaccine_name, v.next_dose_date,
              s.name AS subject_name, s.species,
              (CURRENT_DATE - v.next_dose_date) AS days_overdue
       FROM vaccines v
       JOIN subjects s ON s.id = v.subject_id AND s.tenant_id = v.tenant_id AND s.deleted_at IS NULL
       WHERE v.tenant_id = $1
         AND v.next_dose_date IS NOT NULL
         AND v.next_dose_date < CURRENT_DATE
       ORDER BY v.next_dose_date ASC
       LIMIT 500`,
      [tenant_id]
    );
    return { items: rows };
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `SELECT v.*,
              u.email AS professional_email,
              vp.name AS protocol_name
       FROM vaccines v
       LEFT JOIN users u ON u.id = v.professional_user_id
       LEFT JOIN vaccine_protocols vp ON vp.id = v.protocol_id
       WHERE v.id = $1 AND v.tenant_id = $2`,
      [id, tenant_id]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'vaccine not found' });
    return rows[0];
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const err = validateVaccineBody(request.body || {}, false);
    if (err) return reply.status(400).send({ error: err });
    const body = request.body;

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

        // Encounter / protocol checks (best-effort; FK protege também)
        if (body.encounter_id) {
          const { rows: encRows } = await client.query(
            `SELECT id FROM clinical_encounters WHERE id = $1 AND tenant_id = $2`,
            [body.encounter_id, tenant_id]
          );
          if (encRows.length === 0) {
            const e = new Error('encounter_invalid'); e.code = 'ENCOUNTER_INVALID'; throw e;
          }
        }
        if (body.protocol_id) {
          const { rows: protoRows } = await client.query(
            `SELECT id FROM vaccine_protocols WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2)`,
            [body.protocol_id, tenant_id]
          );
          if (protoRows.length === 0) {
            const e = new Error('protocol_invalid'); e.code = 'PROTOCOL_INVALID'; throw e;
          }
        }

        const { rows } = await client.query(
          `INSERT INTO vaccines (
            tenant_id, subject_id, professional_user_id, encounter_id,
            vaccine_name, manufacturer, lot_number, applied_at, next_dose_date,
            protocol_id, protocol_dose_index, notes, attachments
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, $9,
            $10, $11, $12, $13::jsonb
          ) RETURNING *`,
          [
            tenant_id, body.subject_id, user_id, body.encounter_id || null,
            body.vaccine_name.trim(), body.manufacturer || null, body.lot_number || null,
            body.applied_at, body.next_dose_date || null,
            body.protocol_id || null, body.protocol_dose_index ?? null,
            body.notes || null, JSON.stringify(body.attachments || []),
          ]
        );
        return rows[0];
      }, { userId: user_id, channel: 'ui' });

      return reply.status(201).send(result);
    } catch (err) {
      if (err.code === 'SUBJECT_INVALID') return reply.status(400).send({ error: 'subject_id inválido' });
      if (err.code === 'ENCOUNTER_INVALID') return reply.status(400).send({ error: 'encounter_id inválido' });
      if (err.code === 'PROTOCOL_INVALID') return reply.status(400).send({ error: 'protocol_id inválido' });
      throw err;
    }
  });

  fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;
    const err = validateVaccineBody(request.body || {}, true);
    if (err) return reply.status(400).send({ error: err });
    const body = request.body;

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const setParts = [];
      const values = [];
      let i = 1;
      const updatable = ['vaccine_name', 'manufacturer', 'lot_number', 'applied_at',
                         'next_dose_date', 'protocol_id', 'protocol_dose_index', 'notes'];
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
      if (setParts.length === 0) return null;
      values.push(id, tenant_id);
      const { rows } = await client.query(
        `UPDATE vaccines SET ${setParts.join(', ')} WHERE id = $${i++} AND tenant_id = $${i++} RETURNING *`,
        values
      );
      return rows[0] || null;
    }, { userId: user_id, channel: 'ui' });

    if (!result) return reply.status(404).send({ error: 'vaccine not found' });
    return result;
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;

    const deleted = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `DELETE FROM vaccines WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenant_id]
      );
      return rows[0] || null;
    }, { userId: user_id, channel: 'ui' });

    if (!deleted) return reply.status(404).send({ error: 'vaccine not found' });
    return reply.status(204).send();
  });
};
