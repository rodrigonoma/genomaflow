'use strict';
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function embedQuery(text) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000),
  });
  return res.data[0].embedding;
}

/**
 * Busca top-K chunks de product_help relevantes à pergunta.
 * Sem filtro por tenant — docs de produto são globais.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} queryText
 * @param {number} k
 * @returns {Promise<Array<{source:string,title:string,content:string,score:number}>>}
 */
async function retrieveProductHelp(db, queryText, k = 5) {
  const embedding = await embedQuery(queryText);
  const { rows } = await db.query(
    `SELECT source, title, content,
            1 - (embedding <=> $1::vector) AS score
     FROM rag_documents
     WHERE namespace = 'product_help'
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(embedding), k]
  );
  return rows;
}

module.exports = { retrieveProductHelp };
