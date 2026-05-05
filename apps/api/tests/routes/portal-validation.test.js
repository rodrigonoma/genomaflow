/**
 * Validação isolada das rotas /portal/*.
 */

const Fastify = require('fastify');
const route = require('../../src/routes/portal');

function buildApp({ role = 'admin', user_id = 'u1', tenant_id = 't1' } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('pg', { query: jest.fn().mockResolvedValue({ rows: [] }) });
  app.decorate('authenticate', async (req) => {
    req.user = { tenant_id, user_id, role, module: 'human' };
  });
  app.register(route, { prefix: '/portal' });
  return app;
}

describe('Tokens management', () => {
  test('POST sem subject_id nem owner_id → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/portal/tokens', payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject_id|owner_id/);
    await app.close();
  });

  test('POST com subject_id E owner_id → 400 (XOR)', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/portal/tokens',
      payload: { subject_id: 's1', owner_id: 'o1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/apenas um/);
    await app.close();
  });

  test('POST com role!=admin → 403', async () => {
    const app = buildApp({ role: 'doctor' }); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/portal/tokens',
      payload: { subject_id: 's1' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('GET tokens role!=admin → 403', async () => {
    const app = buildApp({ role: 'doctor' }); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/portal/tokens' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('DELETE token role!=admin → 403', async () => {
    const app = buildApp({ role: 'doctor' }); await app.ready();
    const res = await app.inject({
      method: 'DELETE', url: '/portal/tokens/xyz',
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('Public token endpoints', () => {
  test('GET /portal/:token formato inválido → 404', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/portal/notvalid' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  test('GET /portal/:token (32 hex) inexistente → 404', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/portal/' + 'a'.repeat(32) });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  test('GET /portal/:token/agenda inexistente → 404', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/portal/' + 'a'.repeat(32) + '/agenda' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
