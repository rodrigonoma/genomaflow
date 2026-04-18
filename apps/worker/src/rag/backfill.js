// apps/worker/src/rag/backfill.js
// One-time script: indexes all existing 'done' exams into chat_embeddings.
// Run: node apps/worker/src/rag/backfill.js
// Safe to re-run: indexExam() deletes old chunks before inserting.

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Pool } = require('pg');
const { indexExam } = require('./indexer');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(
    `SELECT id, tenant_id FROM exams WHERE status = 'done' ORDER BY created_at ASC`
  );

  console.log(`[backfill] Found ${rows.length} done exams to index.`);
  if (rows.length === 0) { await pool.end(); return; }

  let ok = 0, failed = 0;
  for (const { id, tenant_id } of rows) {
    try {
      await indexExam(id, tenant_id);
      ok++;
      if (ok % 10 === 0) console.log(`[backfill] Progress: ${ok}/${rows.length}`);
    } catch (err) {
      failed++;
      console.error(`[backfill] Failed exam ${id}:`, err.message);
    }
  }

  console.log(`[backfill] Done. ${ok} indexed, ${failed} failed.`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
