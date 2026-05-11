'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const MODELS = require('../config/models');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });

const VALID_URGENCIES = new Set(['low', 'medium', 'high']);
const MAX_TREATMENTS = 10;
const MAX_FOODS = 15;
const NUTRITION_DISCLAIMER = 'Orientações gerais de estilo de vida. Não substituem consulta com nutricionista (CRN).';

function clampInt(n, min, max) {
  const x = parseInt(n, 10);
  if (!Number.isFinite(x)) return null;
  return Math.max(min, Math.min(max, x));
}

function slice(s, max) {
  return typeof s === 'string' ? s.slice(0, max) : null;
}

function sanitizeTreatment(t, profType) {
  if (!t || typeof t !== 'object') return null;
  // Filtro por tipo profissional: esteticista não recebe procedimentos médicos
  if (t.requires_medico && profType !== 'medico' && profType !== 'dentista') return null;
  const treatment = {
    treatment_name: slice(t.treatment_name, 100),
    target_metric: slice(t.target_metric, 60),
    indication_text: slice(t.indication_text, 500),
    sessions_recommended: clampInt(t.sessions_recommended, 1, 20),
    interval_days: clampInt(t.interval_days, 7, 365),
    estimated_total_cost_brl_range: Array.isArray(t.estimated_total_cost_brl_range)
      ? t.estimated_total_cost_brl_range.slice(0, 2).map(n => Number(n) >= 0 ? Number(n) : null).filter(v => v !== null)
      : [],
    urgency: VALID_URGENCIES.has(t.urgency) ? t.urgency : 'medium',
    expected_outcome: slice(t.expected_outcome, 500),
    contraindications_flagged: Array.isArray(t.contraindications_flagged)
      ? t.contraindications_flagged.slice(0, 10).map(s => slice(s, 100))
      : [],
    requires_medico: !!t.requires_medico,
    in_catalog: false, // será resolvido pelo backend pós-IA (F3)
  };
  if (!treatment.treatment_name) return null;
  return treatment;
}

function sanitizeLifestyle(l) {
  if (!l || typeof l !== 'object') return null;
  return {
    estimated_daily_calories_kcal: clampInt(l.estimated_daily_calories_kcal, 800, 4500),
    macro_distribution_g: l.macro_distribution_g && typeof l.macro_distribution_g === 'object' ? {
      protein: clampInt(l.macro_distribution_g.protein, 30, 400),
      carbs:   clampInt(l.macro_distribution_g.carbs, 50, 700),
      fat:     clampInt(l.macro_distribution_g.fat, 30, 250),
    } : null,
    hydration_ml_per_day: clampInt(l.hydration_ml_per_day, 1000, 6000),
    meal_timing_suggestion: slice(l.meal_timing_suggestion, 300),
    exercise_recommendation: l.exercise_recommendation && typeof l.exercise_recommendation === 'object' ? {
      aerobic:  slice(l.exercise_recommendation.aerobic, 300),
      strength: slice(l.exercise_recommendation.strength, 300),
    } : null,
    foods_to_emphasize:            Array.isArray(l.foods_to_emphasize)            ? l.foods_to_emphasize.slice(0, MAX_FOODS).map(s => slice(s, 80))            : [],
    foods_to_minimize:             Array.isArray(l.foods_to_minimize)             ? l.foods_to_minimize.slice(0, MAX_FOODS).map(s => slice(s, 80))             : [],
    supplementation_consideration: Array.isArray(l.supplementation_consideration) ? l.supplementation_consideration.slice(0, 10).map(s => slice(s, 80)) : [],
    disclaimer: NUTRITION_DISCLAIMER, // sempre nosso — overwrite por compliance CRN
  };
}

function sanitizeRecommendations(raw, profType) {
  if (!raw || typeof raw !== 'object') return {};
  const treatments = Array.isArray(raw.treatment_protocol)
    ? raw.treatment_protocol.slice(0, MAX_TREATMENTS).map(t => sanitizeTreatment(t, profType)).filter(Boolean)
    : [];
  const lifestyle = sanitizeLifestyle(raw.lifestyle_recommendations);
  const summary = slice(raw.summary_for_patient, 1500);
  const follow = raw.follow_up_protocol && typeof raw.follow_up_protocol === 'object' ? {
    next_analysis_recommended_in_days: clampInt(raw.follow_up_protocol.next_analysis_recommended_in_days, 7, 365),
    checkpoint_metrics: Array.isArray(raw.follow_up_protocol.checkpoint_metrics)
      ? raw.follow_up_protocol.checkpoint_metrics.slice(0, 20).map(s => slice(s, 60))
      : [],
  } : null;
  return {
    treatment_protocol: treatments,
    lifestyle_recommendations: lifestyle,
    summary_for_patient: summary,
    follow_up_protocol: follow,
  };
}

function buildCatalogBlock(availableTreatments) {
  if (!Array.isArray(availableTreatments) || availableTreatments.length === 0) return '';
  const entries = availableTreatments.slice(0, 50);
  const lines = entries.map(t => {
    if (!t || !t.name) return null;
    const indications = Array.isArray(t.indications) ? t.indications.join(', ') : (t.indications || '');
    const contraindications = Array.isArray(t.contraindications) ? t.contraindications.join(', ') : (t.contraindications || '');
    const custo = (t.cost_estimate_brl_min != null && t.cost_estimate_brl_max != null)
      ? `R$ ${t.cost_estimate_brl_min}-${t.cost_estimate_brl_max}`
      : 'não informado';
    return `- "${t.name}" (categoria: ${t.category || '?'}; indicações: ${indications || '?'}; contraindicações: ${contraindications || '?'}; sessões: ${t.typical_sessions != null ? t.typical_sessions : '?'}; intervalo: ${t.interval_days != null ? t.interval_days : '?'} dias; evidência: ${t.evidence_level || '?'}; requires_medico: ${!!t.requires_medico}; custo: ${custo})`;
  }).filter(Boolean);
  if (lines.length === 0) return '';
  return `\nTRATAMENTOS DISPONÍVEIS NO CATÁLOGO (use APENAS esses; se nada bater, marque o tratamento sugerido como NOVO):\n${lines.join('\n')}\n`;
}

function buildPrompt({ metrics, subject, professionalType, availableTreatments }) {
  const profile = subject && subject.aesthetic_profile ? subject.aesthetic_profile : {};
  const profStr = professionalType || 'esteticista';
  const restricaoStr = profStr === 'esteticista'
    ? 'RESTRIÇÃO: NÃO sugira procedimentos com requires_medico=true (Botox, ácido hialurônico, lasers ablativos, cirurgia, prescrição farmacológica).\nSugira procedimentos não-invasivos (peeling enzimático, microdermoabrasão, RF estética, drenagem linfática).'
    : 'Pode sugerir procedimentos médicos quando aplicável.';

  const ageText = (subject && subject.age_years) ? subject.age_years : '?';
  const sexText = (subject && subject.sex === 'F') ? 'feminino' : ((subject && subject.sex === 'M') ? 'masculino' : '?');
  const fitzText = (subject && subject.fitzpatrick_type) ? subject.fitzpatrick_type : '?';
  const alturaText = profile.altura_cm || '?';
  const pesoText = profile.peso_kg || '?';
  const goalsText = Array.isArray(profile.aesthetic_goals) && profile.aesthetic_goals.length
    ? profile.aesthetic_goals.join(', ') : 'não declarado';
  const comorbidText = (subject && subject.comorbidities) ? subject.comorbidities : 'nenhuma';
  const medText = (subject && subject.medications) ? subject.medications : 'nenhuma';

  const metricsLines = Object.entries(metrics || {})
    .map(([k, v]) => `- ${k}: ${v.score}/100 (${v.confidence || 'medium'})`)
    .join('\n');

  const catalogBlock = buildCatalogBlock(availableTreatments);

  return `Você é um assistente de protocolo estético. Com base nas métricas analisadas e\nno perfil do paciente, recomende protocolo de tratamento.\n\nPROFISSIONAL: ${profStr}\n${restricaoStr}\n\nPACIENTE:\n- ${ageText} anos, ${sexText}\n- fototipo: ${fitzText}\n- altura: ${alturaText} cm, peso: ${pesoText} kg\n- objetivo: ${goalsText}\n- comorbidades: ${comorbidText}\n- medicações: ${medText}\n\nMÉTRICAS DA ANÁLISE:\n${metricsLines}\n${catalogBlock}\nCADA tratamento sugerido DEVE conter:\n- treatment_name (nome canônico do procedimento, ex: "Microagulhamento", "Botox")\n- target_metric (qual métrica visa melhorar)\n- indication_text (2-3 linhas justificando)\n- sessions_recommended (1-20)\n- interval_days (7-365)\n- estimated_total_cost_brl_range [min, max]\n- urgency: "low" | "medium" | "high"\n- expected_outcome (1-2 linhas)\n- contraindications_flagged (lista de flags se houver)\n- requires_medico (true|false)\n\nPara NUTRIÇÃO/ESTILO DE VIDA (orientação geral, NÃO plano terapêutico):\n- estimated_daily_calories_kcal\n- macro_distribution_g: { protein, carbs, fat }\n- hydration_ml_per_day\n- meal_timing_suggestion (1 linha)\n- exercise_recommendation: { aerobic, strength }\n- foods_to_emphasize / foods_to_minimize (listas)\n- supplementation_consideration (lista)\n\nNÃO inclua disclaimer no JSON — eu adiciono automaticamente.\n\nOutput JSON estrito:\n{\n  "treatment_protocol": [...],\n  "lifestyle_recommendations": {...},\n  "summary_for_patient": "<plano resumido em 3-5 linhas>",\n  "follow_up_protocol": { "next_analysis_recommended_in_days": ..., "checkpoint_metrics": [...] }\n}`;
}

function applyCatalogMatching(recommendations, availableTreatments) {
  if (!Array.isArray(availableTreatments) || availableTreatments.length === 0) return;
  // Build lookup map: lowercased name → catalog row (defensive: skip rows missing id or name)
  const byLower = new Map();
  for (const t of availableTreatments.slice(0, 50)) {
    if (t && t.name && t.id) {
      byLower.set(t.name.toLowerCase().trim(), t);
    }
  }
  for (const tx of (recommendations.treatment_protocol || [])) {
    if (!tx) continue;
    const key = (tx.treatment_name || '').toLowerCase().trim();
    const match = byLower.get(key);
    if (match) {
      tx.treatment_id = match.id;
      tx.in_catalog = true;
      // Catalog is source of truth for requires_medico — overrides LLM
      tx.requires_medico = !!match.requires_medico;
    } else {
      tx.in_catalog = false;
    }
  }
}

async function recommendProtocol({ metrics, subject, professionalType, availableTreatments }) {
  let response;
  try {
    response = await client.messages.create({
      model: MODELS.CLINICAL_PREMIUM,
      max_tokens: 2500,
      messages: [{ role: 'user', content: buildPrompt({ metrics, subject, professionalType, availableTreatments }) }],
    });
  } catch (err) {
    throw Object.assign(new Error(`Anthropic call failed: ${err.message}`), { code: 'ANTHROPIC_FAIL', cause: err });
  }

  const rawText = (response.content && response.content[0]) ? response.content[0].text : '';
  let parsed;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : rawText);
  } catch (_e) {
    throw Object.assign(new Error('BAD_LLM_OUTPUT'), { code: 'BAD_LLM_OUTPUT', raw: rawText.slice(0, 500) });
  }

  const recommendations = sanitizeRecommendations(parsed, professionalType);

  // Post-process: match treatment names → catalog IDs (F3 — exact match, case-insensitive + trim)
  applyCatalogMatching(recommendations, availableTreatments);

  return {
    recommendations,
    model: MODELS.CLINICAL_PREMIUM,
    tokens_input:  (response.usage && response.usage.input_tokens)  || 0,
    tokens_output: (response.usage && response.usage.output_tokens) || 0,
  };
}

module.exports = { recommendProtocol, sanitizeRecommendations };
