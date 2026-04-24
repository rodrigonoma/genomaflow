const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');

const PREFIX = 'chat-api-test-';
let pool;

function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
  return pool;
}

/**
 * Cria tenant + admin user + assina JWT válido pra esse user.
 * Retorna { tenantId, userId, email, token, module }.
 */
async function createTenantWithAdmin(app, { name, module = 'human' } = {}) {
  const p = getPool();
  const fullName = PREFIX + (name || 'T-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  const { rows: [t] } = await p.query(
    `INSERT INTO tenants (name, type, module, active) VALUES ($1, 'clinic', $2, true) RETURNING id`,
    [fullName, module]
  );
  const hash = await bcrypt.hash('test-pwd', 10);
  const email = `${PREFIX}${randomUUID().slice(0, 8)}@test.com`;
  const { rows: [u] } = await p.query(
    `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id`,
    [t.id, email, hash]
  );
  const jti = randomUUID();
  const token = app.jwt.sign({
    user_id: u.id,
    tenant_id: t.id,
    role: 'admin',
    module,
    jti,
  });
  if (app.redis) await app.redis.set(`session:${u.id}`, jti, 'EX', 3600);
  return { tenantId: t.id, userId: u.id, email, token, module };
}

/**
 * Cria 2 tenants do mesmo módulo já com convite aceito + conversation criada.
 * Retorna { a, b, conversationId }.
 */
async function createConversedPair(app, { module = 'human' } = {}) {
  const p = getPool();
  const a = await createTenantWithAdmin(app, { module });
  const b = await createTenantWithAdmin(app, { module });
  const [low, high] = a.tenantId < b.tenantId ? [a, b] : [b, a];
  const { rows: [conv] } = await p.query(
    `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module) VALUES ($1, $2, $3) RETURNING id`,
    [low.tenantId, high.tenantId, module]
  );
  return { a, b, conversationId: conv.id };
}

async function cleanup() {
  const p = getPool();
  // FK-safe order: reactions → reads (FK aponta pra messages) → messages → tenants
  await p.query(`DELETE FROM tenant_message_reactions WHERE reactor_tenant_id IN (SELECT id FROM tenants WHERE name LIKE $1)`, [PREFIX + '%']);
  await p.query(`DELETE FROM tenant_conversation_reads WHERE tenant_id IN (SELECT id FROM tenants WHERE name LIKE $1)`, [PREFIX + '%']);
  await p.query(`DELETE FROM tenant_messages WHERE sender_tenant_id IN (SELECT id FROM tenants WHERE name LIKE $1)`, [PREFIX + '%']);
  await p.query(`DELETE FROM tenants WHERE name LIKE $1`, [PREFIX + '%']);
}

async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { PREFIX, getPool, createTenantWithAdmin, createConversedPair, cleanup, closePool };
