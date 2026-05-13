'use strict';

/**
 * Integration tests para migrations V2 Fase 1 (099-102).
 * Valida que:
 *  - aesthetic_sessions existe com RLS + audit trigger
 *  - aesthetic_photos ganha pose + landmarks + session_id (NULLable, backward compat F1-F6)
 *  - aesthetic_analyses ganha tier (default standard) + session_id + CHECK
 *  - credit_ledger_kind_check aceita kinds *_advanced
 *
 * Pressupõe Postgres real via DATABASE_URL_TEST (não unit test).
 */

const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const { runMigrations, closePool, getPool } = require('../integration/setup');

describe('Migrations V2 Fase 1 (099-102)', () => {
  beforeAll(async () => { await runMigrations(); });
  afterAll(async () => { await closePool(); });

  // -------------------------------------------------------------------------
  // 099 — aesthetic_sessions
  // -------------------------------------------------------------------------
  test('099: aesthetic_sessions existe com colunas esperadas', async () => {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT column_name, data_type
        FROM information_schema.columns
       WHERE table_name='aesthetic_sessions'
       ORDER BY column_name`);
    const names = rows.map(r => r.column_name);
    expect(names).toEqual(expect.arrayContaining([
      'id', 'tenant_id', 'subject_id', 'user_id',
      'session_date', 'session_type', 'notes',
      'deleted_at', 'created_at',
    ]));
  });

  test('099: aesthetic_sessions com RLS habilitado e forçado', async () => {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT relrowsecurity, relforcerowsecurity
        FROM pg_class WHERE relname='aesthetic_sessions'`);
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(true);
  });

  test('099: aesthetic_sessions com audit trigger genérico', async () => {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT tgname FROM pg_trigger
       WHERE tgrelid='aesthetic_sessions'::regclass
         AND tgname='aesthetic_sessions_audit'`);
    expect(rows.length).toBe(1);
  });

  test('099: aesthetic_sessions CHECK session_type whitelist', async () => {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT conname FROM pg_constraint
       WHERE conrelid='aesthetic_sessions'::regclass
         AND conname='aesthetic_sessions_type_check'`);
    expect(rows.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 100 — aesthetic_photos pose + landmarks + session_id
  // -------------------------------------------------------------------------
  test('100: aesthetic_photos ganha pose + landmarks + session_id (todas NULLable)', async () => {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name='aesthetic_photos'
         AND column_name IN ('pose', 'landmarks', 'session_id')
       ORDER BY column_name`);
    const map = Object.fromEntries(rows.map(r => [r.column_name, r]));
    expect(map.pose).toBeDefined();
    expect(map.pose.data_type).toBe('character varying');
    expect(map.pose.is_nullable).toBe('YES');
    expect(map.landmarks).toBeDefined();
    expect(map.landmarks.data_type).toBe('jsonb');
    expect(map.landmarks.is_nullable).toBe('YES');
    expect(map.session_id).toBeDefined();
    expect(map.session_id.data_type).toBe('uuid');
    expect(map.session_id.is_nullable).toBe('YES');
  });

  // -------------------------------------------------------------------------
  // 101 — aesthetic_analyses tier + session_id
  // -------------------------------------------------------------------------
  test('101: aesthetic_analyses ganha tier (default standard, NOT NULL)', async () => {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT column_name, column_default, is_nullable
        FROM information_schema.columns
       WHERE table_name='aesthetic_analyses'
         AND column_name IN ('tier', 'session_id')
       ORDER BY column_name`);
    const map = Object.fromEntries(rows.map(r => [r.column_name, r]));
    expect(map.tier).toBeDefined();
    expect(map.tier.is_nullable).toBe('NO');
    expect(map.tier.column_default).toMatch(/standard/);
    expect(map.session_id).toBeDefined();
    expect(map.session_id.is_nullable).toBe('YES');
  });

  test('101: aesthetic_analyses CHECK tier IN (standard, advanced)', async () => {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT conname FROM pg_constraint
       WHERE conrelid='aesthetic_analyses'::regclass
         AND conname='aesthetic_analyses_tier_check'`);
    expect(rows.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 102 — credit_ledger_kind_check aceita *_advanced
  // -------------------------------------------------------------------------
  test('102: credit_ledger aceita kind aesthetic_facial_analysis_advanced', async () => {
    const pool = getPool();
    // Cria tenant fictício (UUID determinístico) e tenta inserir kind advanced
    const tenantId = '00000000-0000-0000-0000-000000000aaa';
    await pool.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

    // Garante que o tenant existe (pode já existir de outro test); INSERT idempotente
    await pool.query(`
      INSERT INTO tenants (id, name, module)
      VALUES ($1, 'test-v2-migrations', 'estetica')
      ON CONFLICT (id) DO NOTHING`, [tenantId]);

    const insert = await pool.query(`
      INSERT INTO credit_ledger (tenant_id, amount, kind, description)
      VALUES ($1, 10, 'aesthetic_facial_analysis_advanced', 'v2 migration test')
      RETURNING id`, [tenantId]);
    expect(insert.rows.length).toBe(1);

    // Cleanup
    await pool.query(`DELETE FROM credit_ledger WHERE description='v2 migration test'`);
  });

  test('102: credit_ledger ainda rejeita kinds não whitelisted', async () => {
    const pool = getPool();
    const tenantId = '00000000-0000-0000-0000-000000000aaa';
    await expect(pool.query(`
      INSERT INTO credit_ledger (tenant_id, amount, kind, description)
      VALUES ($1, 5, 'totally_invalid_kind', 'should fail')`, [tenantId]))
      .rejects.toThrow(/credit_ledger_kind_check/);
  });
});
