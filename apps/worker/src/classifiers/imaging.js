const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DICOM_MODALITY_MAP = {
  CR:  'rx',
  DX:  'rx',
  RG:  'rx',
  CT:  'rx',
  MR:  'mri',
  US:  'ultrasound',
  ECG: 'ecg',
  EG:  'ecg',
  PT:  'mri',
};

/**
 * Detecta o tipo de arquivo pelo nome/extensão e MIME type.
 * @param {string} filename
 * @param {string} mimetype
 * @returns {'dicom' | 'image' | 'pdf' | 'unknown'}
 */
function detectFileType(filename, mimetype) {
  const ext = (filename ?? '').toLowerCase().split('.').pop();
  if (ext === 'dcm' || ext === 'dicom' || mimetype === 'application/dicom') return 'dicom';
  if (['jpg', 'jpeg', 'png', 'tiff', 'tif'].includes(ext)) return 'image';
  if (ext === 'pdf' || mimetype === 'application/pdf') return 'pdf';
  return 'unknown';
}

/**
 * Classifica a modalidade de imagem médica.
 * Usa o header DICOM se disponível; fallback para Claude Vision.
 * @param {string|null} imageBase64
 * @param {object} imageMeta
 * @returns {Promise<'rx'|'ecg'|'ultrasound'|null>}
 */
async function classifyModality(imageBase64, imageMeta) {
  if (imageMeta?.modality) {
    const mapped = DICOM_MODALITY_MAP[imageMeta.modality];
    if (mapped) return mapped;
  }

  if (!imageBase64) return null;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
          { type: 'text', text: 'Classify this medical image type. Respond with ONLY one word: rx | ecg | ultrasound | mri | other' }
        ]
      }]
    });
    const text = response.content[0]?.text?.trim().toLowerCase() ?? '';
    const match = text.match(/\b(rx|ecg|ultrasound|mri)\b/);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

module.exports = { detectFileType, classifyModality };
