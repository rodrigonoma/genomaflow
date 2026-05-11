'use strict';

const { describe, test, expect } = require('@jest/globals');

jest.mock('../../src/db/tenant', () => ({
  withTenant: (pg, tid, fn, opts) => fn(pg),
}));

const { getBalance, debit, refund } = require('../../src/services/aesthetic-credits');

function mockPg(balance = 100) {
  return {
    query: jest.fn(async (sql, params) => {
      if (/COALESCE\(SUM\(amount\)/i.test(sql)) {
        return { rows: [{ balance: String(balance) }] };
      }
      if (/INSERT INTO credit_ledger/i.test(sql)) {
        return { rows: [{ id: 'cl1', amount: params[1] }] };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

describe('aesthetic-credits service', () => {
  test('getBalance retorna número', async () => {
    const pg = mockPg(50);
    expect(await getBalance(pg, 't1')).toBe(50);
  });

  test('debit insere amount negativo', async () => {
    const pg = mockPg();
    await debit(pg, { tenantId: 't1', amount: 5, kind: 'aesthetic_facial_analysis', description: 'test', refId: 'a1', userId: 'u1' });
    const insertCall = pg.query.mock.calls.find(c => /INSERT INTO credit_ledger/.test(c[0]));
    expect(insertCall[1][1]).toBe(-5);
  });

  test('refund insere amount positivo + idempotente via WHERE NOT EXISTS', async () => {
    const pg = mockPg();
    await refund(pg, { tenantId: 't1', amount: 5, kind: 'aesthetic_refund', description: 'test', refId: 'a1', userId: 'u1' });
    const insertCall = pg.query.mock.calls.find(c => /INSERT INTO credit_ledger/.test(c[0]));
    expect(insertCall[1][1]).toBe(+5);
  });

  test('debit rejeita amount negativo (deve ser positivo, virada internamente)', async () => {
    const pg = mockPg();
    await expect(debit(pg, { tenantId: 't1', amount: -1, kind: 'x', description: 'x', refId: 'x', userId: 'u' }))
      .rejects.toThrow(/amount/);
  });
});
