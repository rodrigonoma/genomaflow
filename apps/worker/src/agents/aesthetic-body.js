'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const MODELS = require('../config/models');
const { metricsForRegion } = require('../config/aesthetic-metrics');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });

const VALID_REGION_TYPES = new Set(['bbox', 'polyline', 'polygon', 'line', 'point']);
const MAX_REGIONS_PER_METRIC = 20;
const MAX_POINTS_PER_REGION = 50;
const MAX_LABEL_LENGTH = 100;

const BODY_REGIONS = new Set(['legs', 'glutes', 'abdomen', 'arms', 'breast', 'full_body']);

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(1, x));
}

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

// Saída espelha apps/web/.../models/analysis.model.ts (Region union).
// Tolerante na entrada, strict na saída. Ver comentário em aesthetic-facial.js
// e regressão 2026-05-12 (markers SVG nunca renderizavam).
function sanitizeRegion(r) {
  if (!r || !VALID_REGION_TYPES.has(r.type)) return null;
  const out = { type: r.type };
  if (typeof r.label === 'string') out.label = r.label.slice(0, MAX_LABEL_LENGTH);
  switch (r.type) {
    case 'bbox': {
      const x = clamp01(r.x);
      const y = clamp01(r.y);
      const width  = clamp01(r.width  != null ? r.width  : r.w);
      const height = clamp01(r.height != null ? r.height : r.h);
      if ([x, y, width, height].some(v => v === null)) return null;
      return { ...out, x, y, width, height };
    }
    case 'polyline':
    case 'polygon': {
      if (!Array.isArray(r.points)) return null;
      const points = r.points.slice(0, MAX_POINTS_PER_REGION)
        .map(p => {
          if (Array.isArray(p) && p.length === 2) {
            const x = clamp01(p[0]), y = clamp01(p[1]);
            return (x !== null && y !== null) ? { x, y } : null;
          }
          if (p && typeof p === 'object') {
            const x = clamp01(p.x), y = clamp01(p.y);
            return (x !== null && y !== null) ? { x, y } : null;
          }
          return null;
        })
        .filter(Boolean);
      if (points.length < 2) return null;
      return { ...out, points };
    }
    case 'line': {
      let x1, y1, x2, y2;
      if (Array.isArray(r.from) && Array.isArray(r.to)) {
        x1 = clamp01(r.from[0]); y1 = clamp01(r.from[1]);
        x2 = clamp01(r.to[0]);   y2 = clamp01(r.to[1]);
      } else {
        x1 = clamp01(r.x1); y1 = clamp01(r.y1);
        x2 = clamp01(r.x2); y2 = clamp01(r.y2);
      }
      if ([x1, y1, x2, y2].some(v => v === null)) return null;
      return { ...out, x1, y1, x2, y2 };
    }
    case 'point': {
      const x = clamp01(r.x), y = clamp01(r.y);
      if (x === null || y === null) return null;
      return { ...out, x, y };
    }
  }
  return null;
}

function sanitizeBodyMetrics(rawMetrics, analysisType) {
  const allowed = new Set(metricsForRegion(analysisType));
  const clean = {};
  for (const [key, value] of Object.entries(rawMetrics || {})) {
    if (!allowed.has(key)) continue;
    if (!value || typeof value !== 'object') continue;
    const regions = Array.isArray(value.regions)
      ? value.regions.slice(0, MAX_REGIONS_PER_METRIC).map(sanitizeRegion).filter(Boolean)
      : [];
    clean[key] = {
      score: clampScore(value.score),
      confidence: ['high', 'medium', 'low'].includes(value.confidence) ? value.confidence : 'medium',
      regions,
    };
  }
  return clean;
}

function buildPrompt(subject, analysisType) {
  const metrics = metricsForRegion(analysisType);
  const ageText = subject.age_years ? `${subject.age_years} anos` : 'idade não informada';
  const sexText = subject.sex === 'M' ? 'masculino' : (subject.sex === 'F' ? 'feminino' : 'sexo não informado');
  const regionDescriptions = {
    legs:     'Análise corporal de pernas/coxas: avalie culote (gordura lateral), celulite, estrias, flacidez interna da coxa.',
    glutes:   'Análise corporal de glúteos: firmeza, celulite, estrias, projeção.',
    abdomen:  'Análise abdominal: flacidez, estrias, manchas, volume aparente, diástase visível.',
    arms:     'Análise corporal de braços: flacidez tríceps, manchas, textura, celulite.',
    breast:   'Análise de tronco/mamas: ptose mamária, simetria, qualidade da pele.',
    full_body: 'Análise de silhueta completa: proporção corporal, postura, simetria global, volume aparente.',
  };
  const regionDesc = regionDescriptions[analysisType] || 'Análise corporal genérica.';

  return `Você é um assistente de análise estética CORPORAL. Analise a(s) foto(s) do paciente
(${ageText}, ${sexText}).

CONTEXTO: ${regionDesc}

Avalie as seguintes métricas (escala 0-100, onde 0 = problema severo, 100 = estado ideal):
${metrics.map(m => '- ' + m).join('\n')}

Para cada métrica, retorne:
- score (0-100)
- confidence: "high" | "medium" | "low" — use "low" pra estimativas de área que dependem de medição precisa 2D (culote, volume_aparente, projecao_glutea, etc.)
- regions: lista de áreas afetadas com coordenadas normalizadas 0-1.
  Use polygon pra áreas orgânicas (culote, abdomen flácido, celulite), bbox pra lesões discretas (estrias localizadas), point pra pontos de referência.
  Formatos exatos:
    bbox     {"type":"bbox","x":0..1,"y":0..1,"width":0..1,"height":0..1}
    polyline {"type":"polyline","points":[{"x":0..1,"y":0..1},...]}
    polygon  {"type":"polygon","points":[{"x":0..1,"y":0..1},...],"label":"..."}
    line     {"type":"line","x1":0..1,"y1":0..1,"x2":0..1,"y2":0..1}
    point    {"type":"point","x":0..1,"y":0..1}
- label opcional (até 100 chars).

IMPORTANTE — estimativas corporais 2D:
- Medições absolutas (área em cm²) NÃO são confiáveis via foto 2D — não inclua. Score 0-100 reflete severidade visual, não medida.
- Marque confidence="low" em métricas que dependem de proporção/profundidade.

Se NÃO identificar a região anatômica esperada na foto, retorne:
{"no_body_detected": true, "reason": "..."}

Se foto desfocada/com má iluminação:
{"image_too_blurry": true, "reason": "..."}

NÃO faça diagnóstico médico. NÃO sugira tratamentos (outro agente cuida).

Output: JSON estrito:
{
  "metrics": { "<metric_name>": { "score": ..., "confidence": "...", "regions": [...] }, ... },
  "observations": { "qualitative": "<2-3 linhas em PT-BR>" }
}`;
}

async function analyzeBody({ photoBuffers, subject, analysisType }) {
  if (!photoBuffers?.length) {
    throw Object.assign(new Error('No photos provided'), { code: 'NO_PHOTOS' });
  }
  if (!BODY_REGIONS.has(analysisType)) {
    throw Object.assign(new Error(`Region ${analysisType} not body type`), { code: 'INVALID_BODY_REGION' });
  }

  const imageContents = photoBuffers.map((buf) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') },
  }));

  let response;
  try {
    response = await client.messages.create({
      model: MODELS.VISION,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(subject, analysisType) },
          ...imageContents,
        ],
      }],
    });
  } catch (err) {
    throw Object.assign(new Error(`Anthropic call failed: ${err.message}`), { code: 'ANTHROPIC_FAIL', cause: err });
  }

  const rawText = response.content?.[0]?.text || '';
  let parsed;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : rawText);
  } catch {
    throw Object.assign(new Error('BAD_LLM_OUTPUT'), { code: 'BAD_LLM_OUTPUT', raw: rawText.slice(0, 500) });
  }

  if (parsed.no_body_detected) {
    throw Object.assign(new Error(parsed.reason || 'No body region detected'), { code: 'NO_BODY_DETECTED' });
  }
  if (parsed.image_too_blurry) {
    throw Object.assign(new Error(parsed.reason || 'Image too blurry'), { code: 'IMAGE_TOO_BLURRY' });
  }
  if (!parsed.metrics || typeof parsed.metrics !== 'object') {
    throw Object.assign(new Error('metrics ausente'), { code: 'BAD_LLM_OUTPUT' });
  }

  const cleanMetrics = sanitizeBodyMetrics(parsed.metrics, analysisType);
  const observations = parsed.observations && typeof parsed.observations === 'object'
    ? { qualitative: String(parsed.observations.qualitative || '').slice(0, 1500) }
    : {};

  return {
    metrics: cleanMetrics,
    observations,
    model: MODELS.VISION,
    tokens_input: response.usage?.input_tokens || 0,
    tokens_output: response.usage?.output_tokens || 0,
  };
}

module.exports = { analyzeBody, sanitizeBodyMetrics };
