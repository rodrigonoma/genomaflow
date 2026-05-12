'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');

// --- Mock S3 deleteFile ---
// Must be declared before the module-under-test is required.
jest.mock('../../src/storage/s3', () => ({
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

// --- Module under test (imported AFTER mocks) ---
const {
  runPurge,
  shouldTickRun,
  alreadyRanToday,
  findEligible,
  softDeleteAndPurge,
  todayYMD,
  RETENTION_DAYS,
  BATCH_LIMIT,
  TICK_UTC_HOUR,
} = require('../../src/jobs/aesthetic-purge-sensitive');

const { deleteFile } = require('../../src/storage/s3');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal pool mock.
 *
 * softDeleteAndPurge now uses pool.connect() → client with BEGIN/COMMIT/ROLLBACK
 * + SET LOCAL + UPDATE. Other functions (alreadyRanToday, findEligible) use
 * pool.query directly.
 *
 * @param {{ alreadyRanRows?: object[], eligibleRows?: object[], updateRowCount?: number }} opts
 */
function makePool({ alreadyRanRows = [], eligibleRows = [], updateRowCount = 1 } = {}) {
  // client returned by pool.connect() — used inside softDeleteAndPurge transaction
  const mockClient = {
    query: jest.fn(async (sql) => {
      if (/BEGIN|COMMIT|ROLLBACK/i.test(sql)) return {};
      if (/SET LOCAL/i.test(sql)) return {};
      if (/UPDATE aesthetic_photos\s+SET deleted_at/i.test(sql)) {
        return { rowCount: updateRowCount };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };

  return {
    mockClient,
    query: jest.fn(async (sql) => {
      // alreadyRanToday query
      if (/SELECT 1 FROM aesthetic_photos\s+WHERE is_sensitive = true\s+AND deleted_at IS NOT NULL/i.test(sql)) {
        return { rows: alreadyRanRows };
      }
      // findEligible query
      if (/SELECT id, tenant_id, s3_key/i.test(sql)) {
        return { rows: eligibleRows };
      }
      return { rows: [], rowCount: 0 };
    }),
    connect: jest.fn(async () => mockClient),
  };
}

// ---------------------------------------------------------------------------
// 1. shouldTickRun
// ---------------------------------------------------------------------------
describe('shouldTickRun', () => {
  test('returns true only at UTC hour 7 (04:00 BRT)', () => {
    const at = (h) => new Date(Date.UTC(2026, 4, 11, h, 0, 0));
    expect(shouldTickRun(at(7))).toBe(true);
  });

  test('returns false at all other UTC hours', () => {
    const at = (h) => new Date(Date.UTC(2026, 4, 11, h, 0, 0));
    expect(shouldTickRun(at(0))).toBe(false);
    expect(shouldTickRun(at(6))).toBe(false);
    expect(shouldTickRun(at(8))).toBe(false);
    expect(shouldTickRun(at(23))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. todayYMD
// ---------------------------------------------------------------------------
describe('todayYMD', () => {
  test('formats YYYY-MM-DD correctly from UTC timestamp', () => {
    expect(todayYMD(new Date(Date.UTC(2026, 4, 11, 7, 0, 0)))).toBe('2026-05-11');
    expect(todayYMD(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe('2026-01-01');
    expect(todayYMD(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe('2026-12-31');
  });
});

// ---------------------------------------------------------------------------
// 3. alreadyRanToday
// ---------------------------------------------------------------------------
describe('alreadyRanToday', () => {
  test('returns true when a sensitive soft-delete exists for today UTC', async () => {
    const pool = makePool({ alreadyRanRows: [{ '?column?': 1 }] });
    await expect(alreadyRanToday(pool, new Date(Date.UTC(2026, 4, 11, 8, 0)))).resolves.toBe(true);
  });

  test('returns false when no sensitive soft-delete exists for today UTC', async () => {
    const pool = makePool({ alreadyRanRows: [] });
    await expect(alreadyRanToday(pool, new Date(Date.UTC(2026, 4, 11, 8, 0)))).resolves.toBe(false);
  });

  test('passes start-of-UTC-day as the timestamp parameter', async () => {
    const calls = [];
    const pool = {
      query: jest.fn(async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
      }),
      connect: jest.fn(),
    };
    const now = new Date(Date.UTC(2026, 4, 11, 14, 35, 22));
    await alreadyRanToday(pool, now);
    // The parameter should be midnight UTC of 2026-05-11
    expect(calls[0].params[0]).toBe('2026-05-11T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// 4. findEligible
// ---------------------------------------------------------------------------
describe('findEligible', () => {
  test('returns rows from pool query', async () => {
    const eligible = [
      { id: 'p1', tenant_id: 't1', s3_key: 'aesthetic-photos/t1/p1.jpg' },
      { id: 'p2', tenant_id: 't1', s3_key: 'aesthetic-photos/t1/p2.jpg' },
    ];
    const pool = makePool({ eligibleRows: eligible });
    const rows = await findEligible(pool);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('p1');
  });

  test('passes RETENTION_DAYS and BATCH_LIMIT to query', async () => {
    const calls = [];
    const pool = {
      query: jest.fn(async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
      }),
      connect: jest.fn(),
    };
    await findEligible(pool);
    expect(calls[0].params[0]).toBe(String(RETENTION_DAYS)); // '365'
    expect(calls[0].params[1]).toBe(BATCH_LIMIT);             // 100
  });
});

// ---------------------------------------------------------------------------
// 5. softDeleteAndPurge — individual row
// ---------------------------------------------------------------------------
describe('softDeleteAndPurge', () => {
  beforeEach(() => {
    deleteFile.mockClear();
    deleteFile.mockResolvedValue(undefined);
  });

  test('soft-deletes row and deletes from S3 on success', async () => {
    const pool = makePool({ updateRowCount: 1 });
    const row = { id: 'p1', tenant_id: 't1', s3_key: 'aesthetic-photos/t1/p1.jpg' };
    const result = await softDeleteAndPurge(pool, row);
    expect(result.id).toBe('p1');
    expect(result.s3_deleted).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(deleteFile).toHaveBeenCalledWith(row.s3_key);
  });

  test('returns skipped=true when rowCount=0 (concurrent delete)', async () => {
    const pool = makePool({ updateRowCount: 0 });
    const row = { id: 'p1', tenant_id: 't1', s3_key: 'k.jpg' };
    const result = await softDeleteAndPurge(pool, row);
    expect(result.skipped).toBe(true);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  test('S3 failure captured as warning — soft delete still persisted', async () => {
    deleteFile.mockRejectedValueOnce(new Error('S3 network error'));
    const pool = makePool({ updateRowCount: 1 });
    const row = { id: 'p1', tenant_id: 't1', s3_key: 'k.jpg' };
    const result = await softDeleteAndPurge(pool, row);
    expect(result.s3_deleted).toBe(false);
    expect(result.error).toBe('S3 network error');
    // DB transaction still committed (client.query was called for BEGIN + SET LOCAL × 2 + UPDATE + COMMIT)
    expect(pool.mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(pool.mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  // #9 — actor_channel: softDeleteAndPurge must set actor_channel='system' in the tx
  test('#9 SET LOCAL app.actor_channel = system inside the transaction', async () => {
    const pool = makePool({ updateRowCount: 1 });
    const row = { id: 'p1', tenant_id: 't1', s3_key: 'k.jpg' };
    await softDeleteAndPurge(pool, row);

    const calls = pool.mockClient.query.mock.calls;
    // Verify the sequence: BEGIN, SET LOCAL tenant_id, SET LOCAL actor_channel='system', UPDATE, COMMIT
    expect(calls[0][0]).toBe('BEGIN');
    const setChannelCall = calls.find(([sql]) => /SET LOCAL app\.actor_channel/i.test(sql));
    expect(setChannelCall).toBeDefined();
    expect(setChannelCall[0]).toMatch(/'system'/);
    // COMMIT must follow
    const commitIdx = calls.findIndex(([sql]) => sql === 'COMMIT');
    expect(commitIdx).toBeGreaterThan(0);
    // client.release() called after commit/rollback
    expect(pool.mockClient.release).toHaveBeenCalled();
  });

  test('#9 SET LOCAL app.tenant_id is set to the row tenant_id', async () => {
    const pool = makePool({ updateRowCount: 1 });
    const row = { id: 'p1', tenant_id: 'tenant-abc', s3_key: 'k.jpg' };
    await softDeleteAndPurge(pool, row);
    const setTenantCall = pool.mockClient.query.mock.calls.find(
      ([sql]) => /SET LOCAL app\.tenant_id/i.test(sql)
    );
    expect(setTenantCall).toBeDefined();
    expect(setTenantCall[1]).toEqual(['tenant-abc']);
  });
});

// ---------------------------------------------------------------------------
// 6. runPurge — integration
// ---------------------------------------------------------------------------
describe('runPurge', () => {
  beforeEach(() => {
    deleteFile.mockClear();
    deleteFile.mockResolvedValue(undefined);
  });

  test('skips when alreadyRanToday returns true', async () => {
    const pool = makePool({ alreadyRanRows: [{ '?column?': 1 }] });
    const r = await runPurge({ pool });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('already_ran_today');
    expect(deleteFile).not.toHaveBeenCalled();
  });

  test('purges all eligible rows + calls S3 delete for each', async () => {
    const pool = makePool({
      eligibleRows: [
        { id: 'p1', tenant_id: 't1', s3_key: 'aesthetic-photos/t1/p1.jpg' },
        { id: 'p2', tenant_id: 't1', s3_key: 'aesthetic-photos/t1/p2.jpg' },
      ],
      updateRowCount: 1,
    });
    const r = await runPurge({ pool });
    expect(r.skipped).toBe(false);
    expect(r.eligible).toBe(2);
    expect(r.purged).toBe(2);
    expect(r.s3_failures).toBe(0);
    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(deleteFile).toHaveBeenCalledWith('aesthetic-photos/t1/p1.jpg');
    expect(deleteFile).toHaveBeenCalledWith('aesthetic-photos/t1/p2.jpg');
  });

  test('S3 failure counted in s3_failures — purged still incremented', async () => {
    deleteFile.mockRejectedValueOnce(new Error('S3 down'));
    const pool = makePool({
      eligibleRows: [{ id: 'p1', tenant_id: 't1', s3_key: 'k.jpg' }],
      updateRowCount: 1,
    });
    const r = await runPurge({ pool });
    expect(r.purged).toBe(1);      // soft delete happened
    expect(r.s3_failures).toBe(1); // S3 failed
    expect(r.results[0].s3_deleted).toBe(false);
  });

  test('UPDATE rowCount=0 → row marked as skipped, S3 not called', async () => {
    const pool = makePool({
      eligibleRows: [{ id: 'p1', tenant_id: 't1', s3_key: 'k.jpg' }],
      updateRowCount: 0,
    });
    const r = await runPurge({ pool });
    expect(r.purged).toBe(0);
    expect(r.results[0].skipped).toBe(true);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  test('forceRun=true bypasses alreadyRanToday check', async () => {
    const pool = makePool({
      alreadyRanRows: [{ '?column?': 1 }], // would normally cause skip
      eligibleRows: [],
    });
    const r = await runPurge({ pool, forceRun: true });
    expect(r.skipped).toBe(false);
    expect(r.eligible).toBe(0);
  });

  test('empty eligible list → purged=0 s3_failures=0', async () => {
    const pool = makePool({ eligibleRows: [] });
    const r = await runPurge({ pool });
    expect(r.skipped).toBe(false);
    expect(r.eligible).toBe(0);
    expect(r.purged).toBe(0);
    expect(r.s3_failures).toBe(0);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  test('ymd reflects the now parameter passed in', async () => {
    const pool = makePool({ eligibleRows: [] });
    const now = new Date(Date.UTC(2026, 4, 11, 7, 0, 0));
    const r = await runPurge({ pool, now });
    expect(r.ymd).toBe('2026-05-11');
  });
});

// ---------------------------------------------------------------------------
// 7. Constants sanity
// ---------------------------------------------------------------------------
describe('module constants', () => {
  test('RETENTION_DAYS is 365 (default)', () => {
    expect(RETENTION_DAYS).toBe(365);
  });

  test('BATCH_LIMIT is 100 (default)', () => {
    expect(BATCH_LIMIT).toBe(100);
  });

  // #11 — TICK_UTC_HOUR exported and defaults to 7
  test('#11 TICK_UTC_HOUR defaults to 7 (= 04:00 BRT, UTC-3 fixed)', () => {
    expect(TICK_UTC_HOUR).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 8. Env var overrides — #11 TICK_UTC_HOUR, #12 RETENTION_DAYS / BATCH_LIMIT
//
// Constants are captured at module-load time. To test env var overrides we
// must re-require the module inside jest.isolateModules after setting env.
// ---------------------------------------------------------------------------
describe('env var overrides', () => {
  // #12 — AESTHETIC_SENSITIVE_RETENTION_DAYS overrides RETENTION_DAYS
  test('#12 RETENTION_DAYS respects AESTHETIC_SENSITIVE_RETENTION_DAYS env var', () => {
    let freshModule;
    jest.isolateModules(() => {
      process.env.AESTHETIC_SENSITIVE_RETENTION_DAYS = '180';
      // re-mock s3 for the freshly required module
      jest.mock('../../src/storage/s3', () => ({ deleteFile: jest.fn() }));
      freshModule = require('../../src/jobs/aesthetic-purge-sensitive');
    });
    delete process.env.AESTHETIC_SENSITIVE_RETENTION_DAYS;
    expect(freshModule.RETENTION_DAYS).toBe(180);
  });

  // #12 — AESTHETIC_PURGE_BATCH overrides BATCH_LIMIT
  test('#12 BATCH_LIMIT respects AESTHETIC_PURGE_BATCH env var', () => {
    let freshModule;
    jest.isolateModules(() => {
      process.env.AESTHETIC_PURGE_BATCH = '50';
      jest.mock('../../src/storage/s3', () => ({ deleteFile: jest.fn() }));
      freshModule = require('../../src/jobs/aesthetic-purge-sensitive');
    });
    delete process.env.AESTHETIC_PURGE_BATCH;
    expect(freshModule.BATCH_LIMIT).toBe(50);
  });

  // #11 — AESTHETIC_PURGE_HOUR_UTC overrides TICK_UTC_HOUR + shouldTickRun behaviour
  test('#11 shouldTickRun respects AESTHETIC_PURGE_HOUR_UTC env var', () => {
    let freshModule;
    jest.isolateModules(() => {
      process.env.AESTHETIC_PURGE_HOUR_UTC = '3';
      jest.mock('../../src/storage/s3', () => ({ deleteFile: jest.fn() }));
      freshModule = require('../../src/jobs/aesthetic-purge-sensitive');
    });
    delete process.env.AESTHETIC_PURGE_HOUR_UTC;
    expect(freshModule.TICK_UTC_HOUR).toBe(3);
    // At UTC 03:00 → true; at UTC 07:00 → false (old default)
    expect(freshModule.shouldTickRun(new Date(Date.UTC(2026, 4, 11, 3, 0, 0)))).toBe(true);
    expect(freshModule.shouldTickRun(new Date(Date.UTC(2026, 4, 11, 7, 0, 0)))).toBe(false);
  });
});
