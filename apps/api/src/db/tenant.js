/**
 * Executes fn(client) within a transaction with RLS tenant context set.
 * Commits on success, rolls back on error.
 *
 * Aceita 3ª forma com opções de auditoria: { userId, channel }.
 * Quando passados, popula app.user_id e app.actor_channel pra triggers
 * de audit_log saberem quem fez a mutação. Backward compat:
 *   withTenant(pg, tenantId, fn)                      // legado, sem audit context
 *   withTenant(pg, tenantId, fn, { userId, channel }) // com audit context
 *
 * channel ∈ { 'ui', 'copilot', 'system', 'worker' } — default 'ui' no trigger
 *
 * @param {import('pg').Pool} pg
 * @param {string} tenantId
 * @param {function} fn - async (client) => result
 * @param {object} [opts] - { userId?: string, channel?: string }
 * @returns {Promise<any>}
 */
async function withTenant(pg, tenantId, fn, opts) {
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

    // Opções de auditoria — set apenas se passadas (não quebra calls antigas)
    if (opts?.userId) {
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', opts.userId]);
    }
    if (opts?.channel) {
      await client.query('SELECT set_config($1, $2, true)', ['app.actor_channel', opts.channel]);
    }

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
