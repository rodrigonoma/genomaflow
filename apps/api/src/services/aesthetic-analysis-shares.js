'use strict';

/**
 * aesthetic-analysis-shares service
 *
 * CRUD do audit trail de compartilhamentos do relatório paciente
 * (email/whatsapp). 1 entry por canal × send. Audit trigger registra
 * { userId, channel: 'ui' } via withTenant.
 *
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase4-design.md §4
 */

const { withTenant } = require('../db/tenant');

const VALID_CHANNELS = new Set(['email', 'whatsapp']);
const VALID_STATUS = new Set(['queued', 'sent', 'delivered', 'failed']);

function _validateChannel(channel) {
  if (!VALID_CHANNELS.has(channel)) {
    const err = new Error('INVALID_CHANNEL');
    err.status = 400;
    throw err;
  }
}

/**
 * Cria share record em status='queued'. Caller atualiza pra 'sent' /
 * 'failed' depois que o provider responder.
 */
async function createShare(pg, {
  tenantId, analysisId, userId, channel, recipient, customMessage, s3KeyPdf,
}) {
  _validateChannel(channel);
  if (!recipient || typeof recipient !== 'string') {
    const err = new Error('INVALID_RECIPIENT');
    err.status = 400;
    throw err;
  }
  return await withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO aesthetic_analysis_shares
         (tenant_id, analysis_id, user_id, channel, recipient, status,
          s3_key_pdf, custom_message)
       VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7)
       RETURNING id, analysis_id, channel, recipient, status, sent_at`,
      [tenantId, analysisId, userId, channel, recipient,
       s3KeyPdf || null, customMessage || null]
    );
    return rows[0];
  }, { userId, channel: 'ui' });
}

async function markSent(pg, shareId, providerId) {
  await pg.query(
    `UPDATE aesthetic_analysis_shares
        SET status = 'sent', provider_id = $2
      WHERE id = $1`,
    [shareId, providerId || null]
  );
}

async function markFailed(pg, shareId, { errorCode, errorMessage }) {
  await pg.query(
    `UPDATE aesthetic_analysis_shares
        SET status = 'failed',
            error_code = $2,
            error_message = $3
      WHERE id = $1`,
    [shareId, errorCode || 'UNKNOWN', String(errorMessage || '').slice(0, 500)]
  );
}

async function listByAnalysis(pg, { tenantId, analysisId, limit = 50 }) {
  return await withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, channel, recipient, status, provider_id,
              error_code, sent_at, delivered_at
         FROM aesthetic_analysis_shares
        WHERE tenant_id = $1 AND analysis_id = $2
        ORDER BY sent_at DESC
        LIMIT $3`,
      [tenantId, analysisId, limit]
    );
    return rows;
  });
}

/**
 * Busca s3_key_pdf cacheado em qualquer share anterior da mesma análise
 * (idempotência — não regenera PDF a cada share).
 */
async function findCachedPdfKey(pg, { tenantId, analysisId }) {
  return await withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT s3_key_pdf
         FROM aesthetic_analysis_shares
        WHERE tenant_id = $1
          AND analysis_id = $2
          AND s3_key_pdf IS NOT NULL
        ORDER BY sent_at DESC
        LIMIT 1`,
      [tenantId, analysisId]
    );
    return rows[0]?.s3_key_pdf || null;
  });
}

module.exports = {
  createShare,
  markSent,
  markFailed,
  listByAnalysis,
  findCachedPdfKey,
  VALID_CHANNELS,
  VALID_STATUS,
};
