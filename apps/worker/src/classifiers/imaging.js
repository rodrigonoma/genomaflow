const Anthropic = require('@anthropic-ai/sdk').default;
const MODELS = require('../config/models');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });

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
 * Detecta o MIME type real da imagem a partir dos magic bytes do buffer.
 * @param {Buffer} buffer
 * @returns {'image/jpeg'|'image/png'|'image/webp'|'image/gif'}
 */
function detectImageMime(buffer) {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp';
  return 'image/png';
}

/**
 * Classifica a modalidade de imagem médica.
 * Usa o header DICOM se disponível; fallback para Claude Vision.
 * @param {string|null} imageBase64
 * @param {object} imageMeta
 * @param {Buffer|null} rawBuffer
 * @returns {Promise<'rx'|'ecg'|'ultrasound'|'mri'|null>}
 */
async function classifyModality(imageBase64, imageMeta, rawBuffer = null) {
  if (imageMeta?.modality) {
    const mapped = DICOM_MODALITY_MAP[imageMeta.modality];
    if (mapped) return mapped;
  }

  if (!imageBase64) return null;
  const mediaType = rawBuffer ? detectImageMime(rawBuffer) : 'image/png';
  try {
    // Classificação trivial (1 palavra). Haiku 4.5 suporta vision e é
    // 3-4x mais barato que Sonnet — adequado pra tarefas categoriais
    // simples em fallback (DICOM header é a fonte primária). Se Haiku
    // regredir qualidade em prod, reverter pra MODELS.VISION.
    const response = await client.messages.create({
      model: MODELS.UTILITY,
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
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

module.exports = { detectFileType, classifyModality, detectImageMime };
