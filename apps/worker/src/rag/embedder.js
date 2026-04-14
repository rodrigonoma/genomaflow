const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Generates a 1536-dimensional embedding using text-embedding-3-small.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embed(text) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000)
  });
  return response.data[0].embedding;
}

module.exports = { embed };
