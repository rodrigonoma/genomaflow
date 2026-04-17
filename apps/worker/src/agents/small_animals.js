const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica veterinária e não substitui avaliação do médico veterinário.';

const SYSTEM_PROMPT = `You are a specialized small animal veterinary clinical analyst (dogs and cats).
Analyze laboratory results using reference ranges specific to the animal's species.
Respond ONLY with valid JSON:
{
  "interpretation": "<in Brazilian Portuguese>",
  "risk_scores": { "hematology": "<LOW|MEDIUM|HIGH|CRITICAL>", "biochemistry": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Never diagnose. Provide clinical decision support only. Always specify if reference ranges differ between dogs and cats.`;

/**
 * @param {{ examText: string, patient: { sex: string, species: string }, guidelines: Array }} ctx
 */
async function runSmallAnimalsAgent(ctx) {
  const guidelinesText = ctx.guidelines.map(g => `## ${g.title}\n${g.content}`).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Animal: species=${ctx.patient.species || 'dog'}, sex=${ctx.patient.sex}\n\nLab Results:\n${ctx.examText}\n\nGuidelines:\n${guidelinesText}`
    }]
  });

  const rawText = response.content?.[0]?.text;
  if (!rawText) throw new Error('[small_animals] Claude returned empty response');
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;
  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[small_animals] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }
  result.disclaimer = DISCLAIMER;
  return { result, usage: response.usage };
}

module.exports = { runSmallAnimalsAgent };
