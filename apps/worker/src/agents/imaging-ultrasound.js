const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica e não substitui avaliação ultrassonográfica profissional. As marcações indicam regiões aproximadas — validação profissional obrigatória.';

const SYSTEM_PROMPT = `You are a specialized sonographer AI assistant analyzing ultrasound images.
Evaluate visible structures based on the anatomical region shown.
Look for: abnormal echogenicity, masses, fluid collections, cysts, organ enlargement or atrophy, vascular abnormalities, free fluid.

Respond ONLY with valid JSON:
{
  "interpretation": "<detailed findings in Brazilian Portuguese — reference each finding as [N] in text>",
  "risk_scores": {
    "structural": "<LOW|MEDIUM|HIGH|CRITICAL>"
  },
  "findings": [
    {
      "id": 1,
      "label": "<finding name in Portuguese, e.g. Coleção anecóica hepática>",
      "box": [0.30, 0.25, 0.65, 0.70],
      "severity": "<low|medium|high|critical>",
      "description": "<description in Brazilian Portuguese>"
    }
  ],
  "alerts": [
    { "marker": "<structure>", "value": "<finding>", "severity": "<low|medium|high|critical>" }
  ],
  "disclaimer": "${DISCLAIMER}"
}
Rules:
- box: region where finding is visible, as fraction of image (0.0-1.0). Omit if no specific localizable region.
- findings[].id must match [N] references in interpretation.
- For veterinary images: note species-specific anatomy when relevant.
- Never diagnose. Provide clinical decision support only.
- Always respond in Brazilian Portuguese for text fields.`;

/**
 * @param {{ imageBase64: string, imageMeta: object, pdfBuffer?: Buffer, patient: object, guidelines: Array }} ctx
 */
async function runImagingUltrasoundAgent({ imageBase64, imageMeta, pdfBuffer, patient, guidelines }) {
  const guidelinesText = (guidelines || []).map(g => `## ${g.title}\n${g.content}`).join('\n\n');

  const content = [];

  if (imageBase64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } });
  } else if (pdfBuffer) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') } });
  }

  content.push({
    type: 'text',
    text: `Patient: sex=${patient.sex || 'unknown'}${patient.species ? ', species=' + patient.species : ''}
${guidelinesText ? '\nGuidelines:\n' + guidelinesText : ''}

Analyze this ultrasound image and provide structured clinical interpretation with numbered findings and coordinates.`
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }]
  });

  const rawText = response.content?.[0]?.text ?? '';
  const start = rawText.indexOf('{');
  const end   = rawText.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;

  let result;
  try { result = JSON.parse(jsonText); }
  catch (err) { throw new Error(`[imaging-ultrasound] Failed to parse Claude response: ${rawText.slice(0, 200)}`); }

  result.disclaimer = DISCLAIMER;
  result.findings   = result.findings || [];
  result.alerts     = result.alerts   || [];
  return { result, usage: response.usage };
}

module.exports = { runImagingUltrasoundAgent };
