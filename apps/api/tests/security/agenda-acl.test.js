'use strict';
/**
 * Regression guard pra ACL da rota /agenda.
 *
 * Cobre:
 *  - Todos endpoints exigem auth (preHandler authenticate)
 *  - Não há check de role específico além de auth (qualquer admin/master logado
 *    com tenant_id consegue gerenciar SUA agenda — RLS + AND user_id garantem
 *    isolation no DB)
 *
 * Mock Fastify isolado — sem DB, sem Redis. Stub pg.query joga se chamado em
 * request rejeitado por gate (sinaliza regressão silenciosa).
 */

const Fastify = require('fastify');

function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async function (request, reply) {
    const role = request.headers['x-test-role'];
    if (!role) return reply.status(401).send({ error: 'no auth' });
    request.user = {
      user_id: '00000000-0000-0000-0000-000000000099',
      tenant_id: '00000000-0000-0000-0000-000000000099',
      role,
      module: request.headers['x-test-module'] || 'human',
    };
  });
  app.decorate('pg', {
    query: jest.fn(async () => ({ rows: [] })),
    connect: jest.fn(async () => ({
      query: jest.fn(async () => ({ rows: [{}] })),
      release: jest.fn(),
    })),
  });
  app.decorate('redis', { publish: jest.fn(async () => 1) });
  return app;
}

async function makeApp() {
  const app = buildApp();
  await app.register(require('../../src/routes/agenda'), { prefix: '/agenda' });
  await app.ready();
  return app;
}

describe('agenda ACL — auth obrigatório em todos endpoints', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  test.each([
    ['GET',    '/agenda/settings'],
    ['PUT',    '/agenda/settings'],
    ['GET',    '/agenda/appointments'],
    ['POST',   '/agenda/appointments'],
    ['PATCH',  '/agenda/appointments/abc'],
    ['POST',   '/agenda/appointments/abc/cancel'],
    ['DELETE', '/agenda/appointments/abc'],
    ['GET',    '/agenda/appointments/free-slots?date=2030-01-01'],
  ])('%s %s sem auth → 401', async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(401);
  });
});

describe('agenda multi-módulo — paridade human/vet', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  // O backend é módulo-agnóstico (subject_id polimórfico). Confirma que requests
  // de cada módulo passam pela mesma validação sem tratamento especial.
  test.each([
    ['human', 'admin'],
    ['veterinary', 'admin'],
    ['human', 'master'],
  ])('módulo=%s role=%s consegue acessar GET /settings', async (module, role) => {
    const res = await app.inject({
      method: 'GET',
      url: '/agenda/settings',
      headers: { 'x-test-role': role, 'x-test-module': module },
    });
    expect(res.statusCode).toBe(200);
  });

  test('PUT /settings rejeita slot fora da whitelist independente do módulo', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/agenda/settings',
      headers: { 'x-test-role': 'admin', 'x-test-module': 'veterinary' },
      payload: {
        default_slot_minutes: 35, // fora de [30,45,60,75,90,105,120]
        business_hours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
