const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica e não substitui avaliação médica profissional.';

const SYSTEM_PROMPT = `You are a specialized hematology clinical analyst.
Analyze complete blood count and hematological markers.
Respond ONLY with valid JSON:
{
  "interpretation": "<in Brazilian Portuguese>",
  "risk_scores": { "hematology": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Never diagnose. Provide clinical decision support only.`;

/**
 * @param {{ examText: string, patient: { sex: string, age_range: string }, guidelines: Array }} ctx
 */
async function runHematologyAgent(ctx) {
  const guidelinesText = ctx.guidelines.map(g => `## ${g.title}\n${g.content}`).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Patient context:
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
- family_history: ${ctx.patient.family_history || 'none reported'}

Lab Results:
${ctx.examText}

Guidelines:
${guidelinesText}`
    }]
  });

  const rawText = response.content?.[0]?.text;
  if (!rawText) throw new Error(`[hematology] Claude returned empty response`);
  const cleaned = rawText.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[hematology] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }
  result.disclaimer = DISCLAIMER;
  return { result, usage: response.usage };
}

module.exports = { runHematologyAgent };
