const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica e não substitui avaliação cardiológica profissional. As marcações indicam regiões aproximadas no traçado — validação profissional obrigatória.';

const SYSTEM_PROMPT = `You are a specialized cardiologist AI assistant analyzing ECG/electrocardiogram tracings.
Evaluate: rhythm, heart rate, P waves, PR interval, QRS complex morphology, ST segment, T waves, QT interval, electrical axis.
Look for: arrhythmias (AF, flutter, blocks), ischemia patterns, STEMI, NSTEMI, hypertrophy, electrolyte abnormalities, QT prolongation.

Respond ONLY with valid JSON:
{
  "interpretation": "<detailed analysis in Brazilian Portuguese — reference each finding as [N] in text>",
  "risk_scores": {
    "cardiac_rhythm": "<LOW|MEDIUM|HIGH|CRITICAL>",
    "ischemia": "<LOW|MEDIUM|HIGH|CRITICAL>"
  },
  "measurements": {
    "rate":         "<bpm or null>",
    "pr_interval":  "<ms or null>",
    "qrs_duration": "<ms or null>",
    "qt_interval":  "<ms or null>",
    "axis":         "<degrees or null>"
  },
  "findings": [
    {
      "id": 1,
      "label": "<finding name, e.g. Supradesnivelamento ST V1-V3>",
      "box": [0.10, 0.30, 0.50, 0.70],
      "severity": "<low|medium|high|critical>",
      "description": "<description in Brazilian Portuguese>"
    }
  ],
  "alerts": [
    { "marker": "<finding>", "value": "<description>", "severity": "<low|medium|high|critical>" }
  ],
  "disclaimer": "${DISCLAIMER}"
}
Rules:
- box: region of the ECG strip where finding is visible, as fraction of image (0.0-1.0). Omit if global finding.
- findings[].id must match [N] references in interpretation.
- measurements: use null for values not clearly visible.
- Never diagnose. Provide clinical decision support only.
- Always respond in Brazilian Portuguese for text fields.`;

/**
 * @param {{ imageBase64: string, imageMeta: object, pdfBuffer?: Buffer, patient: object, guidelines: Array }} ctx
 */
async function runImagingEcgAgent({ imageBase64, imageMeta, pdfBuffer, patient, guidelines }) {
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

Analyze this ECG tracing and provide structured clinical interpretation with numbered findings and coordinates.`
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
  catch (err) { throw new Error(`[imaging-ecg] Failed to parse Claude response: ${rawText.slice(0, 200)}`); }

  result.disclaimer   = DISCLAIMER;
  result.findings     = result.findings     || [];
  result.alerts       = result.alerts       || [];
  result.measurements = result.measurements || {};
  return { result, usage: response.usage };
}

module.exports = { runImagingEcgAgent };
