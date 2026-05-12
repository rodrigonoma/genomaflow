'use strict';

/**
 * aesthetic-purge-sensitive.js
 *
 * Worker job: purge aesthetic photos flagged as is_sensitive=true that are
 * older than RETENTION_DAYS (365 days / 1 year) per LGPD.
 *
 * Strategy:
 * 1. alreadyRanToday: check if any sensitive photo was soft-deleted today
 *    (UTC). If yes, short-circuit — idempotent, runs once per day.
 * 2. findEligible: fetch up to BATCH_LIMIT rows where is_sensitive=true,
 *    deleted_at IS NULL and created_at < NOW()-RETENTION_DAYS.
 * 3. softDeleteAndPurge (per row):
 *    a. Opens a transaction; sets SET LOCAL app.tenant_id and
 *       app.actor_channel='system' so the audit_trigger_fn records channel
 *       as 'system' (worker), not the default 'ui'.
 *       app.user_id is intentionally NOT set — this is a system job, no user.
 *    b. UPDATE deleted_at=NOW() (LGPD compliance in DB, audit_trigger_fn
 *       captures the changed_fields delta automatically).
 *    c. COMMIT, then DELETE from S3 best-effort outside the transaction: if
 *       S3 fails, log warn but do NOT retry — the soft delete already happened
 *       so the row exits the eligible window.
 * 4. shouldTickRun: gate to TICK_UTC_HOUR (default 7 = 07:00 UTC = 04:00 BRT)
 *    so the 5-min tick does not hammer the DB on every tick.
 *
 * Batch cap (BATCH_LIMIT=100): limits blast radius per tick. If > 100 photos
 * are eligible, they will be processed on subsequent daily ticks.
 *
 * Timezone note: Brasil aboliu horário de verão em 2019 (Lei 13.874/2019).
 * BRT = UTC-3 fixo, sem DST. 07:00 UTC = 04:00 BRT previsível.
 * Override via env AESTHETIC_PURGE_HOUR_UTC if needed.
 *
 * Configurable via env vars (all have backward-compat defaults):
 *   AESTHETIC_SENSITIVE_RETENTION_DAYS  — default 365
 *   AESTHETIC_PURGE_BATCH               — default 100
 *   AESTHETIC_PURGE_HOUR_UTC            — default 7 (= 04:00 BRT)
 *
 * Non-sensitive photos (5-year CFM retention) are NOT in scope — this job
 * only touches is_sensitive=true rows.
 */

const { deleteFile } = require('../storage/s3');

// Configurable via env vars — backward-compat defaults preserved.
const RETENTION_DAYS = parseInt(process.env.AESTHETIC_SENSITIVE_RETENTION_DAYS || '365', 10);
const BATCH_LIMIT    = parseInt(process.env.AESTHETIC_PURGE_BATCH || '100', 10);
// 07:00 UTC = 04:00 BRT (UTC-3 fixo; Brasil aboliu DST em 2019).
const TICK_UTC_HOUR  = parseInt(process.env.AESTHETIC_PURGE_HOUR_UTC || '7', 10);

/**
 * Format a Date as YYYY-MM-DD (UTC).
 * @param {Date} [now]
 * @returns {string}
 */
function todayYMD(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Check if a purge already ran today (UTC).
 * Uses aesthetic_photos itself: if any sensitive row has deleted_at >= start of
 * today UTC, we consider today already processed.
 *
 * @param {object} pool - pg Pool
 * @param {Date} [now]
 * @returns {Promise<boolean>}
 */
async function alreadyRanToday(pool, now = new Date()) {
  const startUtc = new Date(now);
  startUtc.setUTCHours(0, 0, 0, 0);
  const { rows } = await pool.query(
    `SELECT 1 FROM aesthetic_photos
     WHERE is_sensitive = true
       AND deleted_at IS NOT NULL
       AND deleted_at >= $1
     LIMIT 1`,
    [startUtc.toISOString()],
  );
  return rows.length > 0;
}

/**
 * Fetch up to `limit` sensitive photos eligible for purge.
 *
 * Uses the partial index idx_aesthetic_photos_sensitive_retention
 * (is_sensitive=true AND deleted_at IS NULL) for efficiency.
 *
 * @param {object} pool
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<{ id: string, tenant_id: string, s3_key: string }>>}
 */
async function findEligible(pool, { limit = BATCH_LIMIT } = {}) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, s3_key
     FROM aesthetic_photos
     WHERE is_sensitive = true
       AND deleted_at IS NULL
       AND created_at < NOW() - ($1 || ' days')::interval
     ORDER BY created_at ASC
     LIMIT $2`,
    [String(RETENTION_DAYS), limit],
  );
  return rows;
}

/**
 * Soft-delete a single photo in DB (inside a transaction with audit context),
 * then delete from S3 best-effort outside the transaction.
 *
 * Transaction ensures the audit_trigger_fn captures actor_channel='system'
 * (worker job), not the default 'ui'. app.user_id is intentionally NOT set —
 * this is a system job with no human actor.
 *
 * Soft delete happens first so LGPD compliance holds even if S3 fails.
 * S3 failure is logged as a warning; the row is already out of the eligible
 * window (deleted_at IS NOT NULL), so no retry is attempted.
 *
 * @param {object} pool - pg Pool
 * @param {{ id: string, tenant_id: string, s3_key: string }} row
 * @returns {Promise<{ id: string, skipped?: boolean, s3_deleted?: boolean, error?: string }>}
 */
async function softDeleteAndPurge(pool, row) {
  const client = await pool.connect();
  let rowCount = 0;
  try {
    await client.query('BEGIN');
    // Set audit context: tenant_id for RLS + actor_channel='system' so
    // audit_trigger_fn records this as a worker action, not a UI action.
    // app.user_id intentionally omitted — no human actor for this job.
    await client.query('SET LOCAL app.tenant_id = $1', [row.tenant_id]);
    await client.query("SET LOCAL app.actor_channel = 'system'");

    // Guard: only update if still not deleted (concurrent run safety)
    const result = await client.query(
      `UPDATE aesthetic_photos
       SET deleted_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [row.id],
    );
    rowCount = result.rowCount;
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  if (rowCount === 0) {
    // Already deleted by a concurrent run — skip silently
    return { id: row.id, skipped: true };
  }

  // S3 delete outside the transaction — best-effort, LGPD compliance already
  // secured by the soft delete above.
  try {
    await deleteFile(row.s3_key);
    return { id: row.id, s3_deleted: true };
  } catch (e) {
    // S3 failure: soft delete is permanent — LGPD compliance from DB perspective.
    // Log warning and continue. No retry — next daily run won't see this row
    // (deleted_at IS NOT NULL excludes it from findEligible).
    console.warn(`[purge-sensitive] S3 delete failed for key=${row.s3_key} id=${row.id}:`, e.message);
    return { id: row.id, s3_deleted: false, error: e.message };
  }
}

/**
 * Main entry point for the purge job.
 *
 * @param {{ pool: object, now?: Date, forceRun?: boolean }} [opts]
 * @returns {Promise<object>} result summary
 */
async function runPurge({ pool, now = new Date(), forceRun = false } = {}) {
  if (!forceRun && await alreadyRanToday(pool, now)) {
    return { skipped: true, ymd: todayYMD(now), reason: 'already_ran_today' };
  }

  const eligible = await findEligible(pool, { limit: BATCH_LIMIT });
  const results = [];

  for (const row of eligible) {
    results.push(await softDeleteAndPurge(pool, row));
  }

  const purged = results.filter((r) => !r.skipped).length;
  const s3Failures = results.filter((r) => r.s3_deleted === false).length;

  console.log(
    `[purge-sensitive] ymd=${todayYMD(now)} eligible=${eligible.length} purged=${purged} s3_failures=${s3Failures}`,
  );

  return {
    skipped: false,
    ymd: todayYMD(now),
    eligible: eligible.length,
    purged,
    s3_failures: s3Failures,
    results,
  };
}

/**
 * Tick guard: only run at TICK_UTC_HOUR UTC (default 07:00 UTC = 04:00 BRT).
 *
 * The scheduler tick fires every 5min. Without this guard the job would hit
 * the DB 12× per hour even though it only does real work once per day.
 * alreadyRanToday provides the idempotency after the first run of the day;
 * shouldTickRun reduces needless DB round-trips to ~12 calls per day.
 *
 * Brasil abolished DST in 2019 (BRT = UTC-3 fixed, no seasonal shift).
 * Override via env AESTHETIC_PURGE_HOUR_UTC (default: 7).
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
function shouldTickRun(now = new Date()) {
  return now.getUTCHours() === TICK_UTC_HOUR;
}

module.exports = {
  runPurge,
  shouldTickRun,
  alreadyRanToday,
  findEligible,
  softDeleteAndPurge,
  todayYMD,
  RETENTION_DAYS,
  BATCH_LIMIT,
  TICK_UTC_HOUR,
};
