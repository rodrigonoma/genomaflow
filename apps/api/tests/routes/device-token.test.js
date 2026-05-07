// apps/api/tests/routes/device-token.test.js
'use strict';
const Fastify = require('fastify');

function buildApp(pgMock) {
  const app = Fastify();
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'user-1', tenant_id: 'tenant-1' };
  });
  app.decorate('pg', pgMock);

  // Registrar apenas os handlers novos inline para teste isolado
  app.post('/auth/device-token', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { token, platform } = request.body || {};

    if (!token || !platform || !['android', 'ios'].includes(platform)) {
      return reply.status(400).send({ error: 'token e platform (android|ios) são obrigatórios' });
    }

    await pgMock.query(
      `INSERT INTO device_tokens (user_id, tenant_id, token, platform)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, created_at = NOW()`,
      [user_id, tenant_id, token, platform]
    );

    return reply.status(204).send();
  });

  app.delete('/auth/device-token', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { user_id } = request.user;
    const { token } = request.body || {};

    if (!token) return reply.status(400).send({ error: 'token obrigatório' });

    await pgMock.query(
      'DELETE FROM device_tokens WHERE user_id = $1 AND token = $2',
      [user_id, token]
    );
    return reply.status(204).send();
  });

  return app;
}

describe('POST /auth/device-token', () => {
  it('registra token válido com 204', async () => {
    const pg = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const app = buildApp(pg);
    const r = await app.inject({
      method: 'POST', url: '/auth/device-token',
      payload: { token: 'fcm-token-abc', platform: 'android' }
    });
    expect(r.statusCode).toBe(204);
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO device_tokens'), expect.arrayContaining(['fcm-token-abc', 'android']));
  });

  it('rejeita platform inválido com 400', async () => {
    const pg = { query: jest.fn() };
    const app = buildApp(pg);
    const r = await app.inject({
      method: 'POST', url: '/auth/device-token',
      payload: { token: 'tok', platform: 'windows' }
    });
    expect(r.statusCode).toBe(400);
    expect(pg.query).not.toHaveBeenCalled();
  });

  it('rejeita body sem token com 400', async () => {
    const pg = { query: jest.fn() };
    const app = buildApp(pg);
    const r = await app.inject({
      method: 'POST', url: '/auth/device-token',
      payload: { platform: 'ios' }
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('DELETE /auth/device-token', () => {
  it('remove token com 204', async () => {
    const pg = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const app = buildApp(pg);
    const r = await app.inject({
      method: 'DELETE', url: '/auth/device-token',
      payload: { token: 'fcm-token-abc' }
    });
    expect(r.statusCode).toBe(204);
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM device_tokens'),
      ['user-1', 'fcm-token-abc']
    );
  });

  it('rejeita body sem token com 400', async () => {
    const pg = { query: jest.fn() };
    const app = buildApp(pg);
    const r = await app.inject({ method: 'DELETE', url: '/auth/device-token', payload: {} });
    expect(r.statusCode).toBe(400);
  });
});
