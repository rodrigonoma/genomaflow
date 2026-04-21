const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'As sugestões de nutrição e hábitos são de suporte à decisão clínica e devem ser avaliadas pelo profissional de saúde responsável. Não substituem consulta médica, veterinária ou com nutricionista.';

function buildSystemPrompt(module) {
  const context = module === 'veterinary'
    ? 'veterinary nutritional and husbandry recommendations, species-specific dietary guidance following Brazilian MAPA guidelines'
    : 'human nutritional and lifestyle recommendations following Brazilian dietary guidelines (Guia Alimentar para a População Brasileira)';
  return `You are a specialized nutrition and lifestyle analyst providing ${context}.
Based on the specialty analysis results and raw lab values, suggest dietary and lifestyle interventions.
Respond ONLY with valid JSON:
{
  "interpretation": "<summary of nutritional approach in Brazilian Portuguese — mention specific lab values that justify the approach>",
  "recommendations": [
    {
      "type": "diet",
      "description": "<specific dietary instruction in Brazilian Portuguese — always reference the lab finding, e.g. 'Reduzir carboidratos simples — glicemia 187 mg/dL detectada'>",
      "priority": "<low|medium|high>"
    },
    {
      "type": "supplement",
      "name": "<supplement name, e.g. Ômega-3, Vitamina D3>",
      "dose": "<dose with unit, e.g. 1g/dia, 2000 UI/dia>",
      "description": "<rationale in Brazilian Portuguese — reference the specific deficiency or finding>",
      "priority": "<low|medium|high>"
    },
    {
      "type": "habit",
      "description": "<lifestyle recommendation in Brazilian Portuguese>",
      "priority": "<low|medium|high>"
    },
    {
      "type": "activity",
      "description": "<physical activity recommendation in Brazilian Portuguese>",
      "priority": "<low|medium|high>"
    }
  ],
  "risk_scores": { "nutritional_risk": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Rules:
- Always reference specific lab values in each recommendation description.
- For type=supplement: always include name and dose.
- For veterinary: adapt to species diet (e.g. for dogs, mention brand-type guidance; for equines, mention forage/concentrate ratios).
- Never prescribe medication — only diet, habits, supplements and activity.`;
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
  return { result, usage: response.usage };
}

module.exports = { runNutritionAgent };
