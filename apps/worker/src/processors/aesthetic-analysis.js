'use strict';

const { Pool } = require('pg');
const Redis = require('ioredis');
const { downloadFile } = require('../storage/s3');
const { analyzeFacial } = require('../agents/aesthetic-facial');
const { analyzeBody } = require('../agents/aesthetic-body');
const { recommendProtocol } = require('../agents/aesthetic-recommender');
const { computeLandmarkMetrics } = require('../agents/aesthetic-landmarks-metrics');
const { computeAllAggregateScores } = require('../agents/aesthetic-aggregate-scores');

const FACIAL_REGIONS = new Set(['facial', 'eyelids', 'neck']);
const BODY_REGIONS_PROC = new Set(['legs', 'glutes', 'abdomen', 'arms', 'breast', 'full_body']);

function pickAgent(analysisType) {
  if (FACIAL_REGIONS.has(analysisType)) return 'facial';
  if (BODY_REGIONS_PROC.has(analysisType)) return 'body';
  throw Object.assign(new Error(`Unsupported analysis_type: ${analysisType}`), { code: 'UNSUPPORTED_REGION' });
}

const _pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

let _publisher;
function publisher() {
  if (!_publisher) {
    _publisher = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return _publisher;
}

const TERMINAL_REFUND_CODES = new Set(['NO_FACE_DETECTED', 'NO_BODY_DETECTED', 'IMAGE_TOO_BLURRY', 'BAD_LLM_OUTPUT', 'UNSUPPORTED_REGION']);

async function processAestheticAnalysis({ pool, data } = {}) {
  pool = pool || _pool;
  const {
    analysis_id, tenant_id, subject_id, user_id, analysis_type, photo_ids,
    professional_type,
    tier, // V2: 'standard' | 'advanced' (default 'standard')
  } = data;
  const client = await pool.connect();

  let stage = 'init';
  try {
    // Setar tenant context (RLS)
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant_id]);

    // Marcar processing
    stage = 'mark_processing';
    await client.query(
      `UPDATE aesthetic_analyses SET status = 'processing' WHERE id = $1 AND tenant_id = $2`,
      [analysis_id, tenant_id]
    );

    // Buscar fotos do S3 (e landmarks JSONB pra tier=advanced)
    stage = 'fetch_photos';
    const { rows: photos } = await client.query(
      `SELECT id, s3_key, pose, landmarks FROM aesthetic_photos
       WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
      [photo_ids, tenant_id]
    );
    if (photos.length !== photo_ids.length) {
      throw Object.assign(new Error('Photos missing'), { code: 'PHOTOS_MISSING' });
    }
    const photoBuffers = await Promise.all(photos.map((p) => downloadFile(p.s3_key)));

    // Buscar contexto subject
    stage = 'fetch_subject';
    const { rows: subjects } = await client.query(
      `SELECT s.*,
              EXTRACT(YEAR FROM AGE(s.birth_date))::int AS age_years
       FROM subjects s
       WHERE s.id = $1 AND s.tenant_id = $2`,
      [subject_id, tenant_id]
    );
    const subject = subjects[0];

    // Call #1: análise Vision (facial ou corporal — roteado por analysis_type)
    stage = 'call_1_vision';
    const agentKind = pickAgent(analysis_type);
    const visionResult = agentKind === 'body'
      ? await analyzeBody({ photoBuffers, subject, analysisType: analysis_type })
      : await analyzeFacial({ photoBuffers, subject, analysisType: analysis_type });

    // V2: Call #1b — métricas geométricas de landmarks (somente tier=advanced).
    // Falha aqui NÃO falha a análise — Vision metrics já é o produto basic.
    // Apenas omite as 10 métricas geométricas.
    stage = 'call_1b_landmarks_metrics';
    let landmarkMetrics = {};
    if (tier === 'advanced') {
      try {
        const result = await computeLandmarkMetrics({
          photos,
          analysisType: analysis_type,
        });
        landmarkMetrics = result.metrics || {};
        console.log(`[aesthetic][${analysis_id}] landmark metrics computed: ${Object.keys(landmarkMetrics).length} métricas`);
      } catch (lmErr) {
        console.warn(`[aesthetic][${analysis_id}] landmarks-metrics falhou (continuando sem geometria):`, lmErr.message);
      }
    }

    // Merge metrics Vision + landmarks (geometria). Source flag separa os dois.
    const mergedMetrics = { ...visionResult.metrics, ...landmarkMetrics };

    // V2 Fase 2: 6 scores agregados (textura/manchas/simetria/rugas/olheiras/acne).
    // Determinístico, sem custo de IA. Roda em qualquer tier — em standard agrega
    // só Vision; em advanced enriquece com geometria (mediapipe) quando aplicável.
    try {
      const aggregateScores = computeAllAggregateScores(mergedMetrics);
      Object.assign(mergedMetrics, aggregateScores);
    } catch (aggErr) {
      // Defensivo: agregação é determinística, mas falha não deve bloquear análise
      console.warn(`[aesthetic][${analysis_id}] aggregate-scores falhou:`, aggErr.message);
    }

    // Buscar catálogo de tratamentos (global + tenant, ativos, top 50 por uso recente)
    stage = 'fetch_catalog';
    let availableTreatments = [];
    try {
      const { rows: catalogRows } = await client.query(
        `SELECT id, name, category, indications, contraindications,
                typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
                evidence_level, requires_medico
         FROM aesthetic_treatments
         WHERE (tenant_id IS NULL OR tenant_id = $1) AND is_active = true
         ORDER BY tenant_id NULLS FIRST, usage_count_30d DESC
         LIMIT 50`,
        [tenant_id]
      );
      availableTreatments = catalogRows;
    } catch (catalogErr) {
      // Catálogo é best-effort: se a tabela não existir ainda (legacy/dev), continua sem ela
      console.warn(`[aesthetic][${analysis_id}] catalog fetch falhou (continuando sem catálogo):`, catalogErr.message);
    }

    // Fetch aesthetic_profile para enriquecer recommender com TMB/nutrição (F4)
    let aestheticProfile = null;
    let computedNutrition = null;
    try {
      const { rows: subjRows } = await client.query(
        `SELECT aesthetic_profile FROM subjects WHERE id = $1 AND tenant_id = $2`,
        [subject_id, tenant_id]
      );
      aestheticProfile = (subjRows[0] && subjRows[0].aesthetic_profile) || null;
      if (aestheticProfile && Object.keys(aestheticProfile).length > 0) {
        const { computeAll } = require('../lib/tmb');
        computedNutrition = computeAll(aestheticProfile);
      }
    } catch (profileErr) {
      // Perfil nutricional é best-effort — análise continua sem nutrição
      console.warn(`[aesthetic][${analysis_id}] aesthetic_profile fetch falhou (continuando sem nutrição):`, profileErr.message);
    }

    // Call #2: recomendação de protocolo (best-effort — falha aqui preserva métricas)
    stage = 'call_2_recommender';
    let recResult = { recommendations: null, tokens_input: 0, tokens_output: 0, model: null, error: null };
    try {
      recResult = await recommendProtocol({
        // Passa só métricas Vision para o recommender — geometria é informativa,
        // não dirige decisão de tratamento (recommender treinado pra Vision).
        metrics: visionResult.metrics,
        subject,
        professionalType: professional_type,
        availableTreatments,
        aestheticProfile,
        computedNutrition,
      });
    } catch (err) {
      console.warn(`[aesthetic][${analysis_id}] recommender falhou:`, err.message);
      recResult.error = err.code || 'RECOMMENDER_FAILED';
    }

    // Persistir resultado final
    stage = 'persist_done';
    await client.query(
      `UPDATE aesthetic_analyses SET status = $2,
         metrics = $3,
         observations = $4,
         recommendations = $5,
         model_metrics = $6,
         model_recommendations = $7,
         tokens_input = $8,
         tokens_output = $9,
         completed_at = NOW()
       WHERE id = $1`,
      [
        analysis_id,
        'done',
        JSON.stringify(mergedMetrics), // V2: Vision + landmarks (advanced) ou só Vision (standard)
        JSON.stringify(visionResult.observations || {}),
        JSON.stringify(recResult.recommendations || {}),
        visionResult.model || null,
        recResult.model || null,
        (visionResult.tokens_input || 0) + (recResult.tokens_input || 0),
        (visionResult.tokens_output || 0) + (recResult.tokens_output || 0),
      ]
    );

    // Notificar via Redis pub/sub
    stage = 'notify';
    publisher().publish(`aesthetic:event:${tenant_id}`, JSON.stringify({
      kind: 'analysis_done',
      analysis_id,
      subject_id,
    }));

    console.log(`[aesthetic][${analysis_id}] done`);
  } catch (err) {
    const errorCode = err.code || 'UNKNOWN';
    console.error(`[aesthetic][${analysis_id}] error at stage=${stage} code=${errorCode}:`, err.message);
    try {
      await client.query(
        `UPDATE aesthetic_analyses SET
           status = 'error', error_code = $2, error_message = $3, completed_at = NOW()
         WHERE id = $1`,
        [analysis_id, errorCode, String(err.message).slice(0, 500)]
      );

      // Refund idempotente se erro terminal (não retryável)
      if (TERMINAL_REFUND_CODES.has(errorCode)) {
        const { rows: aRows } = await client.query(
          `SELECT credits_charged, credits_refunded FROM aesthetic_analyses WHERE id = $1`,
          [analysis_id]
        );
        if (aRows[0] && !aRows[0].credits_refunded) {
          await client.query(
            `INSERT INTO credit_ledger (tenant_id, amount, kind, description, ref_id)
             SELECT $1, $2, 'aesthetic_refund', $3, $4
             WHERE NOT EXISTS (
               SELECT 1 FROM credit_ledger WHERE ref_id = $4 AND kind = 'aesthetic_refund'
             )`,
            [tenant_id, +(aRows[0].credits_charged || 5), `Refund: ${errorCode}`, analysis_id]
          );
          await client.query(
            `UPDATE aesthetic_analyses SET credits_refunded = true WHERE id = $1`,
            [analysis_id]
          );
        }
      }

      publisher().publish(`aesthetic:event:${tenant_id}`, JSON.stringify({
        kind: 'analysis_failed',
        analysis_id,
        subject_id,
        error_code: errorCode,
      }));
    } catch (e2) {
      console.error(`[aesthetic][${analysis_id}] error persist falhou:`, e2.message);
    }

    if (!TERMINAL_REFUND_CODES.has(errorCode)) {
      // BullMQ retry pra erros transientes (ex: timeout S3, LLM indisponível)
      throw err;
    }
  } finally {
    client.release();
  }
}

module.exports = { processAestheticAnalysis };
