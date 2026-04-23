const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const PREFIX = 'chat-test-';
let pool;

function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
  return pool;
}

async function createTenant({ name, module = 'human', uf = 'SP' }) {
  const p = getPool();
  const { rows: [t] } = await p.query(
    `INSERT INTO tenants (name, type, module, active) VALUES ($1, 'clinic', $2, true) RETURNING id`,
    [PREFIX + name, module]
  );
  const hash = await bcrypt.hash('test-password', 10);
  const { rows: [u] } = await p.query(
    `INSERT INTO users (tenant_id, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin') RETURNING id`,
    [t.id, `${PREFIX}${name.toLowerCase()}@test.com`, hash]
  );
  return { tenantId: t.id, userId: u.id, module };
}

/** Retorna par canônico (a < b) já criado de tenants do mesmo módulo. */
async function createPair({ module = 'human' } = {}) {
  const t1 = await createTenant({ name: 'Pair-A-' + Date.now(), module });
  const t2 = await createTenant({ name: 'Pair-B-' + Date.now(), module });
  const [a, b] = t1.tenantId < t2.tenantId ? [t1, t2] : [t2, t1];
  return { a, b };
}

async function cleanupChatFixtures() {
  const p = getPool();
  // Delete in FK-safe order. tenant_conversation_reads has a non-cascading
  // FK on tenant_id, so it must be removed before tenant_conversations (which
  // would cascade the conversation_id FK) and before tenants.
  await p.query(`
    DELETE FROM tenant_conversation_reads
    WHERE tenant_id IN (SELECT id FROM tenants WHERE name LIKE $1)
  `, [PREFIX + '%']);
  // tenant_messages has a non-cascading FK on sender_tenant_id.
  await p.query(`
    DELETE FROM tenant_messages
    WHERE sender_tenant_id IN (SELECT id FROM tenants WHERE name LIKE $1)
  `, [PREFIX + '%']);
  // Deleting tenants cascades to: tenant_conversations → tenant_messages (remaining),
  // tenant_invitations, tenant_blocks, tenant_chat_settings, tenant_directory_listing.
  await p.query(`DELETE FROM tenants WHERE name LIKE $1`, [PREFIX + '%']);
}

async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { createTenant, createPair, cleanupChatFixtures, closePool, getPool };
