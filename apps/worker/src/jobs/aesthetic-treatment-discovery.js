'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;

const VALID_CATEGORIES = new Set([
  'corpo_modelagem', 'corpo_flacidez',
  'facial_rejuvenescimento', 'facial_pigmentacao',
  'facial_acne', 'facial_preenchimento', 'facial_toxina',
  'cabelo', 'procedimento_cirurgico', 'wellness_drenagem', 'outro',
]);
const VALID_EVIDENCE = new Set(['A', 'B', 'C', 'D']);
const MAX_SUGGESTIONS = 30;
const MODEL = 'claude-opus-4-7';
const TIMEOUT_MS = 90_000;

function currentYearMonth(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function alreadyRanThisMonth(pool, now = new Date()) {
  const ym = currentYearMonth(now);
  const { rows } = await pool.query(
    `SELECT 1 FROM aesthetic_treatment_suggestions
     WHERE TO_CHAR(generated_at AT TIME ZONE 'UTC', 'YYYY-MM') = $1
     LIMIT 1`,
    [ym],
  );
  return rows.length > 0;
}

async function fetchExistingCatalogNames(pool) {
  const { rows } = await pool.query(
    `SELECT name FROM aesthetic_treatments WHERE is_active = true ORDER BY name`,
  );
  return rows.map((r) => r.name);
}

function buildPrompt(existingNames) {
  const listing = existingNames.slice(0, 100).map((n) => `- ${n}`).join('\n');
  return `Você é um especialista em medicina e procedimentos estéticos no Brasil em 2026.

TAREFA: liste 10 a 20 tratamentos estéticos surgidos ou popularizados no Brasil nos últimos 6 meses, EXCLUINDO os que já estão no catálogo abaixo.

CATÁLOGO ATUAL (NÃO sugerir esses):
${listing || '(vazio)'}

Para cada sugestão, retorne JSON com os campos:
- name (string, ≤120 chars)
- category (um de: ${[...VALID_CATEGORIES].join(', ')})
- indications (array de strings, ≤10 itens)
- contraindications (array de strings, ≤10 itens)
- typical_sessions (int, 1-20)
- interval_days (int, 1-365)
- cost_estimate_brl_min (number)
- cost_estimate_brl_max (number)
- evidence_level (A|B|C|D)
- description (string ≤500 chars)
- protocol_notes (string ≤500 chars)
- sources (array de strings ≤200 chars cada, ≤5 itens — papers/congressos/sociedades médicas)

Output ESTRITAMENTE JSON sem markdown ou texto adicional:
{ "suggestions": [...] }

Limite-se a 20 sugestões.`;
}

function parseLLMJson(text) {
  if (!text || typeof text !== 'string') throw new Error('BAD_LLM_OUTPUT: empty');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('BAD_LLM_OUTPUT: no JSON object');
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    throw new Error('BAD_LLM_OUTPUT: invalid JSON');
  }
  if (!parsed || !Array.isArray(parsed.suggestions)) throw new Error('BAD_LLM_OUTPUT: missing suggestions[]');
  return parsed;
}

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function clampNumber(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function sanitize(suggestion) {
  if (!suggestion || typeof suggestion !== 'object') return null;
  if (!suggestion.name || typeof suggestion.name !== 'string') return null;
  if (!VALID_CATEGORIES.has(suggestion.category)) return null;
  return {
    name: suggestion.name.trim().slice(0, 120),
    category: suggestion.category,
    indications: Array.isArray(suggestion.indications)
      ? suggestion.indications.filter((s) => typeof s === 'string').map((s) => s.slice(0, 80)).slice(0, 10)
      : [],
    contraindications: Array.isArray(suggestion.contraindications)
      ? suggestion.contraindications.filter((s) => typeof s === 'string').map((s) => s.slice(0, 80)).slice(0, 10)
      : [],
    typical_sessions: clampInt(suggestion.typical_sessions, 1, 20),
    interval_days: clampInt(suggestion.interval_days, 1, 365),
    cost_estimate_brl_min: clampNumber(suggestion.cost_estimate_brl_min, 0, 100000),
    cost_estimate_brl_max: clampNumber(suggestion.cost_estimate_brl_max, 0, 100000),
    evidence_level: VALID_EVIDENCE.has(suggestion.evidence_level) ? suggestion.evidence_level : null,
    description: typeof suggestion.description === 'string' ? suggestion.description.slice(0, 500) : null,
    protocol_notes: typeof suggestion.protocol_notes === 'string' ? suggestion.protocol_notes.slice(0, 500) : null,
    sources: Array.isArray(suggestion.sources)
      ? suggestion.sources.filter((s) => typeof s === 'string').map((s) => s.slice(0, 200)).slice(0, 5)
      : [],
  };
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente');
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return text;
}

async function insertSuggestions(pool, runId, suggestions) {
  let inserted = 0;
  for (const s of suggestions) {
    try {
      await pool.query(
        `INSERT INTO aesthetic_treatment_suggestions
           (name, category, indications, contraindications,
            typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
            evidence_level, description, protocol_notes, sources,
            status, source_run_id, generation_model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending_review', $13, $14)
         ON CONFLICT DO NOTHING`,
        [
          s.name, s.category, s.indications, s.contraindications,
          s.typical_sessions, s.interval_days, s.cost_estimate_brl_min, s.cost_estimate_brl_max,
          s.evidence_level, s.description, s.protocol_notes, s.sources,
          runId, MODEL,
        ],
      );
      inserted++;
    } catch (e) {
      console.warn('[discovery] INSERT failed for', s.name, e.message);
    }
  }
  return inserted;
}

async function runDiscovery({ pool, now = new Date(), forceRun = false } = {}) {
  if (!forceRun && await alreadyRanThisMonth(pool, now)) {
    console.log('[discovery] already ran this month, skipping');
    return { skipped: true, ym: currentYearMonth(now) };
  }
  const existingNames = await fetchExistingCatalogNames(pool);
  const prompt = buildPrompt(existingNames);
  const llmText = await callAnthropic(prompt);
  const parsed = parseLLMJson(llmText);
  const sanitized = parsed.suggestions
    .map(sanitize)
    .filter(Boolean)
    .slice(0, MAX_SUGGESTIONS);
  if (sanitized.length === 0) throw new Error('BAD_LLM_OUTPUT: no valid suggestions after sanitize');
  const runId = require('crypto').randomUUID();
  const inserted = await insertSuggestions(pool, runId, sanitized);
  console.log(`[discovery] runId=${runId} ym=${currentYearMonth(now)} inserted=${inserted}/${sanitized.length}`);
  return { skipped: false, ym: currentYearMonth(now), runId, inserted, total: sanitized.length };
}

// Tick guard: only run on day 1 of month (UTC)
function shouldTickRun(now = new Date()) {
  return now.getUTCDate() === 1;
}

module.exports = {
  runDiscovery,
  shouldTickRun,
  currentYearMonth,
  alreadyRanThisMonth,
  fetchExistingCatalogNames,
  buildPrompt,
  parseLLMJson,
  sanitize,
  insertSuggestions,
  VALID_CATEGORIES,
  VALID_EVIDENCE,
  MAX_SUGGESTIONS,
};
