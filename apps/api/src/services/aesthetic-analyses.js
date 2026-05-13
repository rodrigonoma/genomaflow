'use strict';

const { withTenant } = require('../db/tenant');

async function createPending(pg, {
  tenantId, subjectId, userId, analysisType, photoIds,
  baselineId, creditsCharged,
  // V2 tier (default standard preserva F1-F6)
  sessionId, tier,
}) {
  const finalTier = tier === 'advanced' ? 'advanced' : 'standard';
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO aesthetic_analyses
         (tenant_id, subject_id, user_id, analysis_type, photo_ids,
          status, baseline_analysis_id, credits_charged,
          session_id, tier)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9)
       RETURNING id, tier, session_id`,
      [
        tenantId, subjectId, userId, analysisType, photoIds,
        baselineId || null, creditsCharged,
        sessionId || null, finalTier,
      ]
    );
    return rows[0];
  }, { userId, channel: 'ui' });
}

/**
 * V2: validar que todas as photos pertencem à mesma session, têm pose e
 * landmarks. Usado em pre-flight de POST /aesthetic/analyses tier=advanced.
 *
 * Returns:
 *   { ok: true }                              tudo válido
 *   { ok: false, error: 'PHOTOS_NOT_FOUND' }  alguma photo não existe ou foi apagada
 *   { ok: false, error: 'PHOTOS_INCOMPLETE_FOR_ADVANCED' } falta pose/landmarks ou session_id diverge
 */
async function validatePhotosForAdvanced(pg, tenantId, photoIds, sessionId) {
  const { rows } = await pg.query(
    `SELECT id, pose, landmarks, session_id
       FROM aesthetic_photos
      WHERE id = ANY($1::uuid[])
        AND tenant_id = $2
        AND deleted_at IS NULL`,
    [photoIds, tenantId]
  );
  if (rows.length !== photoIds.length) {
    return { ok: false, error: 'PHOTOS_NOT_FOUND' };
  }
  for (const r of rows) {
    if (!r.pose || !r.landmarks || r.session_id !== sessionId) {
      return { ok: false, error: 'PHOTOS_INCOMPLETE_FOR_ADVANCED' };
    }
  }
  return { ok: true };
}

async function validatePhotosOwnership(pg, tenantId, photoIds) {
  if (!photoIds || photoIds.length === 0) return false;
  const { rows } = await pg.query(
    `SELECT id FROM aesthetic_photos
     WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND deleted_at IS NULL`,
    [photoIds, tenantId]
  );
  return rows.length === photoIds.length;
}

async function listForSubject(pg, { tenantId, subjectId, analysisType, limit = 20, offset = 0 }) {
  const params = [tenantId, subjectId, limit, offset];
  let typeFilter = '';
  if (analysisType) {
    params.splice(2, 0, analysisType);
    typeFilter = `AND analysis_type = $3`;
  }
  const { rows } = await pg.query(
    `SELECT id, analysis_type, status, created_at, completed_at,
            error_code, baseline_analysis_id, credits_charged, credits_refunded
     FROM aesthetic_analyses
     WHERE tenant_id = $1 AND subject_id = $2 AND deleted_at IS NULL ${typeFilter}
     ORDER BY created_at DESC
     LIMIT $${typeFilter ? '4' : '3'} OFFSET $${typeFilter ? '5' : '4'}`,
    params
  );
  return rows;
}

async function getDetail(pg, analysisId, tenantId) {
  const { rows } = await pg.query(
    `SELECT * FROM aesthetic_analyses
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [analysisId, tenantId]
  );
  return rows[0] || null;
}

async function softDelete(pg, analysisId, tenantId, userId) {
  return withTenant(pg, tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE aesthetic_analyses SET deleted_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [analysisId, tenantId]
    );
    return rowCount > 0;
  }, { userId, channel: 'ui' });
}

async function getMetricsOnly(pg, analysisId, tenantId) {
  const { rows } = await pg.query(
    `SELECT id, metrics FROM aesthetic_analyses
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND status = 'done'`,
    [analysisId, tenantId]
  );
  return rows[0] || null;
}

function computeDeltas(baselineMetrics, currentMetrics) {
  const deltas = {};
  const allKeys = new Set([
    ...Object.keys(baselineMetrics || {}),
    ...Object.keys(currentMetrics || {}),
  ]);
  let sum = 0, count = 0;
  for (const k of allKeys) {
    const a = baselineMetrics?.[k]?.score;
    const b = currentMetrics?.[k]?.score;
    if (typeof a === 'number' && typeof b === 'number') {
      const delta = b - a;
      deltas[k] = delta;
      sum += delta;
      count += 1;
    }
  }
  return { deltas, overall_change: count > 0 ? Math.round(sum / count) : 0 };
}

module.exports = {
  createPending, validatePhotosOwnership,
  validatePhotosForAdvanced,
  listForSubject, getDetail, softDelete,
  getMetricsOnly, computeDeltas,
};
