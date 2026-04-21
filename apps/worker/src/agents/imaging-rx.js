const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica e não substitui avaliação radiológica profissional. As marcações indicam regiões aproximadas identificadas pela IA — validação profissional obrigatória.';

const SYSTEM_PROMPT = `You are a specialized radiologist AI assistant analyzing X-ray and CT images.
Evaluate: lung fields, cardiac silhouette, mediastinum, pleural spaces, bony structures, soft tissues, diaphragm.
Look for: pneumonia, consolidations, effusions, pneumothorax, cardiomegaly, nodules, masses, fractures, infiltrates.

Respond ONLY with valid JSON:
{
  "interpretation": "<detailed findings in Brazilian Portuguese — reference each finding as [N] exactly where it appears in text>",
  "risk_scores": {
    "pulmonary": "<LOW|MEDIUM|HIGH|CRITICAL>",
    "cardiac": "<LOW|MEDIUM|HIGH|CRITICAL>"
  },
  "findings": [
    {
      "id": 1,
      "label": "<short finding name in Portuguese, e.g. Consolidação inf. D>",
      "box": [0.55, 0.60, 0.82, 0.90],
      "severity": "<low|medium|high|critical>",
      "description": "<detailed description in Brazilian Portuguese>"
    }
  ],
  "alerts": [
    { "marker": "<finding name>", "value": "<brief description>", "severity": "<low|medium|high|critical>" }
  ],
  "disclaimer": "${DISCLAIMER}"
}
Rules:
- box coordinates: [x1, y1, x2, y2] as fraction of image dimensions (0.0 to 1.0, origin top-left).
- Omit box if the finding has no specific localizable region.
- findings[].id must match the [N] reference used in interpretation text.
- If image quality is insufficient, state so clearly and return empty findings[].
- Never provide a definitive diagnosis — provide clinical decision support only.
- Always respond in Brazilian Portuguese for text fields.`;

/**
 * @param {{ imageBase64: string, imageMeta: object, pdfBuffer?: Buffer, patient: object, guidelines: Array }} ctx
 */
async function runImagingRxAgent({ imageBase64, imageMeta, pdfBuffer, patient, guidelines }) {
  const guidelinesText = (guidelines || []).map(g => `## ${g.title}\n${g.content}`).join('\n\n');
  const metaText = Object.entries(imageMeta || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');

  const content = [];

  if (imageBase64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } });
  } else if (pdfBuffer) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') } });
  }

  content.push({
    type: 'text',
    text: `Patient: sex=${patient.sex || 'unknown'}${patient.species ? ', species=' + patient.species : ''}
${metaText ? 'DICOM metadata: ' + metaText : ''}
${guidelinesText ? '\nGuidelines:\n' + guidelinesText : ''}

Analyze this radiograph and provide structured clinical interpretation with numbered findings and coordinates.`
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
  catch (err) { throw new Error(`[imaging-rx] Failed to parse Claude response: ${rawText.slice(0, 200)}`); }

  result.disclaimer = DISCLAIMER;
  result.findings   = result.findings || [];
  result.alerts     = result.alerts   || [];
  return { result, usage: response.usage };
}

module.exports = { runImagingRxAgent };
