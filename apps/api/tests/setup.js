require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

function makePool() {
  return new Pool({ connectionString: process.env.DATABASE_URL_TEST });
}

let pool = makePool();

async function setupTestDb() {
  // Recreate pool if it was ended by a previous test suite
  if (pool.ending) pool = makePool();

  // Delete tenant first — CASCADE removes users, patients, exams, clinical_results
  await pool.query(`DELETE FROM tenants WHERE name = 'Test Clinic'`);

  const { rows: [tenant] } = await pool.query(
    `INSERT INTO tenants (name, type) VALUES ('Test Clinic', 'clinic') RETURNING id`
  );

  const hash = await bcrypt.hash('password123', 10);
  await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'doctor')`,
    [tenant.id, 'test@clinic.com', hash]
  );

  return { tenantId: tenant.id };
}

async function teardownTestDb() {
  // Delete tenant first — CASCADE removes users, patients, exams, clinical_results
  await pool.query(`DELETE FROM tenants WHERE name = 'Test Clinic'`);
  await pool.end();
}

module.exports = { setupTestDb, teardownTestDb };
