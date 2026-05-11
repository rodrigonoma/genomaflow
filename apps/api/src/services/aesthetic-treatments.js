'use strict';

const { withTenant } = require('../db/tenant');

const VALID_CATEGORIES = new Set([
  'corpo_modelagem','corpo_flacidez',
  'facial_rejuvenescimento','facial_pigmentacao',
  'facial_acne','facial_preenchimento','facial_toxina',
  'cabelo','procedimento_cirurgico','wellness_drenagem','outro',
]);
const VALID_EVIDENCE = new Set(['A','B','C','D']);

function validate(body) {
  if (!body) return 'body obrigatório';
  if (!body.name || typeof body.name !== 'string') return 'name obrigatório';
  if (!body.category || !VALID_CATEGORIES.has(body.category)) return 'category inválido';
  if (!Array.isArray(body.indications)) return 'indications deve ser array';
  if (!Array.isArray(body.contraindications)) return 'contraindications deve ser array';
  if (body.evidence_level && !VALID_EVIDENCE.has(body.evidence_level)) return 'evidence_level inválido (A|B|C|D)';
  return null;
}

async function list(pg, tenantId, { category, indication, limit = 100 } = {}) {
  const params = [tenantId];
  let where = `(tenant_id IS NULL OR tenant_id = $1) AND is_active = true`;
  if (category) {
    params.push(category);
    where += ` AND category = $${params.length}`;
  }
  if (indication) {
    params.push(indication);
    where += ` AND $${params.length} = ANY(indications)`;
  }
  const { rows } = await pg.query(
    `SELECT id, tenant_id, name, category, indications, contraindications,
            typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
            evidence_level, description, protocol_notes, requires_medico, usage_count_30d,
            created_at, updated_at
     FROM aesthetic_treatments
     WHERE ${where}
     ORDER BY tenant_id NULLS FIRST, name ASC
     LIMIT ${Math.min(500, parseInt(limit) || 100)}`,
    params
  );
  return rows;
}

async function getById(pg, tenantId, id) {
  const { rows } = await pg.query(
    `SELECT * FROM aesthetic_treatments
     WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2) AND is_active = true`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function create(pg, tenantId, userId, body) {
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO aesthetic_treatments
         (tenant_id, name, category, indications, contraindications,
          typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
          evidence_level, description, protocol_notes, requires_medico)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        tenantId, body.name.slice(0, 200), body.category,
        body.indications || [], body.contraindications || [],
        body.typical_sessions || null, body.interval_days || null,
        body.cost_estimate_brl_min || null, body.cost_estimate_brl_max || null,
        body.evidence_level || null,
        body.description ? body.description.slice(0, 2000) : null,
        body.protocol_notes ? body.protocol_notes.slice(0, 2000) : null,
        !!body.requires_medico,
      ]
    );
    return rows[0];
  }, { userId, channel: 'ui' });
}

async function update(pg, tenantId, userId, id, body) {
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `UPDATE aesthetic_treatments SET
         name = COALESCE($3, name),
         category = COALESCE($4, category),
         indications = COALESCE($5, indications),
         contraindications = COALESCE($6, contraindications),
         typical_sessions = COALESCE($7, typical_sessions),
         interval_days = COALESCE($8, interval_days),
         cost_estimate_brl_min = COALESCE($9, cost_estimate_brl_min),
         cost_estimate_brl_max = COALESCE($10, cost_estimate_brl_max),
         evidence_level = COALESCE($11, evidence_level),
         description = COALESCE($12, description),
         protocol_notes = COALESCE($13, protocol_notes),
         requires_medico = COALESCE($14, requires_medico),
         updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [
        id, tenantId,
        body.name ? body.name.slice(0, 200) : null,
        body.category && VALID_CATEGORIES.has(body.category) ? body.category : null,
        Array.isArray(body.indications) ? body.indications : null,
        Array.isArray(body.contraindications) ? body.contraindications : null,
        body.typical_sessions ?? null, body.interval_days ?? null,
        body.cost_estimate_brl_min ?? null, body.cost_estimate_brl_max ?? null,
        body.evidence_level && VALID_EVIDENCE.has(body.evidence_level) ? body.evidence_level : null,
        body.description ? body.description.slice(0, 2000) : null,
        body.protocol_notes ? body.protocol_notes.slice(0, 2000) : null,
        typeof body.requires_medico === 'boolean' ? body.requires_medico : null,
      ]
    );
    return rows[0] || null;
  }, { userId, channel: 'ui' });
}

async function softDelete(pg, tenantId, userId, id) {
  return withTenant(pg, tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE aesthetic_treatments SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
      [id, tenantId]
    );
    return rowCount > 0;
  }, { userId, channel: 'ui' });
}

module.exports = { validate, list, getById, create, update, softDelete, VALID_CATEGORIES, VALID_EVIDENCE };
