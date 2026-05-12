'use strict';

const { withTenant } = require('../db/tenant');
const { VALID_SEX, VALID_ACTIVITY, VALID_GOALS } = require('./aesthetic-tmb');

const VALID_DIETARY = new Set([
  'vegetarian', 'vegan', 'lactose', 'gluten', 'low_carb', 'low_sodium', 'diabetic_friendly', 'none',
]);

function clampNumber(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function sanitizeStringArray(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(s => typeof s === 'string' && s.trim().length)
    .map(s => s.trim().slice(0, maxLen))
    .slice(0, maxItems);
}

function validate(body) {
  if (!body || typeof body !== 'object') return { error: 'body obrigatório' };
  const out = {};

  if (body.height_cm != null) {
    out.height_cm = clampNumber(body.height_cm, 140, 220);
    if (out.height_cm == null) return { error: 'height_cm inválido (140-220cm)' };
  }
  if (body.weight_kg != null) {
    out.weight_kg = clampNumber(body.weight_kg, 35, 200);
    if (out.weight_kg == null) return { error: 'weight_kg inválido (35-200kg)' };
  }
  if (body.age != null) {
    const n = clampNumber(body.age, 12, 100);
    if (n == null) return { error: 'age inválido (12-100)' };
    out.age = Math.round(n);
  }
  if (body.sex !== undefined) {
    if (!VALID_SEX.has(body.sex)) return { error: 'sex inválido (F|M)' };
    out.sex = body.sex;
  }
  if (body.activity_level !== undefined) {
    if (!VALID_ACTIVITY.has(body.activity_level)) return { error: 'activity_level inválido' };
    out.activity_level = body.activity_level;
  }
  if (body.goals !== undefined) {
    if (!Array.isArray(body.goals)) return { error: 'goals deve ser array' };
    const filtered = body.goals.filter(g => VALID_GOALS.has(g));
    out.goals = filtered.slice(0, 5);
  }
  out.allergies = sanitizeStringArray(body.allergies, 20, 80);
  out.medical_conditions = sanitizeStringArray(body.medical_conditions, 20, 120);
  if (body.dietary_restrictions !== undefined) {
    if (!Array.isArray(body.dietary_restrictions)) return { error: 'dietary_restrictions deve ser array' };
    out.dietary_restrictions = body.dietary_restrictions.filter(d => VALID_DIETARY.has(d)).slice(0, 10);
  }
  return { profile: out };
}

async function get(pg, tenantId, subjectId) {
  const { rows } = await pg.query(
    `SELECT aesthetic_profile FROM subjects WHERE id = $1 AND tenant_id = $2`,
    [subjectId, tenantId]
  );
  return rows[0] ? rows[0].aesthetic_profile : null;
}

async function update(pg, tenantId, userId, subjectId, profile) {
  return withTenant(pg, tenantId, async (client) => {
    const enriched = { ...profile, updated_at: new Date().toISOString() };
    const { rows } = await client.query(
      `UPDATE subjects SET aesthetic_profile = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING id, aesthetic_profile`,
      [JSON.stringify(enriched), subjectId, tenantId]
    );
    return rows[0] || null;
  }, { userId, channel: 'ui' });
}

module.exports = { validate, get, update, VALID_DIETARY };
