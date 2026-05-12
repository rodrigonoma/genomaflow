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

/**
 * Rejects values outside [min, max] strictly — does NOT silently clamp.
 * Returns null for non-finite or out-of-range inputs.
 */
function strictRange(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function sanitizeStringArray(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(s => typeof s === 'string' && s.trim().length)
    .map(s => s.trim().slice(0, maxLen))
    .slice(0, maxItems);
}

/**
 * Ranges padrão (adultos): altura 140-220, peso 35-200, idade 12-100.
 * Com allow_extreme_ranges=true: altura 100-230, peso 25-300, idade 5-110.
 * Usa rejeição estrita (não clamp silencioso) para não falsificar dados clínicos.
 */
function validate(body) {
  if (!body || typeof body !== 'object') return { error: 'body obrigatório' };
  const allowExtreme = body.allow_extreme_ranges === true;
  const warnings = [];
  const out = {};

  if (body.height_cm != null) {
    const lo = allowExtreme ? 100 : 140;
    const hi = allowExtreme ? 230 : 220;
    const n = strictRange(body.height_cm, lo, hi);
    if (n == null) {
      return { error: allowExtreme ? 'height_cm inválido (100-230cm)' : 'height_cm inválido (140-220cm)' };
    }
    out.height_cm = n;
    if (allowExtreme && (n < 140 || n > 220)) {
      warnings.push('Altura fora da faixa adulta padrão (140-220cm).');
    }
  }

  if (body.weight_kg != null) {
    const lo = allowExtreme ? 25 : 35;
    const hi = allowExtreme ? 300 : 200;
    const n = strictRange(body.weight_kg, lo, hi);
    if (n == null) {
      return { error: allowExtreme ? 'weight_kg inválido (25-300kg)' : 'weight_kg inválido (35-200kg)' };
    }
    out.weight_kg = n;
    if (allowExtreme && (n < 35 || n > 200)) {
      warnings.push('Peso fora da faixa adulta padrão (35-200kg) — TMB Mifflin-St Jeor pode não ser preciso.');
    }
  }

  if (body.age != null) {
    const lo = allowExtreme ? 5 : 12;
    const hi = allowExtreme ? 110 : 100;
    const n = strictRange(body.age, lo, hi);
    if (n == null) {
      return { error: allowExtreme ? 'age inválido (5-110)' : 'age inválido (12-100)' };
    }
    out.age = Math.round(n);
    if (allowExtreme && (out.age < 12 || out.age > 100)) {
      warnings.push('Idade fora da faixa adulta padrão (12-100) — TMB Mifflin-St Jeor é otimizado para adultos.');
    }
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

  // Persist opt-in flag inside JSONB so GET responses and UI can show badge
  if (allowExtreme) out.extreme_ranges_used = true;

  return { profile: out, warnings: warnings.length ? warnings : undefined };
}

async function get(pg, tenantId, subjectId) {
  const { rows } = await pg.query(
    `SELECT aesthetic_profile, sex, birth_date, weight, height
     FROM subjects WHERE id = $1 AND tenant_id = $2`,
    [subjectId, tenantId]
  );
  if (!rows[0]) return null;
  return rows[0];
}

/**
 * Hidrata defaults do subject quando aesthetic_profile não tem o campo.
 * Não sobrescreve valores salvos no JSONB.
 * Calcula age a partir de birth_date.
 */
function hydrateFromSubject(profile, subject) {
  const out = { ...(profile || {}) };
  if (out.height_cm == null && subject.height != null) {
    out.height_cm = Number(subject.height);
  }
  if (out.weight_kg == null && subject.weight != null) {
    out.weight_kg = Number(subject.weight);
  }
  if (out.sex == null && subject.sex && (subject.sex === 'F' || subject.sex === 'M')) {
    out.sex = subject.sex;
  }
  if (out.age == null && subject.birth_date) {
    const bd = new Date(subject.birth_date);
    if (!isNaN(bd.getTime())) {
      const now = new Date();
      let age = now.getFullYear() - bd.getFullYear();
      const m = now.getMonth() - bd.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < bd.getDate())) age -= 1;
      if (age >= 0 && age <= 150) out.age = age;
    }
  }
  return out;
}

async function update(pg, tenantId, userId, subjectId, profile) {
  return withTenant(pg, tenantId, async (client) => {
    // updated_at vai dentro do JSONB porque a tabela subjects NÃO tem coluna
    // updated_at própria (migration 003 só tem created_at).
    const enriched = { ...profile, updated_at: new Date().toISOString() };
    const { rows } = await client.query(
      `UPDATE subjects SET aesthetic_profile = $1::jsonb
       WHERE id = $2 AND tenant_id = $3
       RETURNING id, aesthetic_profile`,
      [JSON.stringify(enriched), subjectId, tenantId]
    );
    return rows[0] || null;
  }, { userId, channel: 'ui' });
}

module.exports = { validate, get, update, hydrateFromSubject, VALID_DIETARY };
