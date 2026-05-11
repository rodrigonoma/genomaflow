'use strict';

const { describe, test, expect } = require('@jest/globals');
const Fastify = require('fastify');
const { requireEsteticaModule } = require('../../src/middleware/aesthetic-module-gate');

async function buildApp(role, module) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module };
  });
  app.get('/test', { preHandler: [app.authenticate, requireEsteticaModule] },
    async () => ({ ok: true }));
  return app;
}

describe('requireEsteticaModule', () => {
  test('passa quando module=estetica', async () => {
    const app = await buildApp('admin', 'estetica');
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  test('bloqueia 403 quando module=human', async () => {
    const app = await buildApp('admin', 'human');
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/estetica/i);
  });

  test('bloqueia 403 quando module=veterinary', async () => {
    const app = await buildApp('admin', 'veterinary');
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(403);
  });

  test('passa pra master mesmo sem module (pode acessar tudo)', async () => {
    const app = await buildApp('master', undefined);
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
  });
});
