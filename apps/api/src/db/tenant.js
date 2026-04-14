/**
 * Executes fn(client) within a transaction with RLS tenant context set.
 * Commits on success, rolls back on error.
 *
 * @param {import('pg').Pool} pg
 * @param {string} tenantId
 * @param {function} fn - async (client) => result
 * @returns {Promise<any>}
 */
async function withTenant(pg, tenantId, fn) {
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.tenant_id = $1', [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withTenant };
