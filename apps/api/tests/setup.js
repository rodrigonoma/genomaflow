require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

function makePool() {
  return new Pool({ connectionString: process.env.DATABASE_URL_TEST });
}

let pool = makePool();

async function setupTestDb() {
  if (pool.ending) pool = makePool();

  await pool.query(`DELETE FROM tenants WHERE name = 'Test Clinic'`);

  const { rows: [tenant] } = await pool.query(
    `INSERT INTO tenants (name, type, module) VALUES ('Test Clinic', 'clinic', 'human') RETURNING id`
  );

  const hash = await bcrypt.hash('password123', 10);
  await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'doctor')`,
    [tenant.id, 'test@clinic.com', hash]
  );

  return { tenantId: tenant.id };
}

async function teardownTestDb() {
  await pool.query(`DELETE FROM tenants WHERE name = 'Test Clinic'`);
  await pool.end();
}

module.exports = { setupTestDb, teardownTestDb };
