'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const MODELS = require('../config/models');
const { metricsForRegion } = require('../config/aesthetic-metrics');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });

const VALID_REGION_TYPES = new Set(['bbox', 'polyline', 'polygon', 'line', 'point']);
const MAX_REGIONS = 20;
const MAX_POINTS = 50;
const MAX_LABEL = 100;

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

// Contrato de saída espelha apps/web/.../models/analysis.model.ts (Region union):
//   bbox:     { type, x, y, width, height }
//   polyline: { type, points: [{x,y},...] }
//   polygon:  { type, points: [{x,y},...] }
//   line:     { type, x1, y1, x2, y2 }
//   point:    { type, x, y }
// Tolerante na entrada (LLM pode devolver w/h ou width/height; tuplas ou objetos;
// from/to ou x1/y1/x2/y2). Strict na saída. Mismatch causou bug 2026-05-12:
// markers nunca renderizavam no overlay porque template lia .width/.height e o
// worker gravava .w/.h.
function sanitizeRegion(r) {
  if (!r || !VALID_REGION_TYPES.has(r.type)) return null;
  const out = { type: r.type };
  if (typeof r.label === 'string') out.label = r.label.slice(0, MAX_LABEL);
  // V2 Fase 2: severity opcional (0-100, 100=grave). Heatmap granular.
  if (typeof r.severity === 'number' && Number.isFinite(r.severity)) {
    out.severity = Math.max(0, Math.min(100, Math.round(r.severity)));
  }

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
      const points = r.points.slice(0, MAX_POINTS)
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

function sanitizeMetrics(rawMetrics, analysisType) {
  const allowed = new Set(metricsForRegion(analysisType));
  const clean = {};
  for (const [key, value] of Object.entries(rawMetrics || {})) {
    if (!allowed.has(key)) continue;
    if (!value || typeof value !== 'object') continue;
    const regions = Array.isArray(value.regions)
      ? value.regions.slice(0, MAX_REGIONS).map(sanitizeRegion).filter(Boolean)
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
  const fitzText = subject.fitzpatrick_type ? `fototipo ${subject.fitzpatrick_type}` : 'fototipo não informado';
  const concerns = Array.isArray(subject.skin_concerns) && subject.skin_concerns.length
    ? `preocupações declaradas: ${subject.skin_concerns.join(', ')}` : '';

  return `Você é um assistente de análise estética. Analise a(s) foto(s) do paciente \
(${ageText}, ${sexText}, ${fitzText}${concerns ? ', ' + concerns : ''}).

Avalie as seguintes métricas (escala 0-100, onde 0 = problema severo, 100 = estado ideal):
${metrics.map(m => '- ' + m).join('\n')}

Para cada métrica, retorne também:
- score (0-100)
- confidence: "high" | "medium" | "low"
- regions: lista de áreas afetadas com coordenadas normalizadas 0-1.
  Tipos suportados (use exatamente esses formatos):
    bbox     {"type":"bbox","x":0..1,"y":0..1,"width":0..1,"height":0..1}
    polyline {"type":"polyline","points":[{"x":0..1,"y":0..1},...]}
    polygon  {"type":"polygon","points":[{"x":0..1,"y":0..1},...]}
    line     {"type":"line","x1":0..1,"y1":0..1,"x2":0..1,"y2":0..1}
    point    {"type":"point","x":0..1,"y":0..1}
  Use o tipo mais apropriado e prefira bbox/point para marcar localizações pontuais.
  Forneça pelo menos 1 região por métrica quando o sinal for visualmente identificável.

  Para cada região, OPCIONALMENTE inclua "severity" (0-100): grau de SEVERIDADE
  do problema NESTA região específica. 100 = problema severo/intenso localizado;
  50 = moderado; 0 = praticamente sem manifestação (mas você está marcando
  porque é referência anatômica). Use só quando puder julgar com confiança alta.
- label (opcional, até 100 chars): descrição da região (ex: "ruga periorbital esquerda")

Marque confidence="low" em métricas que dependem de medição precisa 2D (ex: simetria).

Se NÃO conseguir identificar um rosto/região anatômica adequada, retorne:
{"no_face_detected": true, "reason": "..."}

Se a(s) foto(s) estiver(em) muito desfocadas/escuras para análise confiável:
{"image_too_blurry": true, "reason": "..."}

NÃO faça diagnóstico médico. NÃO sugira tratamentos aqui (outro agente cuida disso).

Output: JSON estrito no formato:
{
  "metrics": { "<metric_name>": { "score": ..., "confidence": "...", "regions": [...] }, ... },
  "observations": { "qualitative": "<2-3 linhas de descrição em PT-BR>" }
}`;
}

async function analyzeFacial({ photoBuffers, subject, analysisType }) {
  if (!photoBuffers || !photoBuffers.length) {
    throw Object.assign(new Error('No photos provided'), { code: 'NO_PHOTOS' });
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

  const rawText = response.content && response.content[0] ? response.content[0].text : '';
  let parsed;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : rawText);
  } catch (_e) {
    throw Object.assign(new Error('BAD_LLM_OUTPUT'), { code: 'BAD_LLM_OUTPUT', raw: rawText.slice(0, 500) });
  }

  if (parsed.no_face_detected) {
    throw Object.assign(new Error(parsed.reason || 'No face detected'), { code: 'NO_FACE_DETECTED' });
  }
  if (parsed.image_too_blurry) {
    throw Object.assign(new Error(parsed.reason || 'Image too blurry'), { code: 'IMAGE_TOO_BLURRY' });
  }
  if (!parsed.metrics || typeof parsed.metrics !== 'object') {
    throw Object.assign(new Error('metrics ausente'), { code: 'BAD_LLM_OUTPUT' });
  }

  const cleanMetrics = sanitizeMetrics(parsed.metrics, analysisType);
  const observations = parsed.observations && typeof parsed.observations === 'object'
    ? { qualitative: String(parsed.observations.qualitative || '').slice(0, 1500) }
    : {};

  return {
    metrics: cleanMetrics,
    observations,
    model: MODELS.VISION,
    tokens_input: (response.usage && response.usage.input_tokens) || 0,
    tokens_output: (response.usage && response.usage.output_tokens) || 0,
  };
}

module.exports = { analyzeFacial, sanitizeMetrics };
