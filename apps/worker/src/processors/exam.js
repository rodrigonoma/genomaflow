const fs = require('fs');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { extractText } = require('../parsers/pdf');
const { anonymize } = require('../anonymizer/patient');
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

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.tenant_id = $1', [tenant_id]);

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

    const buffer = fs.readFileSync(file_path);
    const examText = await extractText(buffer);
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

    const pub = new Redis(process.env.REDIS_URL);
    await pub.publish(`exam:done:${tenant_id}`, JSON.stringify({ exam_id }));
    await pub.quit();

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await pool.query(
      `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
      [err.message, exam_id]
    );
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { processExam };
