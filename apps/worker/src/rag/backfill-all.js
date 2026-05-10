require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Pool }   = require('pg');
const { indexExam, indexSubject, indexAggregates } = require('./indexer');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

async function queryWithTenant(client, tenant_id, sql, params = []) {
  await client.query('BEGIN');
  await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant_id]);
  const res = await client.query(sql, params);
  await client.query('COMMIT');
  return res.rows;
}

async function main() {
  const { rows: tenants } = await pool.query(`SELECT id, name FROM tenants ORDER BY name`);
  console.log(`[backfill-all] ${tenants.length} tenant(s) encontrado(s)`);

  for (const tenant of tenants) {
    const { id: tenant_id, name } = tenant;
    console.log(`\n[backfill-all] === Tenant: ${name} (${tenant_id}) ===`);

    const client = await pool.connect();
    let subjects = [], exams = [];
    try {
      subjects = await queryWithTenant(client,  tenant_id,
        `SELECT id, name FROM subjects WHERE deleted_at IS NULL ORDER BY name`);
      exams = await queryWithTenant(client, tenant_id,
        `SELECT id FROM exams WHERE status = 'done'`);
    } finally {
      client.release();
    }

    // 1. Pacientes/animais
    console.log(`[backfill-all] ${subjects.length} pacientes/animais`);
    for (const { id, name: sname } of subjects) {
      try {
        await indexSubject(id, tenant_id);
      } catch (err) {
        console.error(`[backfill-all]   Erro paciente ${sname}:`, err.message);
      }
    }

    // 2. Exames
    console.log(`[backfill-all] ${exams.length} exames concluídos`);
    let ok = 0;
    for (const { id } of exams) {
      try {
        await indexExam(id, tenant_id);
        if (++ok % 5 === 0) console.log(`[backfill-all]   Exames: ${ok}/${exams.length}`);
      } catch (err) {
        console.error(`[backfill-all]   Erro exame ${id}:`, err.message);
      }
    }

    // 3. Agregados
    console.log(`[backfill-all] Indexando agregados...`);
    try {
      await indexAggregates(tenant_id);
    } catch (err) {
      console.error(`[backfill-all]   Erro agregados:`, err.message);
    }
  }

  console.log('\n[backfill-all] Concluído!');
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
