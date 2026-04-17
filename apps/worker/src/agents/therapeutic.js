const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'As sugestões terapêuticas são de suporte à decisão clínica e devem ser avaliadas e prescritas pelo profissional de saúde responsável. Não substituem consulta médica ou veterinária.';

function buildSystemPrompt(module) {
  const context = module === 'veterinary'
    ? 'veterinary clinical decision support, considering species-specific pharmacology and contraindications'
    : 'human clinical decision support, following Brazilian medical guidelines';
  return `You are a specialized therapeutic recommendations analyst providing ${context}.
Based on the specialty analysis results and raw lab values provided, suggest therapeutic interventions.
Respond ONLY with valid JSON:
{
  "interpretation": "<summary of therapeutic approach in Brazilian Portuguese>",
  "recommendations": [
    { "type": "<medication|procedure|referral>", "description": "<text in Brazilian Portuguese>", "priority": "<low|medium|high>" }
  ],
  "risk_scores": { "therapeutic_urgency": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Never prescribe specific doses or brand names. Suggest therapeutic classes and protocols only. Never diagnose.`;
}

/**
 * @param {{ examText: string, patient: object, specialtyResults: Array, module: string, species: string|null }} ctx
 */
async function runTherapeuticAgent(ctx) {
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
  if (!rawText) throw new Error('[therapeutic] Claude returned empty response');
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;
  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[therapeutic] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }
  result.disclaimer = DISCLAIMER;
  result.recommendations = result.recommendations || [];
  return result;
}

module.exports = { runTherapeuticAgent };
