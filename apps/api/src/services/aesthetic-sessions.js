'use strict';

/**
 * aesthetic-sessions service
 *
 * CRUD básico para aesthetic_sessions (wrapper V2 advanced tier).
 * Toda mutation passa por withTenant com audit context { userId, channel:'ui' }.
 *
 * Spec: docs/superpowers/specs/2026-05-12-aesthetic-v2-fase1-design.md §5.1
 */

const { withTenant } = require('../db/tenant');

const VALID_SESSION_TYPES = new Set(['facial_analysis', 'body_analysis']);

function _ensureValidType(sessionType) {
  if (!VALID_SESSION_TYPES.has(sessionType)) {
    const err = new Error('INVALID_SESSION_TYPE');
    err.status = 400;
    throw err;
  }
}

async function createSession(pg, { tenantId, subjectId, userId, sessionType, notes }) {
  _ensureValidType(sessionType);
  return await withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(`
      INSERT INTO aesthetic_sessions
        (tenant_id, subject_id, user_id, session_type, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, tenant_id, subject_id, user_id,
                session_date, session_type, notes, created_at`,
      [tenantId, subjectId, userId, sessionType, notes || null]);
    return rows[0];
  }, { userId, channel: 'ui' });
}

async function listForSubject(pg, { tenantId, subjectId, limit = 20, offset = 0 }) {
  return await withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(`
      SELECT id, subject_id, user_id, session_date, session_type, notes, created_at
        FROM aesthetic_sessions
       WHERE tenant_id = $1
         AND subject_id = $2
         AND deleted_at IS NULL
       ORDER BY session_date DESC
       LIMIT $3 OFFSET $4`,
      [tenantId, subjectId, limit, offset]);
    return rows;
  });
}

async function getById(pg, { tenantId, sessionId }) {
  return await withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(`
      SELECT id, tenant_id, subject_id, user_id,
             session_date, session_type, notes, created_at
        FROM aesthetic_sessions
       WHERE id = $1
         AND tenant_id = $2
         AND deleted_at IS NULL`,
      [sessionId, tenantId]);
    return rows[0] || null;
  });
}

async function softDelete(pg, { tenantId, sessionId, userId }) {
  return await withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(`
      UPDATE aesthetic_sessions
         SET deleted_at = NOW()
       WHERE id = $1
         AND tenant_id = $2
         AND deleted_at IS NULL
      RETURNING id`,
      [sessionId, tenantId]);
    return rows.length > 0;
  }, { userId, channel: 'ui' });
}

module.exports = {
  createSession,
  listForSubject,
  getById,
  softDelete,
  VALID_SESSION_TYPES,
};
