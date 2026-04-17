const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'As sugestões de nutrição e hábitos são de suporte à decisão clínica e devem ser avaliadas pelo profissional de saúde responsável. Não substituem consulta médica, veterinária ou com nutricionista.';

function buildSystemPrompt(module) {
  const context = module === 'veterinary'
    ? 'veterinary nutritional and husbandry recommendations, species-specific dietary guidance'
    : 'human nutritional and lifestyle recommendations following Brazilian dietary guidelines';
  return `You are a specialized nutrition and lifestyle analyst providing ${context}.
Based on the specialty analysis results and raw lab values, suggest dietary and lifestyle interventions.
Respond ONLY with valid JSON:
{
  "interpretation": "<summary of nutritional approach in Brazilian Portuguese>",
  "recommendations": [
    { "type": "<diet|habit|supplement|activity>", "description": "<text in Brazilian Portuguese>", "priority": "<low|medium|high>" }
  ],
  "risk_scores": { "nutritional_risk": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Never prescribe medication. Focus only on diet, habits, and lifestyle. Never diagnose.`;
}

/**
 * @param {{ examText: string, patient: object, specialtyResults: Array, module: string, species: string|null }} ctx
 */
async function runNutritionAgent(ctx) {
  const systemPrompt = buildSystemPrompt(ctx.module);
  const specialtyText = ctx.specialtyResults
    .map(r => `## ${r.agent_type}\n${r.interpretation}\nAlerts: ${JSON.stringify(r.alerts)}`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Module: ${ctx.module}${ctx.species ? `, species: ${ctx.species}` : ''}\nPatient: sex=${ctx.patient.sex}\n\nSpecialty Analysis:\n${specialtyText}\n\nRaw Lab Results:\n${ctx.examText}`
    }]
  });

  const rawText = response.content?.[0]?.text;
  if (!rawText) throw new Error('[nutrition] Claude returned empty response');
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;
  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[nutrition] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }
  result.disclaimer = DISCLAIMER;
  result.recommendations = result.recommendations || [];
  return result;
}

module.exports = { runNutritionAgent };
