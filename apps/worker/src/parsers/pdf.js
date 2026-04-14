const pdfParse = require('pdf-parse');

/**
 * Extracts raw text from a PDF buffer.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractText(buffer) {
  const result = await pdfParse(buffer);
  if (!result.text || result.text.trim().length === 0) {
    throw new Error('Empty PDF content');
  }
  return result.text;
}

module.exports = { extractText };
