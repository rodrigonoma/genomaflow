'use strict';

const { withTenant } = require('../db/tenant');

async function getBalance(pg, tenantId) {
  const { rows } = await pg.query(
    `SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_ledger WHERE tenant_id = $1`,
    [tenantId]
  );
  return Number(rows[0].balance);
}

async function debit(pg, { tenantId, amount, kind, description, refId, userId }) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('debit: amount deve ser inteiro positivo (será negativado internamente)');
  }
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description, ref_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, amount`,
      [tenantId, -amount, kind, description, refId]
    );
    return rows[0];
  }, { userId, channel: 'ui' });
}

async function refund(pg, { tenantId, amount, kind, description, refId, userId }) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('refund: amount deve ser inteiro positivo');
  }
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description, ref_id) SELECT $1, $2, $3, $4, $5 WHERE NOT EXISTS (SELECT 1 FROM credit_ledger WHERE ref_id = $5 AND kind = $3) RETURNING id, amount`,
      [tenantId, +amount, kind, description, refId]
    );
    return rows[0] || null;
  }, { userId, channel: 'worker' });
}

module.exports = { getBalance, debit, refund };
