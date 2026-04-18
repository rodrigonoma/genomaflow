const fs = require('fs');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { extractText } = require('../parsers/pdf');
const { anonymize } = require('../anonymizer/patient');
const { scrubText } = require('../anonymizer/text');
const { retrieveGuidelines } = require('../rag/retriever');
const { runMetabolicAgent } = require('../agents/metabolic');
const { runCardiovascularAgent } = require('../agents/cardiovascular');
const { runHematologyAgent } = require('../agents/hematology');
const { runSmallAnimalsAgent } = require('../agents/small_animals');
const { runEquineAgent } = require('../agents/equine');
const { runBovineAgent } = require('../agents/bovine');
const { runTherapeuticAgent } = require('../agents/therapeutic');
const { runNutritionAgent } = require('../agents/nutrition');

// Phase 1: specialty agents — routed by module + species
const PHASE1_AGENTS = {
  human: [
    { type: 'metabolic',       runner: runMetabolicAgent },
    { type: 'cardiovascular',  runner: runCardiovascularAgent },
    { type: 'hematology',      runner: runHematologyAgent }
  ],
  veterinary: {
    dog:    [{ type: 'small_animals', runner: runSmallAnimalsAgent }],
    cat:    [{ type: 'small_animals', runner: runSmallAnimalsAgent }],
    equine: [{ type: 'equine',        runner: runEquineAgent }],
    bovine: [{ type: 'bovine',        runner: runBovineAgent }]
  }
};

// Phase 2: synthesis agents — always run after phase 1
const PHASE2_AGENTS = [
  { type: 'therapeutic', runner: runTherapeuticAgent },
  { type: 'nutrition',   runner: runNutritionAgent }
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function persistResult(client, examId, tenantId, agentType, result, usage) {
  await client.query(
    `INSERT INTO clinical_results
       (exam_id, tenant_id, agent_type, interpretation, risk_scores, alerts,
        recommendations, disclaimer, model_version, input_tokens, output_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      examId, tenantId, agentType,
      result.interpretation,
      JSON.stringify(result.risk_scores || {}),
      JSON.stringify(result.alerts || []),
      JSON.stringify(result.recommendations || []),
      result.disclaimer,
      'claude-opus-4-6',
      usage?.input_tokens || 0,
      usage?.output_tokens || 0
    ]
  );
}

async function getBalance(tenantId, pg) {
  const res = await pg.query(
    'SELECT COALESCE(balance, 0) AS balance FROM tenant_credit_balance WHERE tenant_id = $1',
    [tenantId]
  );
  return Number(res.rows[0]?.balance ?? 0);
}

async function debitCredit(tenantId, examId, agentType, pg) {
  await pg.query(
    `INSERT INTO credit_ledger (tenant_id, amount, kind, exam_id, description)
     VALUES ($1, -1, 'agent_usage', $2, $3)`,
    [tenantId, examId, `Agent: ${agentType}`]
  );
}

async function checkLowCreditAlert(tenantId, pg, redis) {
  const balance = await getBalance(tenantId, pg);
  if (balance <= 0 && redis) {
    redis.publish(`billing:exhausted:${tenantId}`, JSON.stringify({ balance }));
    return;
  }
  const grantedRes = await pg.query(
    `SELECT COALESCE(SUM(amount), 0) AS granted FROM credit_ledger
     WHERE tenant_id = $1 AND amount > 0 AND created_at >= NOW() - INTERVAL '30 days'`,
    [tenantId]
  );
  const granted = Number(grantedRes.rows[0].granted);
  if (granted > 0 && balance / granted <= 0.20 && redis) {
    redis.publish(`billing:alert:${tenantId}`, JSON.stringify({ balance, granted }));
  }
}

/**
 * Full exam processing pipeline:
 * parse → anonymize → RAG → phase1 agents → phase2 agents → persist → notify
 *
 * @param {{ exam_id: string, tenant_id: string, file_path: string }} jobData
 */
async function processExam({ exam_id, tenant_id, file_path, selected_agents, chief_complaint, current_symptoms }) {
  const client = await pool.connect();
  let processingError = null;

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant_id]);

    await client.query(
      `UPDATE exams SET status = 'processing', updated_at = NOW() WHERE id = $1`,
      [exam_id]
    );

    // Fetch subject + tenant module
    const { rows } = await client.query(
      `SELECT s.name, s.birth_date, s.sex, s.subject_type, s.species,
              t.module
       FROM exams e
       JOIN subjects s ON s.id = e.subject_id
       JOIN tenants  t ON t.id = e.tenant_id
       WHERE e.id = $1`,
      [exam_id]
    );
    const subject = rows[0];
    const tenantModule = subject.module;

    // Guard: subject_type must match tenant module
    const expectedType = tenantModule === 'human' ? 'human' : 'animal';
    if (subject.subject_type !== expectedType) {
      await client.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [`Module mismatch: tenant module is "${tenantModule}" but subject type is "${subject.subject_type}"`, exam_id]
      );
      await client.query('COMMIT');
      return;
    }

    if (!file_path) throw new Error('exam has no file_path — PDF download may have failed during ingest');
    const buffer = fs.readFileSync(file_path);
    const rawText = await extractText(buffer);
    const examText = scrubText(rawText);
    const anonSubject = anonymize(subject);

    // Determine Phase 1 agents
    let phase1;
    if (tenantModule === 'human') {
      phase1 = selected_agents?.length
        ? PHASE1_AGENTS.human.filter(a => selected_agents.includes(a.type))
        : PHASE1_AGENTS.human;
      if (!phase1.length) phase1 = PHASE1_AGENTS.human;
    } else {
      phase1 = PHASE1_AGENTS.veterinary[subject.species] || [];
    }

    if (phase1.length === 0) {
      await client.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [`No agent configured for species: ${subject.species}`, exam_id]
      );
      await client.query('COMMIT');
      return;
    }

    // Balance check before running agents
    const allAgents = [...phase1, ...PHASE2_AGENTS];
    const balance = await getBalance(tenant_id, client);
    if (balance < allAgents.length) {
      await client.query(
        "UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2",
        ['Saldo de créditos insuficiente — recarregue seus créditos e envie novamente', exam_id]
      );
      await client.query('COMMIT');
      return;
    }

    // Redis instance for billing alerts (best-effort)
    let billingRedis = null;
    try { billingRedis = new Redis(process.env.REDIS_URL); } catch (_) {}

    // Phase 1 — specialty agents (sequential)
    const specialtyResults = [];
    for (const { type, runner } of phase1) {
      const guidelines = await retrieveGuidelines(client, examText, 5, tenantModule, subject.species || null);
      const { result, usage } = await runner({ examText, patient: anonSubject, guidelines });
      specialtyResults.push({ agent_type: type, ...result });
      await persistResult(client, exam_id, tenant_id, type, result, usage);
      await debitCredit(tenant_id, exam_id, type, client);
      await checkLowCreditAlert(tenant_id, client, billingRedis);
    }

    // Phase 2 — synthesis agents (parallel)
    const phase2Ctx = {
      examText,
      patient: anonSubject,
      specialtyResults,
      module: tenantModule,
      species: subject.species || null,
      chief_complaint: chief_complaint || '',
      current_symptoms: current_symptoms || ''
    };
    const phase2Responses = await Promise.all(
      PHASE2_AGENTS.map(({ runner }) => runner(phase2Ctx))
    );
    for (let i = 0; i < PHASE2_AGENTS.length; i++) {
      const { result, usage } = phase2Responses[i];
      await persistResult(client, exam_id, tenant_id, PHASE2_AGENTS[i].type, result, usage);
      await debitCredit(tenant_id, exam_id, PHASE2_AGENTS[i].type, client);
      await checkLowCreditAlert(tenant_id, client, billingRedis);
    }

    if (billingRedis) { try { await billingRedis.quit(); } catch (_) {} }

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
    try {
      const pub = new Redis(process.env.REDIS_URL);
      await pub.publish(`exam:error:${tenant_id}`, JSON.stringify({ exam_id, error_message: processingError.message }));
      await pub.quit();
    } catch (_) {}
    throw processingError;
  }

  try {
    const pub = new Redis(process.env.REDIS_URL);
    await pub.publish(`exam:done:${tenant_id}`, JSON.stringify({ exam_id }));
    await pub.quit();
  } catch (redisErr) {
    console.error(`[processor] Redis notify failed for exam ${exam_id}:`, redisErr.message);
  }
}

module.exports = { processExam };
