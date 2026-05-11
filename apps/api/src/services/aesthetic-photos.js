'use strict';

const { withTenant } = require('../db/tenant');

const SENSITIVE_PHOTO_TYPES = new Set([
  'breast_front', 'breast_side',
  'glutes_back',
  'abdomen_front', 'abdomen_side',
]);

function isSensitive(photoType) {
  return SENSITIVE_PHOTO_TYPES.has(photoType);
}

async function createPhoto(pg, { tenantId, subjectId, userId, photoType, s3Key, notes }) {
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO aesthetic_photos (tenant_id, subject_id, user_id, photo_type, s3_key, is_sensitive, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, s3_key, photo_type, is_sensitive, taken_at`,
      [tenantId, subjectId, userId, photoType, s3Key, isSensitive(photoType), notes]
    );
    return rows[0];
  }, { userId, channel: 'ui' });
}

async function getPhotoForTenant(pg, photoId, tenantId) {
  const { rows } = await pg.query(
    `SELECT id, s3_key, tenant_id, subject_id, photo_type, is_sensitive, deleted_at FROM aesthetic_photos WHERE id = $1 AND tenant_id = $2`,
    [photoId, tenantId]
  );
  return rows[0] || null;
}

async function softDeletePhoto(pg, photoId, tenantId, userId) {
  return withTenant(pg, tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE aesthetic_photos SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [photoId, tenantId]
    );
    return rowCount > 0;
  }, { userId, channel: 'ui' });
}

module.exports = { createPhoto, getPhotoForTenant, softDeletePhoto, isSensitive };
