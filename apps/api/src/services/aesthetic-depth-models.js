'use strict';

/**
 * aesthetic-depth-models service
 *
 * CRUD para aesthetic_depth_models (V2 Fase 3 Pseudo-3D). Idempotente
 * por analysis_id — só cria novo se não existe depth ou status='error'.
 *
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase3-design.md §6.1
 */

const { withTenant } = require('../db/tenant');

const VALID_MODEL_TYPES = new Set(['heightmap', 'multiview_fusion']);

/**
 * Retorna depth model existente (qualquer status) pra uma análise.
 * Usado por GET /aesthetic/analyses/:id/depth.
 */
async function getByAnalysisId(pg, { tenantId, analysisId }) {
  const { rows } = await pg.query(
    `SELECT id, analysis_id, status, model_type, s3_key_glb, s3_key_depth,
            s3_key_texture, provider, provider_version, metadata,
            error_code, error_message, created_at, completed_at
       FROM aesthetic_depth_models
      WHERE tenant_id = $1 AND analysis_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId, analysisId]
  );
  return rows[0] || null;
}

/**
 * Cria depth model em status pending. Caller deve enfileirar job BullMQ
 * com este ID em seguida. Audit trigger registra { userId, channel: 'ui' }.
 */
async function createPending(pg, { tenantId, analysisId, userId, modelType = 'heightmap' }) {
  if (!VALID_MODEL_TYPES.has(modelType)) {
    const err = new Error('INVALID_MODEL_TYPE');
    err.status = 400;
    throw err;
  }
  return await withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO aesthetic_depth_models
         (tenant_id, analysis_id, status, model_type)
       VALUES ($1, $2, 'pending', $3)
       RETURNING id, analysis_id, status, model_type, created_at`,
      [tenantId, analysisId, modelType]
    );
    return rows[0];
  }, { userId, channel: 'ui' });
}

/**
 * Worker chama isso ao iniciar processamento.
 */
async function markProcessing(pg, depthId) {
  // Worker tem seu próprio set tenant context via session var — pg.query direto
  await pg.query(
    `UPDATE aesthetic_depth_models
        SET status = 'processing'
      WHERE id = $1`,
    [depthId]
  );
}

/**
 * Worker chama isso ao concluir com sucesso.
 */
async function markDone(pg, depthId, { s3KeyDepth, s3KeyGlb, s3KeyTexture, providerVersion, metadata }) {
  await pg.query(
    `UPDATE aesthetic_depth_models
        SET status = 'done',
            s3_key_depth = $2,
            s3_key_glb = $3,
            s3_key_texture = $4,
            provider_version = $5,
            metadata = $6::jsonb,
            completed_at = NOW()
      WHERE id = $1`,
    [
      depthId,
      s3KeyDepth || null,
      s3KeyGlb || null,
      s3KeyTexture || null,
      providerVersion || null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
}

/**
 * Worker chama em falha.
 */
async function markError(pg, depthId, { errorCode, errorMessage }) {
  await pg.query(
    `UPDATE aesthetic_depth_models
        SET status = 'error',
            error_code = $2,
            error_message = $3,
            completed_at = NOW()
      WHERE id = $1`,
    [depthId, errorCode || 'UNKNOWN', String(errorMessage || '').slice(0, 500)]
  );
}

module.exports = {
  getByAnalysisId,
  createPending,
  markProcessing,
  markDone,
  markError,
  VALID_MODEL_TYPES,
};
