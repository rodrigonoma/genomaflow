require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function poolConfig() {
  // Prefer DATABASE_URL_ADMIN for schema changes (owner of tables).
  // Fallback to DATABASE_URL for environments that don't separate admin/app users.
  const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
  if (url) return { connectionString: url };
  return {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  };
}

async function migrate() {
  const pool = new Pool(poolConfig());
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT filename FROM _migrations WHERE filename = $1', [file]
      );
      if (rows.length > 0) { console.log(`[skip] ${file}`); continue; }

      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      console.log(`[apply] ${file}`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('Migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
