'use strict';
/**
 * Regression tests pra ACL master-only — incidente 2026-04-23 onde
 * `feedback.js` e `error-log.js` checavam `role !== 'admin'` (todo admin de
 * clínica passava) em vez de `role !== 'master'`. Bug deixava admins de
 * qualquer tenant ver dados cross-tenant.
 *
 * Testa o gate em isolamento: monta Fastify mínimo com `fastify.authenticate`
 * stub que lê role de um header, registra o módulo de rota, e assert que
 * roles != 'master' caem em 403 ANTES de qualquer query no banco.
 */

const Fastify = require('fastify');

/**
 * Builda Fastify mínimo com auth stub e pg stub. O pg stub joga se chamado —
 * se cair lá, é sinal que o gate passou indevidamente (regressão).
 */
function buildApp() {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async function (request, reply) {
    const role = request.headers['x-test-role'];
    if (!role) {
      return reply.status(401).send({ error: 'no auth' });
    }
    request.user = {
      user_id: '00000000-0000-0000-0000-000000000099',
      tenant_id: '00000000-0000-0000-0000-000000000099',
      role,
      module: 'human',
    };
  });

  app.decorate('pg', {
    query: jest.fn(async () => {
      throw new Error('pg.query should NOT be called when ACL rejects request');
    }),
  });

  return app;
}

describe('Master ACL — /master/*', () => {
  let app;
  beforeAll(async () => {
    app = buildApp();
    await app.register(require('../../src/routes/master'), { prefix: '/master' });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  // Lista de rotas master que devem rejeitar não-master
  const routes = [
    { method: 'GET',    url: '/master/tenants' },
    { method: 'PATCH',  url: '/master/tenants/abc/activate' },
    { method: 'PATCH',  url: '/master/tenants/abc/deactivate' },
    { method: 'GET',    url: '/master/tenants/abc/users' },
    { method: 'PATCH',  url: '/master/tenants/abc/users/u1/toggle' },
    { method: 'GET',    url: '/master/errors' },
    { method: 'GET',    url: '/master/feedback' },
    { method: 'GET',    url: '/master/stats' },
    { method: 'GET',    url: '/master/help-analytics' },
  ];

  for (const r of routes) {
    test(`${r.method} ${r.url} — admin role gets 403 (não 200)`, async () => {
      const res = await app.inject({
        method: r.method,
        url: r.url,
        headers: { 'x-test-role': 'admin' },
      });
      expect(res.statusCode).toBe(403);
    });

    test(`${r.method} ${r.url} — doctor role gets 403`, async () => {
      const res = await app.inject({
        method: r.method,
        url: r.url,
        headers: { 'x-test-role': 'doctor' },
      });
      expect(res.statusCode).toBe(403);
    });

    test(`${r.method} ${r.url} — sem auth gets 401`, async () => {
      const res = await app.inject({ method: r.method, url: r.url });
      expect(res.statusCode).toBe(401);
    });
  }
});

describe('feedback ACL — GET /feedback (master-only)', () => {
  let app;
  beforeAll(async () => {
    app = buildApp();
    await app.register(require('../../src/routes/feedback'), { prefix: '/feedback' });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  test('admin role gets 403 — bug 2026-04-23 regression guard', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/feedback',
      headers: { 'x-test-role': 'admin' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Acesso restrito' });
  });

  test('doctor role gets 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/feedback',
      headers: { 'x-test-role': 'doctor' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('error-log ACL — GET /error-log (master-only)', () => {
  let app;
  beforeAll(async () => {
    app = buildApp();
    await app.register(require('../../src/routes/error-log'), { prefix: '/error-log' });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  test('admin role gets 403 — bug 2026-04-23 regression guard', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/error-log',
      headers: { 'x-test-role': 'admin' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Acesso restrito' });
  });

  test('doctor role gets 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/error-log',
      headers: { 'x-test-role': 'doctor' },
    });
    expect(res.statusCode).toBe(403);
  });
});
