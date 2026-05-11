'use strict';

/**
 * Classificação e OCR de imagens.
 *
 * Cobre dois casos de uso:
 *   - Imagem médica (raio-X, ECG, ultrassom, MRI/CT) → pipeline imaging existente
 *   - Foto/scan de laudo impresso (hemograma, bioquímico, etc.) → pipeline texto
 *     via OCR Vision (substitui extração de PDF)
 *
 * Modelo: Claude Sonnet 4.6 (mesmo já usado em classifiers/imaging.js).
 */

const Anthropic = require('@anthropic-ai/sdk').default;
const MODELS = require('../config/models');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });
const MODEL = MODELS.VISION;

/**
 * Classifica o conteúdo da imagem.
 * @param {string} imageBase64
 * @param {string} mediaType — 'image/jpeg' | 'image/png' | etc.
 * @returns {Promise<'medical_image'|'document'|'unknown'>}
 */
async function classifyImageContent(imageBase64, mediaType) {
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 30,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text:
            'Classify this image. Reply with EXACTLY one word:\n' +
            '- medical_image: it is a medical imaging study (X-ray, CT, MRI, ultrasound, ECG/EKG tracing)\n' +
            '- document: it is a photo or scan of a printed laboratory report, prescription, medical record, or any text document\n' +
            '- unknown: cannot determine'
          }
        ]
      }]
    });
    const text = response.content[0]?.text?.trim().toLowerCase() ?? '';
    if (text.includes('medical_image')) return 'medical_image';
    if (text.includes('document')) return 'document';
    return 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

/**
 * Extrai texto de uma foto/scan de laudo impresso via Vision OCR.
 * Retorna texto plano preservando estrutura (cabeçalhos, tabelas, valores+unidades+ref).
 *
 * @param {string} imageBase64
 * @param {string} mediaType
 * @returns {Promise<string>}
 */
async function ocrLabReport(imageBase64, mediaType) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text:
          'Extract ALL text from this medical document image. Output as plain text preserving structure:\n' +
          '- Headers (lab name, doctor, patient if present)\n' +
          '- Test results table: one row per test with name, value, unit, reference range\n' +
          '- Comments/observations\n\n' +
          'Be ACCURATE — preserve numeric values exactly. Do NOT interpret or analyze, only transcribe. ' +
          'If text is unreadable in some part, write "[ilegível]" but continue with what is readable.'
        }
      ]
    }]
  });
  return (response.content[0]?.text || '').trim();
}

module.exports = { classifyImageContent, ocrLabReport };
