const { embed } = require('./embedder');

/**
 * Retrieves the top-k most relevant clinical guidelines from pgvector,
 * filtered by module and optionally by species.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} queryText
 * @param {number} k
 * @param {'human'|'veterinary'} module
 * @param {string|null} species - null for human, 'dog'|'cat'|'equine'|'bovine' for vet
 * @returns {Promise<Array<{ title: string, content: string, source: string }>>}
 */
async function retrieveGuidelines(client, queryText, k = 5, module = 'human', species = null) {
  const embedding = await embed(queryText);

  const { rows } = await client.query(
    `SELECT title, content, source
     FROM rag_documents
     WHERE module IN ($1, 'both')
       AND (species IS NULL OR species = $2)
     ORDER BY embedding <=> $3::vector
     LIMIT $4`,
    [module, species, `[${embedding.join(',')}]`, k]
  );

  return rows;
}

module.exports = { retrieveGuidelines };
