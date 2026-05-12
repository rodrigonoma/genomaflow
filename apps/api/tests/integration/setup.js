'use strict';

/**
 * Integration test setup — Postgres real, schema completo via migrations.
 *
 * Pega bugs que tests mockados não pegam:
 * - Schema mismatches (column inexistente — bug 2026-05-12 updated_at)
 * - RLS policy errors
 * - Audit trigger failures
 * - Foreign key violations
 *
 * Pressupõe DATABASE_URL_TEST setado apontando pra Postgres limpo.
 * No CI: service container postgres:15. Local: docker compose db.
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

function makePool() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST não setado — integration tests exigem Postgres real');
  return new Pool({ connectionString: url, max: 5 });
}

let pool = makePool();

/**
 * Aplica todas as migrations em ordem. Idempotente.
 * No CI as migrations são aplicadas no step `apply migrations` ANTES do Jest
 * (pra não competir com Fastify pluginTimeout). Aqui mantém pra dev local.
 */
async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const dir = path.join(__dirname, '..', '..', 'src', 'db', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rows } = await pool.query('SELECT filename FROM _migrations WHERE filename = $1', [file]);
    if (rows.length) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`[integration setup] migration ${file} failed:`, e.message);
      throw e;
    } finally {
      client.release();
    }
  }
}

/**
 * Cria tenant + admin user + esteticista user + subject (paciente humano).
 * Tenant module='estetica' pra ativar requireEsteticaModule middleware.
 * Returns IDs pra uso nos tests.
 */
async function seedAestheticTenant() {
  if (pool.ending) pool = makePool();

  // Limpa state anterior (sem disparar audit_trigger_fn — mesmo motivo do teardown)
  await pool.query(`SET session_replication_role = replica`);
  try {
    await pool.query(`DELETE FROM tenants WHERE name = 'Integration Test Estetica'`);
  } finally {
    await pool.query(`SET session_replication_role = origin`).catch(() => {});
  }

  const { rows: [tenant] } = await pool.query(
    `INSERT INTO tenants (name, type, module, active)
     VALUES ('Integration Test Estetica', 'clinic', 'estetica', true)
     RETURNING id`
  );

  const hash = await bcrypt.hash('password123', 10);
  const { rows: [admin] } = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, role, active)
     VALUES ($1, 'integration-admin@test.local', $2, 'admin', true)
     RETURNING id`,
    [tenant.id, hash]
  );

  const { rows: [subject] } = await pool.query(
    `INSERT INTO subjects (tenant_id, name, birth_date, sex, subject_type)
     VALUES ($1, 'Integration Patient', '1990-01-01', 'F', 'human')
     RETURNING id`,
    [tenant.id]
  );

  // Set tenant_id session var pra RLS funcionar nos próximos queries diretos
  await pool.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenant.id]);

  return { tenantId: tenant.id, adminUserId: admin.id, subjectId: subject.id };
}

async function teardownAestheticTenant() {
  // Desabilita user triggers no escopo desta connection.
  // Caso contrário: DELETE FROM tenants → CASCADE deleta subjects → audit_trigger_fn
  // INSERT INTO audit_log (tenant_id=X) → FK violation (tenant X sendo deletado).
  // Em prod ninguém faz DELETE de tenant — só ocorre em teardown de teste.
  await pool.query(`SET session_replication_role = replica`);
  try {
    await pool.query(`DELETE FROM tenants WHERE name = 'Integration Test Estetica'`);
  } finally {
    await pool.query(`SET session_replication_role = origin`).catch(() => {});
  }
}

async function closePool() {
  if (!pool.ending) await pool.end();
}

function getPool() {
  return pool;
}

/** Gera JWT pro user. Reusa segredo do app. */
function signJwt({ user_id, tenant_id, role = 'admin', module = 'estetica', professional_type = 'esteticista' }) {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { user_id, tenant_id, role, module, professional_type },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
}

module.exports = {
  runMigrations,
  seedAestheticTenant,
  teardownAestheticTenant,
  closePool,
  getPool,
  signJwt,
};
