const fs = require('fs');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { extractText } = require('../parsers/pdf');
const { anonymize } = require('../anonymizer/patient');
const { scrubText } = require('../anonymizer/text');
const { classifyAgents } = require('../classifier/markers');
const { retrieveGuidelines } = require('../rag/retriever');
const { runMetabolicAgent } = require('../agents/metabolic');
const { runCardiovascularAgent } = require('../agents/cardiovascular');
const { runHematologyAgent } = require('../agents/hematology');

const AGENT_RUNNERS = {
  metabolic: runMetabolicAgent,
  cardiovascular: runCardiovascularAgent,
  hematology: runHematologyAgent
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Full exam processing pipeline:
 * parse → anonymize → classify → RAG → agents → persist → notify
 *
 * @param {{ exam_id: string, tenant_id: string, file_path: string }} jobData
 */
async function processExam({ exam_id, tenant_id, file_path }) {
  const client = await pool.connect();
  let processingError = null;

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant_id]);

    await client.query(
      `UPDATE exams SET status = 'processing', updated_at = NOW() WHERE id = $1`,
      [exam_id]
    );

    const { rows } = await client.query(
      `SELECT p.name, p.birth_date, p.sex
       FROM exams e JOIN patients p ON p.id = e.patient_id
       WHERE e.id = $1`,
      [exam_id]
    );
    const patient = rows[0];

    if (!file_path) throw new Error('exam has no file_path — PDF download may have failed during ingest');
    const buffer = fs.readFileSync(file_path);
    const rawText = await extractText(buffer);
    // Scrub PII from the raw PDF text before it leaves the system (LGPD)
    const examText = scrubText(rawText);
    const anonPatient = anonymize(patient);
    const agentNames = classifyAgents(examText);

    if (agentNames.length === 0) {
      await client.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        ['No recognized clinical markers found', exam_id]
      );
      await client.query('COMMIT');
      return;
    }

    for (const agentName of agentNames) {
      const runner = AGENT_RUNNERS[agentName];
      if (!runner) continue;

      const guidelines = await retrieveGuidelines(client, examText);
      const result = await runner({ examText, patient: anonPatient, guidelines });

      await client.query(
        `INSERT INTO clinical_results
           (exam_id, tenant_id, agent_type, interpretation, risk_scores, alerts, disclaimer, model_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          exam_id, tenant_id, agentName,
          result.interpretation,
          JSON.stringify(result.risk_scores),
          JSON.stringify(result.alerts),
          result.disclaimer,
          'claude-sonnet-4-6'
        ]
      );
    }

    await client.query(
      `UPDATE exams SET status = 'done', updated_at = NOW() WHERE id = $1`,
      [exam_id]
    );

    await client.query('COMMIT');

  } catch (err) {
    processingError = err;
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
  }

  // If the pipeline failed, update exam status in a fresh transaction.
  // A new connection is required because SET LOCAL was rolled back with the
  // main transaction — without this, FORCE ROW LEVEL SECURITY would block
  // the UPDATE since app.tenant_id would not be set.
  if (processingError) {
    const errorClient = await pool.connect();
    try {
      await errorClient.query('BEGIN');
      await errorClient.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant_id]);
      await errorClient.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [processingError.message, exam_id]
      );
      await errorClient.query('COMMIT');
    } catch (updateErr) {
      await errorClient.query('ROLLBACK').catch(() => {});
      console.error('[processor] Failed to update exam error status:', updateErr.message);
    } finally {
      errorClient.release();
    }
    throw processingError;
  }

  // Notify API via Redis pub/sub — separate try/catch so a Redis failure
  // doesn't corrupt the exam status after a successful COMMIT
  try {
    const pub = new Redis(process.env.REDIS_URL);
    await pub.publish(`exam:done:${tenant_id}`, JSON.stringify({ exam_id }));
    await pub.quit();
  } catch (redisErr) {
    // Log but do not rethrow — exam is already successfully processed
    console.error(`[processor] Redis notify failed for exam ${exam_id}:`, redisErr.message);
  }
}

module.exports = { processExam };
