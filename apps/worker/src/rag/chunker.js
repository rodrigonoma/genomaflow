const CHARS_PER_TOKEN = 4;
const DEFAULT_CHUNK_SIZE = 500;   // tokens
const DEFAULT_OVERLAP    = 100;   // tokens

/**
 * Splits text into overlapping chunks.
 * @param {string} text
 * @param {number} chunkSize tokens
 * @param {number} overlapSize tokens
 * @returns {string[]}
 */
function chunkText(text, chunkSize = DEFAULT_CHUNK_SIZE, overlapSize = DEFAULT_OVERLAP) {
  const chunkChars   = chunkSize   * CHARS_PER_TOKEN;
  const overlapChars = overlapSize * CHARS_PER_TOKEN;
  const step         = chunkChars - overlapChars;

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end   = Math.min(start + chunkChars, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) chunks.push(chunk);
    if (end >= text.length) break;
    start += step;
  }

  return chunks;
}

module.exports = { chunkText };
