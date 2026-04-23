const fixtures = require('./fixtures/chat-fixtures');
const { Pool } = require('pg');

let pool;

beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST }); });
afterAll(async () => { await fixtures.closePool(); await pool.end(); });
afterEach(() => fixtures.cleanupChatFixtures());

async function dirRowExists(tenantId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM tenant_directory_listing WHERE tenant_id = $1`, [tenantId]
  );
  return rows.length === 1;
}

describe('Trigger sync_directory', () => {
  it('NÃO insere no diretório quando visible_in_directory = false', async () => {
    const t = await fixtures.createTenant({ name: 'DirOff-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, false)`,
      [t.tenantId]
    );
    expect(await dirRowExists(t.tenantId)).toBe(false);
  });

  it('insere no diretório quando visible_in_directory = true', async () => {
    const t = await fixtures.createTenant({ name: 'DirOn-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)`,
      [t.tenantId]
    );
    expect(await dirRowExists(t.tenantId)).toBe(true);
  });

  it('deleta do diretório quando visible_in_directory muda para false', async () => {
    const t = await fixtures.createTenant({ name: 'DirToggle-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)`,
      [t.tenantId]
    );
    expect(await dirRowExists(t.tenantId)).toBe(true);

    await pool.query(
      `UPDATE tenant_chat_settings SET visible_in_directory = false WHERE tenant_id = $1`,
      [t.tenantId]
    );
    expect(await dirRowExists(t.tenantId)).toBe(false);
  });

  it('insere com nome e módulo corretos a partir de tenants', async () => {
    const t = await fixtures.createTenant({ name: 'DirNameSync-' + Date.now(), module: 'veterinary' });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)`,
      [t.tenantId]
    );
    const { rows } = await pool.query(
      `SELECT name, module FROM tenant_directory_listing WHERE tenant_id = $1`, [t.tenantId]
    );
    expect(rows[0].name).toMatch(/DirNameSync/);
    expect(rows[0].module).toBe('veterinary');
  });
});
