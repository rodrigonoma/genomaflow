'use strict';
/**
 * Schema tests pra migration 053 (scheduling).
 *
 * Validam contra Postgres real:
 *  - RLS isola appointments cross-tenant
 *  - EXCLUDE constraint (DB-enforced) impede agendamentos sobrepostos
 *  - Cancelar libera o slot
 *  - Check constraints (duration, status enum, default_slot_minutes enum)
 *
 * Conexão usa role `genomaflow_app` (sem BYPASSRLS, garantido por migration 046).
 *
 * NÃO entram no `test:unit` (CI gate) — exigem Postgres ativo. Rodar local com
 * docker compose ou em ambiente integrado dedicado.
 */

const { Pool } = require('pg');

// Conexão DEDICADA pra estes tests — usa role genomaflow_app (sem BYPASSRLS,
// garantido por migration 046). Hardcoded pra não sofrer interferência de
// .env / dotenv.config() de outros tests; se rodar em CI com docker compose,
// localhost aponta pra DB exposto. Caller pode override via
// SCHEDULING_TEST_DB_URL pra ambientes diferentes.
const pool = new Pool({
  connectionString: process.env.SCHEDULING_TEST_DB_URL ||
    'postgres://genomaflow_app:genomaflow_app_2026@localhost:5432/genomaflow',
});

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

async function withTenant(tenantId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe('migration 053 — scheduling schema', () => {
  let userA, userB;

  beforeAll(async () => {
    // tenants NÃO tem RLS — INSERT direto OK (genomaflow_app tem grant)
    await pool.query(
      `INSERT INTO tenants (id, name, type, plan, module)
       VALUES ($1, 'Test 053-A', 'clinic', 'starter', 'human'),
              ($2, 'Test 053-B', 'clinic', 'starter', 'veterinary')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_A, TENANT_B]
    );

    // users TEM RLS FORCE — INSERT exige withTenant pra cada um
    // (users não tem coluna `name`; identidade via email + tenant_id)
    const ua = await withTenant(TENANT_A, (c) => c.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, 'doc-a-053@test.com', 'x', 'admin')
       ON CONFLICT (email) DO UPDATE SET password_hash = 'x'
       RETURNING id`,
      [TENANT_A]
    ));
    const ub = await withTenant(TENANT_B, (c) => c.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, 'doc-b-053@test.com', 'x', 'admin')
       ON CONFLICT (email) DO UPDATE SET password_hash = 'x'
       RETURNING id`,
      [TENANT_B]
    ));
    userA = ua.rows[0].id;
    userB = ub.rows[0].id;
  });

  afterAll(async () => {
    // Cleanup: remove tudo dos test users
    await pool.query('DELETE FROM appointments WHERE user_id = ANY($1)', [[userA, userB]]);
    await pool.query('DELETE FROM schedule_settings WHERE user_id = ANY($1)', [[userA, userB]]);
    await pool.end();
  });

  // ── RLS ──────────────────────────────────────────────────────────
  describe('RLS isolation', () => {
    test('tenant A não vê appointments do tenant B', async () => {
      // Insere via tenant B
      await withTenant(TENANT_B, (c) => c.query(
        `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
         VALUES ($1, $2, '2030-01-01 10:00:00+00', 30, 'scheduled', $2)`,
        [TENANT_B, userB]
      ));

      // Lê via tenant A
      const visible = await withTenant(TENANT_A, (c) =>
        c.query(`SELECT COUNT(*)::int AS n FROM appointments WHERE user_id = $1`, [userB])
      );
      expect(visible.rows[0].n).toBe(0);
    });
  });

  // ── EXCLUDE constraint ───────────────────────────────────────────
  describe('EXCLUDE constraint (DB-enforced overlap)', () => {
    test('agendamento sobreposto retorna erro 23P01', async () => {
      await withTenant(TENANT_A, async (c) => {
        await c.query(
          `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
           VALUES ($1, $2, '2030-02-01 10:00:00+00', 30, 'scheduled', $2)`,
          [TENANT_A, userA]
        );
        await expect(c.query(
          `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
           VALUES ($1, $2, '2030-02-01 10:15:00+00', 30, 'scheduled', $2)`,
          [TENANT_A, userA]
        )).rejects.toMatchObject({ code: '23P01' });
      });
    });

    test('agendamentos adjacentes (10:00–10:30 e 10:30–11:00) são permitidos', async () => {
      await withTenant(TENANT_A, async (c) => {
        await c.query(
          `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
           VALUES ($1, $2, '2030-03-01 10:00:00+00', 30, 'scheduled', $2)`,
          [TENANT_A, userA]
        );
        await expect(c.query(
          `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
           VALUES ($1, $2, '2030-03-01 10:30:00+00', 30, 'scheduled', $2)`,
          [TENANT_A, userA]
        )).resolves.toBeDefined();
      });
    });

    test('cancelar libera o slot — agendamento substituto cabe', async () => {
      await withTenant(TENANT_A, async (c) => {
        const r1 = await c.query(
          `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
           VALUES ($1, $2, '2030-04-01 10:00:00+00', 30, 'scheduled', $2)
           RETURNING id`,
          [TENANT_A, userA]
        );
        const id = r1.rows[0].id;

        // Cancela
        await c.query(
          `UPDATE appointments SET status='cancelled', cancelled_at=NOW() WHERE id=$1`,
          [id]
        );

        // Novo agendamento no mesmo horário deve passar
        await expect(c.query(
          `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
           VALUES ($1, $2, '2030-04-01 10:00:00+00', 30, 'scheduled', $2)`,
          [TENANT_A, userA]
        )).resolves.toBeDefined();
      });
    });
  });

  // ── Check constraints ────────────────────────────────────────────
  describe('check constraints', () => {
    test('duration_minutes < 5 rejeitado', async () => {
      await withTenant(TENANT_A, async (c) => {
        await expect(c.query(
          `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
           VALUES ($1, $2, '2030-05-01 10:00:00+00', 4, 'scheduled', $2)`,
          [TENANT_A, userA]
        )).rejects.toThrow();
      });
    });

    test('duration_minutes > 480 rejeitado', async () => {
      await withTenant(TENANT_A, async (c) => {
        await expect(c.query(
          `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
           VALUES ($1, $2, '2030-05-02 10:00:00+00', 481, 'scheduled', $2)`,
          [TENANT_A, userA]
        )).rejects.toThrow();
      });
    });

    test('default_slot_minutes fora do enum CHECK rejeitado em schedule_settings', async () => {
      await withTenant(TENANT_A, async (c) => {
        await expect(c.query(
          `INSERT INTO schedule_settings (user_id, tenant_id, default_slot_minutes)
           VALUES ($1, $2, 35)`,
          [userA, TENANT_A]
        )).rejects.toThrow();
      });
    });

    test('status fora do enum CHECK rejeitado', async () => {
      await withTenant(TENANT_A, async (c) => {
        await expect(c.query(
          `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
           VALUES ($1, $2, '2030-06-01 10:00:00+00', 30, 'invalid_status', $2)`,
          [TENANT_A, userA]
        )).rejects.toThrow();
      });
    });
  });
});
