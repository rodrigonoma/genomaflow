const { Pool } = require('pg');
const { downloadFile, uploadFile, deleteFile, keyFromPath, BUCKET } = require('../storage/s3');
const Redis = require('ioredis');
const MODELS = require('../config/models');
const { dicomToImage } = require('../converters/dicom');
const { classifyModality, detectImageMime } = require('../classifiers/imaging');
const { runImagingRxAgent } = require('../agents/imaging-rx');
const { runImagingEcgAgent } = require('../agents/imaging-ecg');
const { runImagingUltrasoundAgent } = require('../agents/imaging-ultrasound');
const { runImagingMriAgent } = require('../agents/imaging-mri');
const { extractText } = require('../parsers/pdf');
const { classifyImageContent, ocrLabReport } = require('../parsers/image');
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
const { runClinicalCorrelationAgent } = require('../agents/clinical_correlation');
const { indexExam } = require('../rag/indexer');

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

function flattenCorrelationResult(result) {
  const recs = [];
  for (const se of result.suggested_exams || []) {
    recs.push({ type: 'suggested_exam', _exam: se.exam, _rationale: se.rationale, description: `${se.exam}: ${se.rationale}`, priority: 'medium' });
  }
  for (const cf of result.contextual_factors || []) {
    recs.push({ type: 'contextual_factor', description: cf, priority: 'low' });
  }
  return { ...result, recommendations: recs };
}

// Phase 2: synthesis agents — always run after phase 1
// humanOnly: true means the agent is skipped for veterinary module
const PHASE2_AGENTS = [
  { type: 'therapeutic',          runner: runTherapeuticAgent },
  { type: 'nutrition',            runner: runNutritionAgent },
  { type: 'clinical_correlation', runner: runClinicalCorrelationAgent, humanOnly: true, flattenResult: flattenCorrelationResult }
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
      MODELS.CLINICAL_AGENT,
      usage?.input_tokens || 0,
      usage?.output_tokens || 0
    ]
  );

  // Push para alertas clínicos críticos
  try {
    const alerts = result.alerts || [];
    const hasCritical = alerts.some(a => ['critical', 'high'].includes((a.severity || '').toLowerCase()));
    if (hasCritical) {
      const { sendToUser } = require('../../../api/src/services/push');
      const { rows: examRows } = await client.query(
        'SELECT user_id, subject_id FROM exams WHERE id = $1 AND tenant_id = $2',
        [examId, tenantId]
      );
      if (examRows[0]) {
        const { rows: subjectRows } = await client.query(
          'SELECT name FROM subjects WHERE id = $1 AND tenant_id = $2',
          [examRows[0].subject_id, tenantId]
        );
        const patientName = subjectRows[0]?.name ?? 'Paciente';
        await sendToUser(pool, examRows[0].user_id, {
          title: 'Alerta clínico',
          body: `Alerta crítico no exame de ${patientName}`,
          data: { route: `/doctor/patients/${examRows[0].subject_id}` }
        });
      }
    }
  } catch (e) {
    console.error('[push] clinical alert push error:', e.message);
  }
}

async function persistImagingResult(client, examId, tenantId, agentType, result, usage, imageMetadata) {
  await client.query(
    `INSERT INTO clinical_results
       (exam_id, tenant_id, agent_type, interpretation, risk_scores, alerts,
        recommendations, disclaimer, model_version, input_tokens, output_tokens, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      examId, tenantId, agentType,
      result.interpretation,
      JSON.stringify(result.risk_scores || {}),
      JSON.stringify(result.alerts || []),
      JSON.stringify([]),
      result.disclaimer,
      MODELS.VISION,
      usage?.input_tokens || 0,
      usage?.output_tokens || 0,
      JSON.stringify({
        original_image_url: imageMetadata.original_image_url,
        findings:           result.findings || [],
        measurements:       result.measurements || null,
      })
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

const IMAGING_AGENT_MAP = {
  rx:         { type: 'imaging_rx',         runner: runImagingRxAgent },
  ecg:        { type: 'imaging_ecg',        runner: runImagingEcgAgent },
  ultrasound: { type: 'imaging_ultrasound', runner: runImagingUltrasoundAgent },
  mri:        { type: 'imaging_mri',        runner: runImagingMriAgent },
};

async function processImagingExam({ exam_id, tenant_id, file_path, file_type }) {
  const client = await pool.connect();
  let processingError = null;

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant_id]);
    await client.query(
      `UPDATE exams SET status = 'processing', updated_at = NOW() WHERE id = $1`, [exam_id]
    );

    const { rows } = await client.query(
      `SELECT s.name, s.sex, s.subject_type, s.species, t.module
       FROM exams e
       JOIN subjects s ON s.id = e.subject_id
       JOIN tenants  t ON t.id = e.tenant_id
       WHERE e.id = $1`,
      [exam_id]
    );
    const subject = rows[0];
    const tenantModule = subject.module;

    const balance = await getBalance(tenant_id, client);
    if (balance < 1) {
      await client.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        ['Saldo de créditos insuficiente — recarregue seus créditos e envie novamente', exam_id]
      );
      await client.query('COMMIT');
      return;
    }

    const buffer = await downloadFile(keyFromPath(file_path));

    let imageBase64   = null;
    let pdfBuffer     = null;
    let imageMeta     = {};
    let imageS3Key    = null;

    let imageMimeType = 'image/png';

    // Imagens displayable (DICOM convertido + JPG/PNG enviados) vão pra
    // prefix `exam-images/` — fora do alcance do lifecycle de 7 dias do S3
    // que purga `uploads/`. Sem isso, depois de 7 dias o objeto some e o
    // GET /exams/:id/image volta 500 NoSuchKey, frontend mostra "imagem
    // não disponível" mesmo com original_image_url no banco.
    // Incidente 2026-05-04: laudo MRI de 2026-04-21 já tinha sido apagado.
    if (file_type === 'dicom') {
      const { pngBuffer, meta } = await dicomToImage(buffer);
      imageMeta     = meta;
      imageBase64   = pngBuffer.toString('base64');
      imageMimeType = 'image/png';
      imageS3Key    = `exam-images/${tenant_id}/${exam_id}/image.png`;
      await uploadFile(imageS3Key, pngBuffer, 'image/png');
    } else if (file_type === 'image') {
      imageMimeType = detectImageMime(buffer);
      imageBase64   = buffer.toString('base64');
      // Original veio em uploads/ que é purged em 7 dias — copia pra
      // exam-images/ pra preservar.
      const ext  = (imageMimeType.split('/')[1] || 'png').replace('jpeg', 'jpg');
      imageS3Key = `exam-images/${tenant_id}/${exam_id}/image.${ext}`;
      await uploadFile(imageS3Key, buffer, imageMimeType);
    } else if (file_type === 'pdf') {
      pdfBuffer = buffer;
    }

    const original_image_url = imageS3Key ? `s3://${BUCKET}/${imageS3Key}` : null;

    const modality = await classifyModality(imageBase64, imageMeta, file_type === 'image' ? buffer : null);
    if (!modality) {
      await client.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        ['Não foi possível identificar a modalidade da imagem. Modalidades suportadas: RX, ECG, Ultrassom e Ressonância Magnética. Verifique se a imagem está legível e tente novamente.', exam_id]
      );
      await client.query('COMMIT');
      return;
    }

    const agentConfig = IMAGING_AGENT_MAP[modality];
    if (!agentConfig) {
      await client.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [`Modalidade "${modality}" não suportada`, exam_id]
      );
      await client.query('COMMIT');
      return;
    }

    let guidelines = [];
    try {
      const searchText = imageMeta.studyDesc || imageMeta.modality || modality;
      guidelines = await retrieveGuidelines(client, searchText, 3, tenantModule, subject.species || null);
    } catch (_) {}

    const patientContext = { sex: subject.sex, species: subject.species || null };
    const { result, usage } = await agentConfig.runner({ imageBase64, imageMimeType, imageMeta, pdfBuffer, patient: patientContext, guidelines });

    await persistImagingResult(client, exam_id, tenant_id, agentConfig.type, result, usage, { original_image_url });
    await debitCredit(tenant_id, exam_id, agentConfig.type, client);

    await client.query(
      `UPDATE exams SET status = 'done', updated_at = NOW() WHERE id = $1`, [exam_id]
    );
    await client.query('COMMIT');

  } catch (err) {
    processingError = err;
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
  }

  if (processingError) {
    const errClient = await pool.connect();
    try {
      await errClient.query('BEGIN');
      await errClient.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant_id]);
      await errClient.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [processingError.message, exam_id]
      );
      await errClient.query('COMMIT');
    } catch (_) {
      await errClient.query('ROLLBACK').catch(() => {});
    } finally {
      errClient.release();
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
  } catch (_) {}

  // Push notification pra médico do exame
  try {
    const { sendToUser } = require('../../../api/src/services/push');
    const { rows: examRows } = await pool.query(
      'SELECT user_id, subject_id FROM exams WHERE id = $1 AND tenant_id = $2',
      [exam_id, tenant_id]
    );
    if (examRows[0]) {
      const { rows: subjectRows } = await pool.query(
        'SELECT name FROM subjects WHERE id = $1 AND tenant_id = $2',
        [examRows[0].subject_id, tenant_id]
      );
      const patientName = subjectRows[0]?.name ?? 'Paciente';
      await sendToUser(pool, examRows[0].user_id, {
        title: 'Exame disponível',
        body: `Exame de ${patientName} pronto para análise`,
        data: { route: `/doctor/patients/${examRows[0].subject_id}` }
      });
    }
  } catch (e) {
    console.error('[push] exam:done push error:', e.message);
  }
}

/**
 * Full exam processing pipeline:
 * parse → anonymize → RAG → phase1 agents → phase2 agents → persist → notify
 *
 * @param {{ exam_id: string, tenant_id: string, file_path: string, file_type: string }} jobData
 */
async function processExam({ exam_id, tenant_id, file_path, file_type = 'pdf', selected_agents, chief_complaint, current_symptoms }) {
  if (file_type === 'dicom') {
    return processImagingExam({ exam_id, tenant_id, file_path, file_type });
  }

  // Foto/scan de laudo impresso vs imagem médica:
  // pré-classifica antes de rotear pra evitar mandar foto de hemograma pro
  // pipeline imaging (que tentaria classificar modalidade RX/ECG/US/MRI e falharia).
  if (file_type === 'image') {
    try {
      const imgBuffer = await downloadFile(keyFromPath(file_path));
      const { detectImageMime } = require('../classifiers/imaging');
      const mediaType = detectImageMime(imgBuffer);
      const imageBase64 = imgBuffer.toString('base64');
      const contentType = await classifyImageContent(imageBase64, mediaType);

      if (contentType === 'document') {
        // Foto de laudo impresso → OCR Vision + pipeline texto
        const ocrText = await ocrLabReport(imageBase64, mediaType);
        if (!ocrText || ocrText.length < 50) {
          // OCR falhou ou texto vazio — tenta imaging como fallback
          console.warn(`[processor] OCR returned empty/short text (${ocrText?.length || 0} chars), falling back to imaging`);
          return processImagingExam({ exam_id, tenant_id, file_path, file_type });
        }
        // Persiste a imagem em exam-images/ pra preservar (como o imaging path faz)
        const ext = (mediaType.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const imageS3Key = `exam-images/${tenant_id}/${exam_id}/image.${ext}`;
        try { await uploadFile(imageS3Key, imgBuffer, mediaType); } catch (_) {}
        return processTextExam({
          exam_id, tenant_id, file_path,
          selected_agents, chief_complaint, current_symptoms,
          prefetchedText: ocrText,
          ocrSource: 'image_vision',
        });
      }
      // medical_image ou unknown → fallback pra imaging (mantém comportamento atual)
      return processImagingExam({ exam_id, tenant_id, file_path, file_type });
    } catch (err) {
      // Se classificação falhar, segue pelo path imaging (comportamento legado)
      console.warn('[processor] image content classification failed, falling back to imaging path:', err.message);
      return processImagingExam({ exam_id, tenant_id, file_path, file_type });
    }
  }

  // PDF (file_type 'pdf' ou default)
  return processTextExam({
    exam_id, tenant_id, file_path,
    selected_agents, chief_complaint, current_symptoms,
  });
}

/**
 * Pipeline de texto compartilhado (PDF extraído OU OCR Vision).
 * Quando `prefetchedText` é provido, pula download + extractText (caso OCR Vision).
 */
async function processTextExam({ exam_id, tenant_id, file_path, selected_agents, chief_complaint, current_symptoms, prefetchedText = null, ocrSource = null }) {
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
              s.weight, s.height, s.allergies, s.comorbidities,
              s.medications, s.smoking, s.alcohol, s.diet_type,
              s.physical_activity, s.family_history,
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

    let rawText, usedOcr = false;
    if (prefetchedText) {
      // OCR Vision (foto de laudo impresso) — texto já extraído antes da chamada
      rawText = prefetchedText;
      usedOcr = true;
    } else {
      if (!file_path) throw new Error('exam has no file_path — PDF download may have failed during ingest');
      let buffer;
      try {
        buffer = await downloadFile(keyFromPath(file_path));
      } catch (s3Err) {
        if (s3Err.name === 'NoSuchKey' || s3Err.$metadata?.httpStatusCode === 404) {
          throw new Error('Arquivo do exame não encontrado. Reenvie o PDF para reprocessar.');
        }
        throw s3Err;
      }
      const extracted = await extractText(buffer);
      rawText = extracted.text;
      usedOcr = extracted.usedOcr;
    }
    if (usedOcr) {
      const desc = ocrSource === 'image_vision'
        ? 'OCR: foto de laudo impresso (Vision)'
        : 'OCR: scanned PDF text extraction';
      await client.query(
        `INSERT INTO credit_ledger (tenant_id, amount, kind, exam_id, description)
         VALUES ($1, -1, 'ocr_usage', $2, $3)`,
        [tenant_id, exam_id, desc]
      );
    }
    const examText = scrubText(rawText);
    const anonSubject = anonymize(subject);
    const patientContext = {
      ...anonSubject,
      weight:            subject.weight            || null,
      height:            subject.height            || null,
      allergies:         subject.allergies          || null,
      comorbidities:     subject.comorbidities      || null,
      medications:       subject.medications        || null,
      smoking:           subject.smoking            || null,
      alcohol:           subject.alcohol            || null,
      diet_type:         subject.diet_type          || null,
      physical_activity: subject.physical_activity  || null,
      family_history:    subject.family_history     || null
    };

    // Determine Phase 1 agents
    let phase1;
    if (tenantModule === 'human') {
      if (selected_agents?.length) {
        const filtered = PHASE1_AGENTS.human.filter(a => Array.isArray(selected_agents) && selected_agents.includes(a.type));
        if (filtered.length) {
          phase1 = filtered;
        } else {
          console.warn('[processor] selected_agents contained no valid agent types; falling back to all agents', selected_agents);
          phase1 = PHASE1_AGENTS.human;
        }
      } else {
        phase1 = PHASE1_AGENTS.human;
      }
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

    // Filter phase2 agents by module
    const activePhase2 = PHASE2_AGENTS.filter(a => !a.humanOnly || tenantModule === 'human');

    // Balance check before running agents
    const allAgents = [...phase1, ...activePhase2];
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
      const { result, usage } = await runner({ examText, patient: patientContext, guidelines });
      specialtyResults.push({ agent_type: type, ...result });
      await persistResult(client, exam_id, tenant_id, type, result, usage);
      await debitCredit(tenant_id, exam_id, type, client);
      await checkLowCreditAlert(tenant_id, client, billingRedis);
    }

    // Phase 2 — synthesis agents (parallel)
    const phase2Ctx = {
      examText,
      patient: patientContext,
      specialtyResults,
      module: tenantModule,
      species: subject.species || null,
      chief_complaint: chief_complaint || '',
      current_symptoms: current_symptoms || ''
    };
    const phase2Responses = await Promise.all(
      activePhase2.map(({ runner }) => runner(phase2Ctx))
    );
    for (let i = 0; i < activePhase2.length; i++) {
      const agent = activePhase2[i];
      const { result, usage } = phase2Responses[i];
      const persistableResult = agent.flattenResult ? agent.flattenResult(result) : result;
      await persistResult(client, exam_id, tenant_id, agent.type, persistableResult, usage);
      await debitCredit(tenant_id, exam_id, agent.type, client);
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

  // Push notification pra médico do exame
  try {
    const { sendToUser } = require('../../../api/src/services/push');
    const { rows: examRows } = await pool.query(
      'SELECT user_id, subject_id FROM exams WHERE id = $1 AND tenant_id = $2',
      [exam_id, tenant_id]
    );
    if (examRows[0]) {
      const { rows: subjectRows } = await pool.query(
        'SELECT name FROM subjects WHERE id = $1 AND tenant_id = $2',
        [examRows[0].subject_id, tenant_id]
      );
      const patientName = subjectRows[0]?.name ?? 'Paciente';
      await sendToUser(pool, examRows[0].user_id, {
        title: 'Exame disponível',
        body: `Exame de ${patientName} pronto para análise`,
        data: { route: `/doctor/patients/${examRows[0].subject_id}` }
      });
    }
  } catch (e) {
    console.error('[push] exam:done push error:', e.message);
  }

  // Index clinical chunks for the chatbot RAG (non-fatal)
  try {
    await indexExam(exam_id, tenant_id);
  } catch (indexErr) {
    console.error(`[processor] RAG indexing failed for exam ${exam_id}:`, indexErr.message);
  }
}

module.exports = { processExam };
