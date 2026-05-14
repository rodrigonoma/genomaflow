// apps/api/src/services/trello-fix-attempts.js
'use strict';

/**
 * trello-fix-attempts service — audit trail Trello QA Agent.
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §5
 */

const VALID_TRIGGER_TYPES = new Set(['triage', 'fix', 'retry', 'detalhe', 'cancel']);
const VALID_STATUSES = new Set([
  'queued', 'running', 'pr_opened', 'tests_failed',
  'llm_failed', 'cancelled', 'limit_reached', 'completed',
]);
const MAX_ATTEMPTS = 5;

function _validateTrigger(t) {
  if (!VALID_TRIGGER_TYPES.has(t)) {
    const err = new Error('INVALID_TRIGGER_TYPE');
    err.status = 400;
    throw err;
  }
}

async function createAttempt(pg, {
  cardId, cardShortId, attempt, triggerType, triggeredBy, hint,
}) {
  _validateTrigger(triggerType);
  const { rows } = await pg.query(
    `INSERT INTO trello_fix_attempts
       (card_id, card_short_id, attempt, trigger_type, triggered_by, hint, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued')
     RETURNING id, card_id, attempt, status, created_at`,
    [cardId, cardShortId, attempt, triggerType, triggeredBy, hint || null]
  );
  return rows[0];
}

async function markRunning(pg, attemptId) {
  await pg.query(
    `UPDATE trello_fix_attempts SET status = 'running' WHERE id = $1`,
    [attemptId]
  );
}

async function markCompleted(pg, attemptId, fields) {
  await pg.query(
    `UPDATE trello_fix_attempts
        SET status = $2,
            pr_url = $3,
            branch_name = $4,
            test_summary = $5::jsonb,
            llm_tokens_input = $6,
            llm_tokens_output = $7,
            llm_cost_usd = $8,
            processing_ms = $9,
            completed_at = NOW()
      WHERE id = $1`,
    [
      attemptId,
      fields.status || 'completed',
      fields.prUrl || null,
      fields.branchName || null,
      fields.testSummary ? JSON.stringify(fields.testSummary) : null,
      fields.llmTokensInput || 0,
      fields.llmTokensOutput || 0,
      fields.llmCostUsd || 0,
      fields.processingMs || 0,
    ]
  );
}

async function markFailed(pg, attemptId, { status, errorCode, errorMessage }) {
  await pg.query(
    `UPDATE trello_fix_attempts
        SET status = $2,
            error_code = $3,
            error_message = $4,
            completed_at = NOW()
      WHERE id = $1`,
    [
      attemptId,
      status || 'llm_failed',
      errorCode || 'UNKNOWN',
      String(errorMessage || '').slice(0, 500),
    ]
  );
}

async function getLastAttempt(pg, { cardId }) {
  const { rows } = await pg.query(
    `SELECT id, card_id, attempt, trigger_type, status, hint,
            pr_url, branch_name, test_summary, error_code, error_message,
            llm_tokens_input, llm_tokens_output, llm_cost_usd,
            created_at, completed_at
       FROM trello_fix_attempts
      WHERE card_id = $1
      ORDER BY attempt DESC
      LIMIT 1`,
    [cardId]
  );
  return rows[0] || null;
}

async function countCompletedAttempts(pg, { cardId }) {
  const { rows } = await pg.query(
    `SELECT COUNT(*)::text AS count
       FROM trello_fix_attempts
      WHERE card_id = $1
        AND trigger_type = 'fix'
        AND status IN ('pr_opened', 'tests_failed')`,
    [cardId]
  );
  return parseInt(rows[0].count, 10);
}

module.exports = {
  createAttempt,
  markRunning,
  markCompleted,
  markFailed,
  getLastAttempt,
  countCompletedAttempts,
  VALID_TRIGGER_TYPES,
  VALID_STATUSES,
  MAX_ATTEMPTS,
};
