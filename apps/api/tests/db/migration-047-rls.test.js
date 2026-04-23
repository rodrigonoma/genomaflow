const fixtures = require('./fixtures/chat-fixtures');
const { Pool } = require('pg');
const { withTenant } = require('../../src/db/tenant');

// pool: postgres superuser — used for setup inserts (bypasses RLS intentionally)
// appPool: genomaflow_app role — subject to FORCE RLS, used to verify isolation
let pool;
let appPool;

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
  appPool = new Pool({
    connectionString: process.env.DATABASE_URL_TEST
      .replace('postgres:postgres@', 'genomaflow_app:genomaflow_app_2026@'),
  });
});
afterAll(async () => {
  await fixtures.closePool();
  await pool.end();
  await appPool.end();
});
afterEach(() => fixtures.cleanupChatFixtures());

describe('RLS — tenant_chat_settings', () => {
  it('SELECT só vê linha do próprio tenant', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsSet1-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsSet2-' + Date.now() });
    // superuser insert — bypasses RLS (intentional for test setup)
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, false), ($2, false)`,
      [t1.tenantId, t2.tenantId]
    );

    // appPool is subject to FORCE RLS
    const seen = await withTenant(appPool, t1.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT tenant_id FROM tenant_chat_settings`);
      return rows.map(r => r.tenant_id);
    });
    expect(seen).toEqual([t1.tenantId]);
  });

  it('UPDATE não afeta tenant alheio', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsSet1u-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsSet2u-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, false), ($2, false)`,
      [t1.tenantId, t2.tenantId]
    );

    const updated = await withTenant(appPool, t1.tenantId, async (c) => {
      const { rowCount } = await c.query(`UPDATE tenant_chat_settings SET visible_in_directory = true`);
      return rowCount;
    });
    expect(updated).toBe(1);  // só a linha de t1
  });
});

describe('RLS — tenant_blocks', () => {
  it('SELECT só vê bloqueios criados pelo próprio tenant', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsBlk1-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsBlk2-' + Date.now() });
    const t3 = await fixtures.createTenant({ name: 'RlsBlk3-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_blocks (blocker_tenant_id, blocked_tenant_id) VALUES ($1, $2), ($2, $3)`,
      [t1.tenantId, t2.tenantId, t3.tenantId]
    );

    const seen = await withTenant(appPool, t1.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT blocked_tenant_id FROM tenant_blocks`);
      return rows.map(r => r.blocked_tenant_id);
    });
    expect(seen).toEqual([t2.tenantId]);
  });
});

describe('RLS — tenant_directory_listing', () => {
  it('SELECT é livre para qualquer tenant', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsDir1-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsDir2-' + Date.now() });
    // superuser insert into tenant_chat_settings triggers sync_directory (SECURITY DEFINER)
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true), ($2, true)`,
      [t1.tenantId, t2.tenantId]
    );

    // t1 context sees both rows (SELECT is free via tdl_select USING(true))
    const seen = await withTenant(appPool, t1.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT tenant_id FROM tenant_directory_listing WHERE name LIKE 'chat-test-RlsDir%'`
      );
      return rows.length;
    });
    expect(seen).toBe(2);  // tenant t1 vê t2 também
  });

  it('UPDATE só afeta a própria linha', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsDirU1-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsDirU2-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true), ($2, true)`,
      [t1.tenantId, t2.tenantId]
    );

    const updated = await withTenant(appPool, t1.tenantId, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE tenant_directory_listing SET region_uf = 'RJ'`
      );
      return rowCount;
    });
    expect(updated).toBe(1);
  });
});
