'use strict';
/**
 * Tests pra webhook handlers Stripe. Mocka Stripe SDK + pg + redis.
 *
 * Padrão: build Fastify isolado com decorators + inject. Stripe SDK é
 * mockado completamente — não tocamos rede.
 */

jest.mock('stripe', () => {
  const mockConstructEvent = jest.fn();
  const MockStripe = jest.fn(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  }));
  MockStripe.mockConstructEvent = mockConstructEvent;
  return MockStripe;
});

const Stripe = require('stripe');
const { handleCheckoutCompleted } = require('../../src/services/billing-events');

function buildPgMock() {
  const queries = [];
  const client = {
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      // INSERT INTO payment_events ON CONFLICT … RETURNING id
      if (/INSERT INTO payment_events/i.test(sql)) {
        return { rows: [{ id: 1 }] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  return {
    pool: {
      connect: jest.fn(async () => client),
      query: jest.fn(),
    },
    client,
    queries,
  };
}

function buildRedisMock() {
  return { publish: jest.fn(async () => 1) };
}

describe('handleCheckoutCompleted — subscription mode', () => {
  beforeEach(() => jest.clearAllMocks());

  test('grant 122 créditos + ativa tenant', async () => {
    const pgMock = buildPgMock();
    const redisMock = buildRedisMock();
    const event = {
      id: 'evt_test_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_001',
          mode: 'subscription',
          client_reference_id: 'tenant-uuid-1',
          customer: 'cus_test_001',
          subscription: 'sub_test_001',
          amount_total: 19900,
        },
      },
    };

    const result = await handleCheckoutCompleted(pgMock.pool, event, redisMock);

    expect(result).toEqual({ handled: true, idempotent: false, credits: 122 });
    // payment_events insert
    expect(pgMock.client.query.mock.calls.some(c => /INSERT INTO payment_events/.test(c[0]))).toBe(true);
    // tenants UPDATE
    expect(pgMock.client.query.mock.calls.some(c => /UPDATE tenants SET active = true/.test(c[0]))).toBe(true);
    // subscriptions UPSERT
    expect(pgMock.client.query.mock.calls.some(c => /INSERT INTO subscriptions/.test(c[0]))).toBe(true);
    // credit_ledger
    const ledger = pgMock.client.query.mock.calls.find(c => /INSERT INTO credit_ledger/.test(c[0]));
    expect(ledger[1]).toEqual(['tenant-uuid-1', 122]);
    // WS publish
    expect(redisMock.publish).toHaveBeenCalledWith('billing:activated:tenant-uuid-1', expect.any(String));
  });

  test('event duplicado → idempotent (no-op nos UPSERTs)', async () => {
    const pgMock = buildPgMock();
    // Sobrescreve pra simular ON CONFLICT DO NOTHING (sem RETURNING)
    pgMock.client.query.mockImplementation(async (sql) => {
      if (/INSERT INTO payment_events/i.test(sql)) {
        return { rows: [] }; // ← simula duplicate
      }
      return { rows: [] };
    });
    const redisMock = buildRedisMock();
    const event = {
      id: 'evt_test_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_001',
          mode: 'subscription',
          client_reference_id: 'tenant-uuid-1',
          customer: 'cus_test_001',
          subscription: 'sub_test_001',
        },
      },
    };

    const result = await handleCheckoutCompleted(pgMock.pool, event, redisMock);
    expect(result).toEqual({ handled: true, idempotent: true });
    // Não deve ter chamado tenants UPDATE nem credit_ledger
    expect(pgMock.client.query.mock.calls.some(c => /UPDATE tenants/.test(c[0]))).toBe(false);
    expect(pgMock.client.query.mock.calls.some(c => /credit_ledger/.test(c[0]))).toBe(false);
    expect(redisMock.publish).not.toHaveBeenCalled();
  });

  test('sem client_reference_id e sem metadata.tenant_id → throw', async () => {
    const pgMock = buildPgMock();
    const event = {
      id: 'evt_test_002',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_002', mode: 'subscription' } },
    };
    await expect(handleCheckoutCompleted(pgMock.pool, event, null)).rejects.toThrow(/sem tenant_id/);
  });
});
