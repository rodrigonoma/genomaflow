'use strict';

/**
 * Worker de transcrição de consulta por vídeo.
 * Pipeline: S3 áudio → Whisper → Claude Opus → encounter pre-fill → notifica médico
 *
 * Spec: docs/superpowers/specs/2026-05-08-video-consultation-design.md
 */

const { Pool } = require('pg');
const OpenAI = require('openai').default;
const { downloadFile } = require('../storage/s3');
const { sendToTenant } = require('../notifications/push');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const POLL_ATTEMPTS = 12;
const POLL_DELAY_MS = 30_000; // 30s entre tentativas

const TRANSCRIPTION_REFUND = 4; // créditos estornados em falha pós-vídeo

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Sanitização defensiva da saída do LLM ────────────────────────────────

const EXPECTED_KEYS = [
  'chief_complaint', 'anamnesis', 'physical_exam_notes',
  'hypotheses', 'exam_suggestions', 'prescription_hints',
  'red_flags', 'follow_up_notes', 'summary_3lines',
];

function sanitizeExtraction(raw) {
  let obj;
  try {
    // Tenta extrair JSON mesmo com prefixo/sufixo de texto
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON found');
    obj = JSON.parse(match[0]);
  } catch {
    throw Object.assign(new Error('BAD_LLM_OUTPUT'), { code: 'BAD_LLM_OUTPUT' });
  }

  return {
    chief_complaint:       typeof obj.chief_complaint === 'string' ? obj.chief_complaint.slice(0, 2000) : '',
    anamnesis:             typeof obj.anamnesis === 'string' ? obj.anamnesis.slice(0, 10000) : '',
    physical_exam_notes:   typeof obj.physical_exam_notes === 'string' ? obj.physical_exam_notes.slice(0, 5000) : '',
    hypotheses:            (Array.isArray(obj.hypotheses) ? obj.hypotheses : [])
                             .slice(0, 10)
                             .map(h => ({
                               description: String(h?.description || '').slice(0, 500),
                               confidence: ['high', 'medium', 'low'].includes(h?.confidence) ? h.confidence : 'low',
                             })),
    exam_suggestions:      (Array.isArray(obj.exam_suggestions) ? obj.exam_suggestions : [])
                             .slice(0, 20).map(s => String(s).slice(0, 300)),
    prescription_hints:    (Array.isArray(obj.prescription_hints) ? obj.prescription_hints : [])
                             .slice(0, 10).map(s => String(s).slice(0, 300)),
    red_flags:             (Array.isArray(obj.red_flags) ? obj.red_flags : [])
                             .slice(0, 10).map(s => String(s).slice(0, 300)),
    follow_up_notes:       typeof obj.follow_up_notes === 'string' ? obj.follow_up_notes.slice(0, 2000) : '',
    summary_3lines:        typeof obj.summary_3lines === 'string' ? obj.summary_3lines.slice(0, 600) : '',
  };
}

// ── withTenant inline (worker não importa do api) ────────────────────────

async function withTenantWorker(tenantId, userId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1,$2,true)', ['app.tenant_id', tenantId]);
    await client.query('SELECT set_config($1,$2,true)', ['app.user_id', userId || '']);
    await client.query('SELECT set_config($1,$2,true)', ['app.actor_channel', 'worker']);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Aguarda gravação no S3 ────────────────────────────────────────────────

async function waitForRecording(consultationId, tenantId) {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    const { rows } = await pool.query(
      `SELECT recording_s3_key FROM video_consultations
       WHERE id = $1 AND tenant_id = $2 AND recording_s3_key IS NOT NULL`,
      [consultationId, tenantId]
    );
    if (rows[0]?.recording_s3_key) return rows[0].recording_s3_key;
    if (i < POLL_ATTEMPTS - 1) await sleep(POLL_DELAY_MS);
  }
  return null;
}

// ── Contexto clínico do paciente para prompt ──────────────────────────────

async function getSubjectContext(tenantId, appointmentId) {
  const { rows } = await pool.query(
    `SELECT s.name, s.birth_date, s.gender, s.species,
            t.module,
            a.subject_id
     FROM appointments a
     JOIN subjects s ON s.id = a.subject_id
     JOIN tenants t ON t.id = $2
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [appointmentId, tenantId]
  );
  if (!rows[0]) return {};
  const r = rows[0];
  const ageYears = r.birth_date
    ? Math.floor((Date.now() - new Date(r.birth_date)) / (365.25 * 24 * 3600 * 1000))
    : null;
  return {
    module: r.module,
    species: r.species || 'humano',
    age_years: ageYears,
    gender: r.gender,
    subject_id: r.subject_id,
  };
}

// ── Transcrição Whisper ───────────────────────────────────────────────────

async function transcribeAudio(audioBuffer, filename) {
  const { toFile } = require('openai');
  const file = await toFile(audioBuffer, filename || 'audio.webm', { type: 'audio/webm' });
  const result = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    language: 'pt',
  });
  return result.text;
}

// ── Extração IA com Claude ────────────────────────────────────────────────

async function extractClinicalData(transcript, context) {
  const Anthropic = require('@anthropic-ai/sdk');
  const claude = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const moduleLabel = context.module === 'veterinary'
    ? `paciente animal (${context.species || 'espécie não informada'})`
    : context.module === 'estetica'
    ? 'cliente de clínica estética'
    : 'paciente humano';

  const systemPrompt = `Você é um assistente clínico especializado em documentação médica.
Analise a transcrição de uma consulta por vídeo e extraia as informações estruturadas.
O contexto é: ${moduleLabel}, ${context.age_years ? context.age_years + ' anos' : 'idade não informada'}, ${context.gender || 'gênero não informado'}.
Responda SOMENTE com JSON válido, sem markdown, sem texto antes ou depois.`;

  const userPrompt = `Transcrição da consulta:
---
${transcript.slice(0, 15000)}
---

Extraia e retorne um JSON com exatamente estas chaves:
{
  "chief_complaint": "queixa principal em 1-2 frases",
  "anamnesis": "história clínica detalhada",
  "physical_exam_notes": "achados do exame físico mencionados",
  "hypotheses": [{"description": "hipótese diagnóstica", "confidence": "high|medium|low"}],
  "exam_suggestions": ["exame sugerido 1", "exame sugerido 2"],
  "prescription_hints": ["medicamento/tratamento mencionado"],
  "red_flags": ["sinal/sintoma de alerta grave"],
  "follow_up_notes": "retorno e acompanhamento recomendados",
  "summary_3lines": "resumo da consulta em até 3 linhas"
}`;

  const response = await claude.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return sanitizeExtraction(response.content[0].text);
}

// ── Cria encounter pré-preenchido ─────────────────────────────────────────

async function createEncounter(tenantId, appointmentId, subjectId, professionalUserId, extraction) {
  return withTenantWorker(tenantId, professionalUserId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO clinical_encounters
         (tenant_id, subject_id, professional_user_id, appointment_id,
          encounter_type, chief_complaint, anamnesis, hypothesis, source)
       VALUES ($1,$2,$3,$4,'telemedicina',$5,$6,$7,'video_ai')
       RETURNING id`,
      [
        tenantId,
        subjectId,
        professionalUserId,
        appointmentId,
        extraction.chief_complaint,
        extraction.anamnesis,
        extraction.hypotheses.map(h => `${h.description} (${h.confidence})`).join('\n'),
      ]
    );
    return rows[0].id;
  });
}

// ── Notifica médico ───────────────────────────────────────────────────────

async function notifyDoctor(tenantId, consultationId, encounterId, redisUrl) {
  try {
    const Redis = require('ioredis');
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
    await redis.connect();
    await redis.publish(`video:event:${tenantId}`, JSON.stringify({
      type: 'video:transcription_done',
      consultation_id: consultationId,
      encounter_id: encounterId,
    }));
    await redis.disconnect();
  } catch { /* best-effort */ }

  // Push mobile best-effort
  try {
    const { rows } = await pool.query(
      `SELECT a.user_id FROM video_consultations vc
       JOIN appointments a ON a.id = vc.appointment_id
       WHERE vc.id = $1 AND vc.tenant_id = $2`,
      [consultationId, tenantId]
    );
    if (rows[0]) {
      await sendToTenant(pool, tenantId, {
        title: 'Transcrição concluída',
        body: 'O prontuário da consulta por vídeo está pronto para revisão.',
        data: { type: 'video_transcription_done', consultation_id: consultationId },
      });
    }
  } catch { /* best-effort */ }
}

// ── Estorno de créditos em falha ──────────────────────────────────────────

async function refundTranscriptionCredits(tenantId, consultationId) {
  try {
    await pool.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description)
       VALUES ($1, $2, 'video_transcription_refund', $3)`,
      [tenantId, TRANSCRIPTION_REFUND, `Estorno transcrição/IA — consulta ${consultationId}`]
    );
  } catch { /* best-effort */ }
}

// ── Pipeline principal ────────────────────────────────────────────────────

async function processVideoTranscription({ consultation_id, tenant_id, recording_s3_key }) {
  console.log(`[video-worker] Iniciando transcrição: consultation=${consultation_id}`);

  // 1. Busca dados da consulta
  const { rows } = await pool.query(
    `SELECT vc.id, vc.modality, vc.recording_s3_key, vc.status,
            a.appointment_id_col, a.id AS appointment_id, a.subject_id, a.user_id
     FROM video_consultations vc
     JOIN appointments a ON a.id = vc.appointment_id
     WHERE vc.id = $1 AND vc.tenant_id = $2`,
    [consultation_id, tenant_id]
  );
  if (!rows[0]) throw new Error(`Consulta ${consultation_id} não encontrada`);
  const vc = rows[0];

  if (vc.status === 'done') {
    console.log(`[video-worker] Consulta ${consultation_id} já processada — skip`);
    return;
  }

  // 2. Aguarda/busca recording_s3_key
  let s3Key = recording_s3_key || vc.recording_s3_key;
  if (!s3Key) {
    console.log(`[video-worker] Aguardando gravação S3...`);
    s3Key = await waitForRecording(consultation_id, tenant_id);
  }
  if (!s3Key) {
    console.warn(`[video-worker] Gravação não disponível após ${POLL_ATTEMPTS} tentativas`);
    await pool.query(
      `UPDATE video_consultations SET status='failed' WHERE id=$1 AND tenant_id=$2`,
      [consultation_id, tenant_id]
    );
    await refundTranscriptionCredits(tenant_id, consultation_id);
    return;
  }

  // 3. Download áudio
  console.log(`[video-worker] Baixando áudio: ${s3Key}`);
  const audioBuffer = await downloadFile(s3Key);

  // 4. Transcrição Whisper
  console.log(`[video-worker] Transcrevendo com Whisper...`);
  let transcript;
  try {
    transcript = await transcribeAudio(audioBuffer, 'consulta.webm');
  } catch (err) {
    console.error(`[video-worker] Falha Whisper:`, err.message);
    await pool.query(
      `UPDATE video_consultations SET status='failed', transcript_text='WHISPER_ERROR'
       WHERE id=$1 AND tenant_id=$2`,
      [consultation_id, tenant_id]
    );
    await refundTranscriptionCredits(tenant_id, consultation_id);
    return;
  }

  await pool.query(
    `UPDATE video_consultations SET transcript_text=$1 WHERE id=$2 AND tenant_id=$3`,
    [transcript, consultation_id, tenant_id]
  );

  // 5. Extração IA com Claude
  console.log(`[video-worker] Extraindo dados clínicos com Claude...`);
  const context = await getSubjectContext(tenant_id, vc.appointment_id);
  let extraction;
  try {
    extraction = await extractClinicalData(transcript, context);
  } catch (err) {
    console.error(`[video-worker] Falha Claude:`, err.message);
    await pool.query(
      `UPDATE video_consultations SET status='failed' WHERE id=$1 AND tenant_id=$2`,
      [consultation_id, tenant_id]
    );
    await refundTranscriptionCredits(tenant_id, consultation_id);
    return;
  }

  // 6. Cria encounter pré-preenchido
  console.log(`[video-worker] Criando encounter pré-preenchido...`);
  let encounterId = null;
  try {
    encounterId = await createEncounter(
      tenant_id,
      vc.appointment_id,
      vc.subject_id,
      vc.user_id,
      extraction
    );
  } catch (err) {
    console.error(`[video-worker] Falha ao criar encounter:`, err.message);
    // Não falha o job — transcrição e extração já estão salvas
  }

  // 7. Atualiza status para done
  await pool.query(
    `UPDATE video_consultations
       SET status='done', ai_extraction=$1, encounter_id=$2
     WHERE id=$3 AND tenant_id=$4`,
    [JSON.stringify(extraction), encounterId, consultation_id, tenant_id]
  );

  // 8. Notifica médico
  await notifyDoctor(tenant_id, consultation_id, encounterId, process.env.REDIS_URL);

  console.log(`[video-worker] Transcrição concluída: consultation=${consultation_id}`);
}

module.exports = { processVideoTranscription };
