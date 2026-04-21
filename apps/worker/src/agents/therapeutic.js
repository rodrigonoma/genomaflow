const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'As sugestões terapêuticas são de suporte à decisão clínica e devem ser avaliadas e prescritas pelo profissional de saúde responsável. Os medicamentos, doses e frequências sugeridos são recomendações iniciais que DEVEM ser validados, ajustados ou descartados pelo médico ou veterinário antes de qualquer prescrição. Não substituem consulta médica ou veterinária.';

function buildSystemPrompt(module) {
  const context = module === 'veterinary'
    ? 'veterinary clinical decision support, considering species-specific pharmacology, contraindications and Brazilian MAPA/CFMV guidelines'
    : 'human clinical decision support, following Brazilian ANVISA guidelines and CFM protocols';
  return `You are a specialized therapeutic recommendations analyst providing ${context}.
Based on the specialty analysis results and raw lab values provided, suggest therapeutic interventions.
Respond ONLY with valid JSON:
{
  "interpretation": "<summary of therapeutic approach in Brazilian Portuguese>",
  "recommendations": [
    {
      "type": "medication",
      "name": "<specific medication name in Brazilian Portuguese, e.g. Metformina, Enalapril>",
      "dose": "<dose with unit, e.g. 500mg, 10mg/kg>",
      "frequency": "<e.g. 2x ao dia com refeições, 1x ao dia em jejum>",
      "duration": "<e.g. 30 dias — reavaliar, uso contínuo>",
      "priority": "<low|medium|high>",
      "description": "<clinical rationale in Brazilian Portuguese — link to specific lab finding>"
    },
    {
      "type": "procedure",
      "description": "<text in Brazilian Portuguese>",
      "priority": "<low|medium|high>"
    },
    {
      "type": "referral",
      "description": "<text in Brazilian Portuguese>",
      "priority": "<low|medium|high>"
    }
  ],
  "risk_scores": { "therapeutic_urgency": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Rules:
- For type=medication: always include name, dose, frequency, duration. Suggest specific molecules (e.g. Metformina, not just "biguanida").
- For veterinary module: use species-appropriate medications and doses (e.g. Enrofloxacino 5mg/kg for dogs).
- For type=procedure or referral: omit name/dose/frequency/duration fields.
- Link each medication recommendation to the specific lab finding that justifies it.
- The professional will review and edit before prescribing — you may suggest, they decide.`;
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
  return { result, usage: response.usage };
}

module.exports = { runTherapeuticAgent };
