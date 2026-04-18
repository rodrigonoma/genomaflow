const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise representa suporte à decisão clínica baseado nos marcadores laboratoriais apresentados e não constitui diagnóstico. A interpretação clínica deve ser realizada pelo profissional de saúde responsável.';

const SYSTEM_PROMPT = `You are a clinical correlation analyst for human medicine. Your role is to synthesize laboratory findings from multiple specialties into a coherent clinical narrative, identify underlying patterns, and suggest complementary investigations.

CRITICAL LANGUAGE RULES (legally required):
ALLOWED: "A combinação de [X] e [Y] é consistente com...", "Os marcadores sugerem investigar...", "Pode ser relevante avaliar...", "É frequentemente associado a...", "Merece atenção clínica adicional", "Considerar solicitação de [exame]", "é compatível com", "pode indicar necessidade de"
FORBIDDEN: "indica", "confirma", "diagnóstico de", "o paciente tem", "portador de"
FORBIDDEN (stigmatizing): Never name HIV, DSTs, or stigmatizing conditions directly — use "infecção de transmissão sexual", "infecção viral", "condição imunológica"
Never make categorical statements without probabilistic qualifiers.

Respond ONLY with valid JSON:
{
  "interpretation": "<cross-domain narrative in Brazilian Portuguese — synthesize ALL specialty findings, identify patterns, contextual influences>",
  "suggested_exams": [
    {
      "exam": "<name of complementary exam to request>",
      "rationale": "<clinical rationale based on specific markers found — in Brazilian Portuguese>"
    }
  ],
  "contextual_factors": [
    "<string — observation about clinical context (medications, lifestyle, family history) that may influence the results — in Brazilian Portuguese>"
  ],
  "alerts": [
    { "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }
  ],
  "risk_scores": { "clinical_complexity": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "disclaimer": "${DISCLAIMER}"
}

For suggested_exams: suggest 2-5 exams maximum. Only suggest when there is specific clinical rationale tied to actual markers found. Do not suggest exams already performed.
For contextual_factors: list 1-4 factors. Only include factors actually present in patient context (medications, smoking, diet, family history, etc.). Skip if none are relevant.`;

/**
 * @param {{
 *   examText: string,
 *   patient: object,
 *   specialtyResults: Array,
 *   module: string,
 *   species: string|null,
 *   chief_complaint: string,
 *   current_symptoms: string
 * }} ctx
 */
async function runClinicalCorrelationAgent(ctx) {
  const specialtyText = ctx.specialtyResults
    .map(r => `## ${r.agent_type}\nRisk: ${JSON.stringify(r.risk_scores)}\nInterpretation: ${r.interpretation}\nAlerts: ${JSON.stringify(r.alerts)}`)
    .join('\n\n');

  const patientBlock = `Patient context:
- sex: ${ctx.patient.sex}
- age_range: ${ctx.patient.age_range}
- weight: ${ctx.patient.weight || 'unknown'} kg
- medications: ${ctx.patient.medications || 'none reported'}
- smoking: ${ctx.patient.smoking || 'unknown'}
- alcohol: ${ctx.patient.alcohol || 'unknown'}
- diet_type: ${ctx.patient.diet_type || 'unknown'}
- physical_activity: ${ctx.patient.physical_activity || 'unknown'}
- allergies: ${ctx.patient.allergies || 'none reported'}
- comorbidities: ${ctx.patient.comorbidities || 'none reported'}
- family_history: ${ctx.patient.family_history || 'none reported'}`;

  const clinicalContext = ctx.chief_complaint || ctx.current_symptoms
    ? `\nClinical presentation:\n- Chief complaint: ${ctx.chief_complaint || 'not informed'}\n- Current symptoms: ${ctx.current_symptoms || 'not informed'}`
    : '';

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `${patientBlock}${clinicalContext}

Specialty Analysis Results:
${specialtyText}

Raw Lab Results:
${ctx.examText}`
    }]
  });

  const rawText = response.content?.[0]?.text;
  if (!rawText) throw new Error('[clinical_correlation] Claude returned empty response');
  const cleaned = rawText.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[clinical_correlation] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }
  result.disclaimer = DISCLAIMER;
  result.suggested_exams    = result.suggested_exams    || [];
  result.contextual_factors = result.contextual_factors || [];
  result.alerts             = result.alerts             || [];
  result.recommendations    = result.recommendations    || [];
  return { result, usage: response.usage };
}

module.exports = { runClinicalCorrelationAgent };
