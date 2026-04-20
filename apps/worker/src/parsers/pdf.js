const pdfParse = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Minimum character threshold to consider pdf-parse extraction successful
const MIN_TEXT_LENGTH = 100;

async function extractTextViaOcr(buffer) {
  const response = await anthropic.messages.create({
    model: process.env.OCR_MODEL || 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: buffer.toString('base64')
          }
        },
        {
          type: 'text',
          text: 'This is a scanned medical/veterinary lab report. Extract all text exactly as it appears, preserving values, units, and reference ranges. Return only the extracted text, no commentary.'
        }
      ]
    }]
  });

  const text = response.content.find(c => c.type === 'text')?.text ?? '';
  if (!text || text.trim().length === 0) {
    throw new Error('OCR returned empty content');
  }
  return text;
}

/**
 * Extracts raw text from a PDF buffer.
 * Falls back to Claude Vision OCR for scanned/image-only PDFs.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractText(buffer) {
  const result = await pdfParse(buffer);
  if (result.text && result.text.trim().length >= MIN_TEXT_LENGTH) {
    return result.text;
  }

  console.log('[pdf] Digital text extraction insufficient, falling back to OCR');
  return extractTextViaOcr(buffer);
}

module.exports = { extractText };
