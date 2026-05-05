'use strict';

/**
 * Sugestões pró-ativas da IA pra um paciente.
 *
 * Pipeline:
 *   1. Coleta contexto: subject + comorbidities + exames recentes + alertas +
 *      prescrições + encontros (últimos 90 dias)
 *   2. Anonimiza nomes/identificadores
 *   3. Monta prompt clínico estruturado
 *   4. Claude Opus 4.7 retorna JSON com lista de sugestões
 *   5. Persiste em ai_suggestions com TTL de 24h
 *
 * Princípios do prompt:
 *   - Sugestões PROATIVAS, não diagnósticas
 *   - Citar diretriz quando aplicável (RAG)
 *   - Disclaimer obrigatório
 *   - Evita generalidades ("considere check-up")
 */

const { randomUUID } = require('crypto');
const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-opus-4-7';
const CACHE_TTL_HOURS = 24;
const MAX_EXAMS = 10;
const MAX_PRESCRIPTIONS = 5;
const MAX_ENCOUNTERS = 5;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é um assistente clínico que ajuda médicos veterinários e humanos a identificar AÇÕES PROATIVAS baseadas no histórico de um paciente.

REGRAS:
- Suas sugestões são SUGESTÕES, não diagnósticos. O médico decide.
- Cite a diretriz/evidência quando relevante (formato: "Diretriz X, Cap Y").
- Seja ESPECÍFICO. Evite generalidades como "considere um check-up" ou "monitore o paciente".
- Cada sugestão deve ter um trigger claro nos dados (ex: "diabético há 6 meses sem HbA1c recente").
- Use linguagem técnica respeitosa. Não dê instruções autoritárias.
- Priorize: alta = ação dentro de 30 dias; média = considerar próxima consulta; baixa = oportunidade futura.
- Se NADA relevante a sugerir, retorne array vazio. Não invente.

Retorne APENAS JSON válido neste formato:
{
  "suggestions": [
    {
      "title": "string curta (até 80 chars)",
      "rationale": "por que sugerir, apontando dados específicos do paciente (até 200 chars)",
      "suggested_action": "ação concreta (até 120 chars)",
      "priority": "high" | "medium" | "low",
      "source_guideline": "string ou null"
    }
  ]
}`;

/**
 * Coleta contexto clínico do paciente pra montar o prompt.
 * @param {pg.Client} client (já dentro de withTenant)
 * @param {string} subject_id
 * @param {string} tenant_id
 * @returns contexto estruturado
 */
async function buildSubjectContext(client, subject_id, tenant_id) {
  // Subject base
  const { rows: sRows } = await client.query(
    `SELECT id, name, subject_type, sex, birth_date, species, breed, weight, height,
            allergies, comorbidities, medications, smoking, alcohol,
            diet_type, physical_activity, family_history, notes
     FROM subjects WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [subject_id, tenant_id]
  );
  if (sRows.length === 0) throw Object.assign(new Error('subject_not_found'), { code: 'NOT_FOUND' });
  const s = sRows[0];

  // Idade aproximada
  let age_years = null;
  if (s.birth_date) {
    const ms = Date.now() - new Date(s.birth_date).getTime();
    age_years = Math.floor(ms / (365.25 * 24 * 3600 * 1000));
  }

  // Últimos exames com top alerta
  const { rows: examRows } = await client.query(
    `SELECT e.id, e.created_at, e.file_type,
            COALESCE(jsonb_agg(DISTINCT cr.agent_type) FILTER (WHERE cr.agent_type IS NOT NULL), '[]'::jsonb) AS agent_types,
            COALESCE(jsonb_agg(cr.alerts) FILTER (WHERE cr.alerts IS NOT NULL), '[]'::jsonb) AS all_alerts
     FROM exams e
     LEFT JOIN clinical_results cr ON cr.exam_id = e.id
     WHERE e.tenant_id = $1 AND e.subject_id = $2 AND e.status = 'done'
       AND e.created_at >= NOW() - INTERVAL '180 days'
     GROUP BY e.id
     ORDER BY e.created_at DESC
     LIMIT $3`,
    [tenant_id, subject_id, MAX_EXAMS]
  );

  // Prescrições recentes
  const { rows: rxRows } = await client.query(
    `SELECT agent_type, items, notes, created_at
     FROM prescriptions
     WHERE tenant_id = $1 AND subject_id = $2
     ORDER BY created_at DESC LIMIT $3`,
    [tenant_id, subject_id, MAX_PRESCRIPTIONS]
  );

  // Encontros recentes
  const { rows: encRows } = await client.query(
    `SELECT chief_complaint, hypothesis, conduct, signed_at, created_at
     FROM clinical_encounters
     WHERE tenant_id = $1 AND subject_id = $2
       AND created_at >= NOW() - INTERVAL '180 days'
     ORDER BY created_at DESC LIMIT $3`,
    [tenant_id, subject_id, MAX_ENCOUNTERS]
  );

  return {
    subject: {
      type: s.subject_type,
      sex: s.sex,
      age_years,
      species: s.species || null,
      breed: s.breed || null,
      weight_kg: s.weight,
      height_cm: s.height,
      allergies: s.allergies,
      comorbidities: s.comorbidities,
      medications: s.medications,
      smoking: s.smoking,
      alcohol: s.alcohol,
      diet_type: s.diet_type,
      physical_activity: s.physical_activity,
      family_history: s.family_history,
      notes: s.notes,
    },
    recent_exams: examRows.map(r => ({
      date: r.created_at,
      file_type: r.file_type,
      agents: r.agent_types,
      alerts: flattenAlerts(r.all_alerts),
    })),
    recent_prescriptions: rxRows.map(r => ({
      type: r.agent_type,
      item_count: Array.isArray(r.items) ? r.items.length : 0,
      notes: r.notes,
      date: r.created_at,
    })),
    recent_encounters: encRows.map(r => ({
      chief_complaint: r.chief_complaint,
      hypothesis: r.hypothesis,
      conduct: r.conduct,
      signed: !!r.signed_at,
      date: r.created_at,
    })),
  };
}

function flattenAlerts(arr) {
  if (!Array.isArray(arr)) return [];
  const flat = [];
  for (const grp of arr) {
    if (Array.isArray(grp)) {
      for (const a of grp) {
        if (a && typeof a === 'object' && a.severity) {
          flat.push({
            severity: a.severity,
            marker: a.marker || null,
            description: a.description || a.title || null,
          });
        }
      }
    }
  }
  // Top 10 alertas mais severos
  const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
  return flat
    .sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0))
    .slice(0, 10);
}

/**
 * Chama Claude Opus pra gerar sugestões.
 * Retorna {suggestions, model_version, usage}
 */
async function generateSuggestions(subjectContext, module) {
  const userPrompt = `Histórico do paciente (módulo ${module}):

${JSON.stringify(subjectContext, null, 2)}

Analise o contexto acima e retorne sugestões pró-ativas em JSON conforme o schema. Foque em ações que adicionem valor clínico observando lacunas, follow-ups esperados e riscos identificáveis.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content?.[0]?.text || '';
  // Extrai JSON do output (tolera prefixos/sufixos)
  let parsed;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch (err) {
    throw Object.assign(new Error('LLM returned non-JSON output'), { code: 'BAD_LLM_OUTPUT', raw: text });
  }

  if (!Array.isArray(parsed.suggestions)) {
    throw Object.assign(new Error('LLM output missing suggestions array'), { code: 'BAD_LLM_OUTPUT', raw: parsed });
  }

  // Atribui IDs estáveis + filtra entries malformados
  const validPriorities = ['high', 'medium', 'low'];
  const cleaned = parsed.suggestions
    .filter(s => s && typeof s.title === 'string' && typeof s.rationale === 'string')
    .map(s => ({
      id: randomUUID(),
      title: s.title.slice(0, 120),
      rationale: s.rationale.slice(0, 300),
      suggested_action: typeof s.suggested_action === 'string' ? s.suggested_action.slice(0, 200) : null,
      priority: validPriorities.includes(s.priority) ? s.priority : 'medium',
      source_guideline: typeof s.source_guideline === 'string' ? s.source_guideline.slice(0, 200) : null,
    }));

  return {
    suggestions: cleaned,
    model_version: MODEL,
    usage: response.usage || null,
  };
}

/**
 * Refresh: regenera sugestões e persiste com TTL.
 * @param {pg.Client} client (já dentro de withTenant)
 */
async function refreshSuggestions(client, { tenant_id, subject_id, user_id, module }) {
  const ctx = await buildSubjectContext(client, subject_id, tenant_id);
  const { suggestions, model_version } = await generateSuggestions(ctx, module);

  const expires_at = new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000);
  const { rows } = await client.query(
    `INSERT INTO ai_suggestions (tenant_id, subject_id, suggestions, model_version, expires_at, generated_by, dismissed_ids)
     VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb)
     ON CONFLICT (tenant_id, subject_id) DO UPDATE SET
       suggestions = EXCLUDED.suggestions,
       model_version = EXCLUDED.model_version,
       generated_at = NOW(),
       expires_at = EXCLUDED.expires_at,
       generated_by = EXCLUDED.generated_by,
       dismissed_ids = '[]'::jsonb,
       updated_at = NOW()
     RETURNING *`,
    [tenant_id, subject_id, JSON.stringify(suggestions), model_version, expires_at.toISOString(), user_id || null]
  );
  return rows[0];
}

async function getCached(client, { tenant_id, subject_id }) {
  const { rows } = await client.query(
    `SELECT * FROM ai_suggestions WHERE tenant_id = $1 AND subject_id = $2`,
    [tenant_id, subject_id]
  );
  return rows[0] || null;
}

async function dismissSuggestion(client, { tenant_id, subject_id, suggestion_id }) {
  const { rows } = await client.query(
    `UPDATE ai_suggestions
       SET dismissed_ids = (
         CASE WHEN dismissed_ids @> to_jsonb(ARRAY[$3]::text[])
              THEN dismissed_ids
              ELSE dismissed_ids || to_jsonb(ARRAY[$3]::text[])
         END
       ),
       updated_at = NOW()
     WHERE tenant_id = $1 AND subject_id = $2
     RETURNING *`,
    [tenant_id, subject_id, suggestion_id]
  );
  return rows[0] || null;
}

module.exports = {
  buildSubjectContext,
  generateSuggestions,
  refreshSuggestions,
  getCached,
  dismissSuggestion,
  MODEL,
  CACHE_TTL_HOURS,
};
