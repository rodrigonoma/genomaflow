'use strict';

jest.mock('stripe', () => {
  const mock = {
    customers: {
      search: jest.fn(async () => ({ data: [] })),
      create: jest.fn(async () => ({ id: 'cus_test_001' })),
    },
    checkout: { sessions: { create: jest.fn(async () => ({ id: 'cs_test_001', url: 'https://stripe.test/s/cs_test_001' })) } },
    billingPortal: { sessions: { create: jest.fn(async () => ({ url: 'https://stripe.test/portal/test' })) } },
  };
  const Mock = jest.fn(() => mock);
  Mock._mock = mock;
  return Mock;
});

const Fastify = require('fastify');

function buildApp(role = 'admin') {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request) => {
    request.user = {
      user_id: 'u-1',
      tenant_id: 't-1',
      role,
      module: 'human',
    };
  });
  app.decorate('pg', {
    query: jest.fn(async (sql) => {
      if (/SELECT t.name, u.email/i.test(sql)) {
        return { rows: [{ name: 'Clínica Teste', email: 'admin@teste.com' }] };
      }
      return { rows: [] };
    }),
  });
  app.decorate('redis', { publish: jest.fn() });
  return app;
}

describe('POST /billing/checkout/subscription', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_SUBSCRIPTION = 'price_test_001';
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.FRONTEND_URL = 'https://app.test';
    jest.clearAllMocks();
    require('../../src/services/stripe-client')._resetClient();
  });

  test('admin → 200 com url do Stripe', async () => {
    const app = buildApp('admin');
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({ method: 'POST', url: '/billing/checkout/subscription' });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toMatch(/^https:\/\/stripe\.test/);
    await app.close();
  });

  for (const role of ['doctor', 'master']) {
    test(`role=${role} → 403`, async () => {
      const app = buildApp(role);
      await app.register(require('../../src/routes/billing'));
      const res = await app.inject({ method: 'POST', url: '/billing/checkout/subscription' });
      expect(res.statusCode).toBe(403);
      await app.close();
    });
  }

  test('STRIPE_PRICE_SUBSCRIPTION ausente → 500', async () => {
    delete process.env.STRIPE_PRICE_SUBSCRIPTION;
    const app = buildApp('admin');
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({ method: 'POST', url: '/billing/checkout/subscription' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

describe('POST /billing/checkout/topup', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.FRONTEND_URL = 'https://app.test';
    jest.clearAllMocks();
    require('../../src/services/stripe-client')._resetClient();
  });

  test('admin + credits=250 + payment_method=card → 200', async () => {
    const app = buildApp('admin');
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout/topup',
      payload: { credits: 250, payment_method: 'card' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toMatch(/^https:/);
    await app.close();
  });

  test('credits inválido (999) → 400', async () => {
    const app = buildApp('admin');
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout/topup',
      payload: { credits: 999, payment_method: 'card' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('payment_method inválido (boleto) → 400', async () => {
    const app = buildApp('admin');
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout/topup',
      payload: { credits: 100, payment_method: 'boleto' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /billing/portal', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.FRONTEND_URL = 'https://app.test';
    jest.clearAllMocks();
    require('../../src/services/stripe-client')._resetClient();
  });

  test('admin com gateway_customer_id → 200 url do Portal', async () => {
    const app = buildApp('admin');
    app.pg.query = jest.fn(async () => ({ rows: [{ gateway_customer_id: 'cus_test_001' }] }));
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({ method: 'POST', url: '/billing/portal' });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toMatch(/portal/);
    await app.close();
  });

  test('sem gateway_customer_id → 400', async () => {
    const app = buildApp('admin');
    app.pg.query = jest.fn(async () => ({ rows: [] }));
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({ method: 'POST', url: '/billing/portal' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Sem subscription/);
    await app.close();
  });
});
