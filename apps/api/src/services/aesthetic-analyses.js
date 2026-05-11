'use strict';

const { withTenant } = require('../db/tenant');

async function createPending(pg, { tenantId, subjectId, userId, analysisType, photoIds, baselineId, creditsCharged }) {
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO aesthetic_analyses
         (tenant_id, subject_id, user_id, analysis_type, photo_ids,
          status, baseline_analysis_id, credits_charged)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
       RETURNING id`,
      [tenantId, subjectId, userId, analysisType, photoIds, baselineId || null, creditsCharged]
    );
    return rows[0];
  }, { userId, channel: 'ui' });
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

module.exports = { createPending, validatePhotosOwnership };
