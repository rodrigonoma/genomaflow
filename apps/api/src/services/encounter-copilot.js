'use strict';

/**
 * Co-piloto IA durante a consulta (4.4).
 *
 * Recebe o RASCUNHO do prontuário em digitação (chief_complaint, anamnesis,
 * physical_exam, hypothesis) + módulo + species + idade aproximada, e retorna
 * sugestões estruturadas pra apoiar o raciocínio clínico:
 *
 *   - Hipóteses diagnósticas (top 3 com nome, CID quando aplicável, prob_score, justificativa)
 *   - Exames recomendados (lab/imagem, prioridade, indicação)
 *   - Red flags (sinais de alarme, urgência)
 *
 * Princípios:
 *   - Sugestões, NÃO diagnóstico. Médico decide.
 *   - Concisas (2-3 linhas por item)
 *   - Apenas se houver dados mínimos (rejeita early se vazio)
 *   - Disclaimer obrigatório
 */

const Anthropic = require('@anthropic-ai/sdk').default;
const MODELS = require('../config/models');

const MODEL = MODELS.CLINICAL_PREMIUM;
const MIN_INPUT_CHARS = 30; // mínimo de texto pra gerar sugestões

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é um assistente clínico para apoio à decisão durante consulta. O médico está construindo um prontuário e quer feedback iterativo.

REGRAS:
- Sugestões, NÃO diagnóstico. Use "considere", "investigue", "exclua" — nunca "é".
- Seja CONCISO: 1-2 linhas por item.
- Cite CID-10 quando confiar na hipótese; null caso contrário.
- prob_score: 0.0 a 1.0 (estimativa subjetiva). NÃO invente certeza.
- Se faltar informação crítica (ex: "muita dor abdominal" sem localização), liste em "needs_more_info".
- Red flags só se realmente urgente (não inflar).

Retorne APENAS JSON válido neste formato:
{
  "hypotheses": [
    {
      "name": "string curta (até 80 chars)",
      "icd10": "string ou null",
      "prob_score": 0.0-1.0,
      "rationale": "1-2 linhas"
    }
  ],
  "recommended_exams": [
    {
      "name": "string",
      "type": "lab" | "imaging" | "other",
      "priority": "high" | "medium" | "low",
      "indication": "1 linha — por que ajuda"
    }
  ],
  "red_flags": [
    {
      "signal": "sinal de alarme",
      "urgency": "imediata" | "hoje" | "esta_semana",
      "recommendation": "ação concreta"
    }
  ],
  "needs_more_info": ["pergunta 1 que ajudaria afinar diagnóstico", "..."]
}`;

/**
 * @param {{chief_complaint?: string, anamnesis?: string, physical_exam?: string,
 *          hypothesis?: string, vital_signs?: object, module: 'human'|'veterinary',
 *          species?: string|null, age_years?: number|null, sex?: string|null}} draft
 */
async function analyze(draft) {
  const txtParts = [
    draft.chief_complaint?.trim(),
    draft.anamnesis?.trim(),
    draft.physical_exam?.trim(),
    draft.hypothesis?.trim(),
  ].filter(Boolean);
  const totalLen = txtParts.join(' ').length;
  if (totalLen < MIN_INPUT_CHARS) {
    const e = new Error('input_too_short');
    e.code = 'INPUT_TOO_SHORT';
    e.minChars = MIN_INPUT_CHARS;
    throw e;
  }

  const ctx = {
    module: draft.module,
    species: draft.species || null,
    age_years: draft.age_years ?? null,
    sex: draft.sex || null,
    chief_complaint: draft.chief_complaint || null,
    anamnesis: draft.anamnesis || null,
    physical_exam: draft.physical_exam || null,
    hypothesis_so_far: draft.hypothesis || null,
    vital_signs: draft.vital_signs || null,
  };

  const userPrompt = `Rascunho do prontuário em construção:

${JSON.stringify(ctx, null, 2)}

Analise os dados e retorne sugestões em JSON conforme o schema. Foque em hipóteses prováveis baseadas em apresentação clínica + idade + sexo + (espécie no caso vet).`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content?.[0]?.text || '';
  let parsed;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch (err) {
    const e = new Error('LLM returned non-JSON output');
    e.code = 'BAD_LLM_OUTPUT';
    e.raw = text;
    throw e;
  }

  // Saneamento
  const validUrgency = ['imediata', 'hoje', 'esta_semana'];
  const validPriority = ['high', 'medium', 'low'];
  const validExamType = ['lab', 'imaging', 'other'];

  const out = {
    hypotheses: Array.isArray(parsed.hypotheses)
      ? parsed.hypotheses
          .filter(h => h && typeof h.name === 'string')
          .map(h => ({
            name: h.name.slice(0, 120),
            icd10: typeof h.icd10 === 'string' ? h.icd10.slice(0, 20) : null,
            prob_score: Math.max(0, Math.min(1, Number(h.prob_score) || 0)),
            rationale: typeof h.rationale === 'string' ? h.rationale.slice(0, 300) : '',
          }))
          .slice(0, 5)
      : [],
    recommended_exams: Array.isArray(parsed.recommended_exams)
      ? parsed.recommended_exams
          .filter(x => x && typeof x.name === 'string')
          .map(x => ({
            name: x.name.slice(0, 120),
            type: validExamType.includes(x.type) ? x.type : 'other',
            priority: validPriority.includes(x.priority) ? x.priority : 'medium',
            indication: typeof x.indication === 'string' ? x.indication.slice(0, 200) : '',
          }))
          .slice(0, 8)
      : [],
    red_flags: Array.isArray(parsed.red_flags)
      ? parsed.red_flags
          .filter(r => r && typeof r.signal === 'string')
          .map(r => ({
            signal: r.signal.slice(0, 200),
            urgency: validUrgency.includes(r.urgency) ? r.urgency : 'esta_semana',
            recommendation: typeof r.recommendation === 'string' ? r.recommendation.slice(0, 200) : '',
          }))
          .slice(0, 5)
      : [],
    needs_more_info: Array.isArray(parsed.needs_more_info)
      ? parsed.needs_more_info.filter(s => typeof s === 'string').map(s => s.slice(0, 200)).slice(0, 5)
      : [],
    model_version: MODEL,
  };
  return out;
}

module.exports = { analyze, MODEL, MIN_INPUT_CHARS };
