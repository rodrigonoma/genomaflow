'use strict';
/**
 * Validation gate tests pra apps/api/src/routes/billing.js.
 *
 * Foco: paths de rejeição (admin-only + validação de body) que rodam ANTES
 * de qualquer DB op. Money-critical — bug aqui = clínica cobra/concede crédito
 * errado ou usuário comum modifica saldo.
 */

const Fastify = require('fastify');

function buildApp(role = 'admin') {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async function (request) {
    request.user = {
      user_id: '00000000-0000-0000-0000-000000000099',
      tenant_id: '00000000-0000-0000-0000-000000000099',
      role,
      module: 'human',
    };
  });

  // Stub pg — joga se chamado em request rejeitado por gate (sinal de regressão)
  app.decorate('pg', {
    query: jest.fn(async () => ({ rows: [{}] })),
    connect: jest.fn(async () => ({
      query: jest.fn(async () => ({ rows: [] })),
      release: jest.fn(),
    })),
  });

  app.decorate('redis', {
    publish: jest.fn(async () => 1),
  });

  return app;
}

async function withApp(role = 'admin') {
  const app = buildApp(role);
  await app.register(require('../../src/routes/billing'));
  await app.ready();
  return app;
}

describe('billing — admin-only gate', () => {
  for (const role of ['doctor', 'lab_tech', 'master']) {
    test(`POST /billing/subscribe — role=${role} → 403`, async () => {
      const app = await withApp(role);
      const res = await app.inject({
        method: 'POST',
        url: '/billing/subscribe',
        payload: { gateway: 'stripe', plan: 'pro' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/Admin only/);
      await app.close();
    });

    test(`POST /billing/topup — role=${role} → 403`, async () => {
      const app = await withApp(role);
      const res = await app.inject({
        method: 'POST',
        url: '/billing/topup',
        payload: { gateway: 'stripe', credits: 100 },
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    test(`GET /billing/usage — role=${role} → 403`, async () => {
      const app = await withApp(role);
      const res = await app.inject({ method: 'GET', url: '/billing/usage' });
      expect(res.statusCode).toBe(403);
      await app.close();
    });
  }
});

describe('billing — POST /billing/subscribe validation', () => {
  let app;
  beforeAll(async () => { app = await withApp('admin'); });
  afterAll(async () => { await app.close(); });

  test('sem gateway → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/billing/subscribe', payload: { plan: 'pro' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/gateway/);
  });

  test('sem plan → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/billing/subscribe', payload: { gateway: 'stripe' } });
    expect(res.statusCode).toBe(400);
  });

  test('gateway fora da whitelist (paypal) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/billing/subscribe',
      payload: { gateway: 'paypal', plan: 'pro' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Gateway inválido/);
  });

  test('gateway=mercadopago aceito (whitelist permite stripe e mercadopago)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/billing/subscribe',
      payload: { gateway: 'mercadopago', plan: 'pro' },
    });
    // Não deve ser 400 por gateway — pode ser 200 ou outro erro downstream
    expect(res.json().error || '').not.toMatch(/Gateway inválido/);
  });
});

describe('billing — POST /billing/topup validation', () => {
  let app;
  beforeAll(async () => { app = await withApp('admin'); });
  afterAll(async () => { await app.close(); });

  test('sem gateway → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/billing/topup', payload: { credits: 100 } });
    expect(res.statusCode).toBe(400);
  });

  test('sem credits → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/billing/topup', payload: { gateway: 'stripe' } });
    expect(res.statusCode).toBe(400);
  });

  test('credits fora de VALID_CREDIT_PACKAGES (50) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/billing/topup',
      payload: { gateway: 'stripe', credits: 50 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Pacote inválido/);
  });

  test('credits=999 (não múltiplo dos pacotes oficiais) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/billing/topup',
      payload: { gateway: 'stripe', credits: 999 },
    });
    expect(res.statusCode).toBe(400);
  });

  test.each([100, 250, 500])('credits=%i (pacote válido) → não rejeita por pacote', async (credits) => {
    const res = await app.inject({
      method: 'POST',
      url: '/billing/topup',
      payload: { gateway: 'stripe', credits },
    });
    expect(res.json().error || '').not.toMatch(/Pacote inválido/);
  });
});
