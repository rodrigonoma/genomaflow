/**
 * Validação isolada das rotas /notifications.
 */

const Fastify = require('fastify');
const route = require('../../src/routes/notifications');

function buildApp({ role = 'admin', user_id = 'u1', tenant_id = 't1' } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('pg', { query: jest.fn().mockResolvedValue({ rows: [] }) });
  app.decorate('authenticate', async (req) => {
    req.user = { tenant_id, user_id, role, module: 'human' };
  });
  app.register(route, { prefix: '/notifications' });
  return app;
}

describe('Preferences', () => {
  test('GET retorna defaults se não existe', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/notifications/preferences' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.is_default).toBe(true);
    expect(body.reminder_hours_before).toEqual([24, 2]);
    expect(body.reminder_via).toBe('whatsapp');
    await app.close();
  });

  test('PUT role!=admin → 403', async () => {
    const app = buildApp({ role: 'doctor' }); await app.ready();
    const res = await app.inject({
      method: 'PUT', url: '/notifications/preferences',
      payload: { reminder_via: 'email' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('PUT reminder_via inválido → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'PUT', url: '/notifications/preferences',
      payload: { reminder_via: 'pigeon' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/reminder_via/);
    await app.close();
  });

  test('PUT reminder_hours_before fora do range → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'PUT', url: '/notifications/preferences',
      payload: { reminder_hours_before: [200] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/reminder_hours_before/);
    await app.close();
  });

  test('PUT send_window_start formato inválido → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'PUT', url: '/notifications/preferences',
      payload: { send_window_start: '8am' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('PUT nps_via inválido → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'PUT', url: '/notifications/preferences',
      payload: { nps_via: 'sms' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('Inbound webhook', () => {
  test('signature inválida → 401', async () => {
    delete process.env.ZAPI_MOCK;
    process.env.ZAPI_CLIENT_TOKEN = 'real-token';
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/notifications/whatsapp/inbound',
      headers: { 'x-token': 'wrong' },
      payload: { phone: '5511999999999', message: { text: '1' } },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  test('em mock mode aceita', async () => {
    process.env.ZAPI_MOCK = '1';
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/notifications/whatsapp/inbound',
      payload: { phone: '5511999999999', message: { text: '1' } },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  test('mensagem vazia → ok skipped', async () => {
    process.env.ZAPI_MOCK = '1';
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/notifications/whatsapp/inbound',
      payload: { phone: '5511999999999', message: { text: '' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().skipped).toBe(true);
    await app.close();
  });

  test('fromMe=true → skipped', async () => {
    process.env.ZAPI_MOCK = '1';
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/notifications/whatsapp/inbound',
      payload: { phone: '5511999999999', message: { text: '1' }, fromMe: true },
    });
    expect(res.json().skipped).toBe(true);
    await app.close();
  });
});

describe('Status endpoint', () => {
  test('whatsapp/status retorna mock + configured', async () => {
    process.env.ZAPI_MOCK = '1';
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'GET', url: '/notifications/whatsapp/status',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('mock');
    expect(body).toHaveProperty('configured');
    await app.close();
  });

  test('whatsapp/status role!=admin → 403', async () => {
    const app = buildApp({ role: 'doctor' }); await app.ready();
    const res = await app.inject({
      method: 'GET', url: '/notifications/whatsapp/status',
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
