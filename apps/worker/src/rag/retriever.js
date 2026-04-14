const { embed } = require('./embedder');

/**
 * Retrieves the top-k most relevant clinical guidelines from pgvector.
 *
 * @param {import('pg').PoolClient} client - DB client with tenant context set
 * @param {string} queryText - Exam markers as text
 * @param {number} k - Number of results (default 5)
 * @returns {Promise<Array<{ title: string, content: string, source: string }>>}
 */
async function retrieveGuidelines(client, queryText, k = 5) {
  const embedding = await embed(queryText);

  const { rows } = await client.query(
    `SELECT title, content, source
     FROM rag_documents
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [`[${embedding.join(',')}]`, k]
  );

  return rows;
}

module.exports = { retrieveGuidelines };
