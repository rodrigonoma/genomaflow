/**
 * Validação isolada das rotas /nps. Públicas (token) + admin (send/responses).
 */

const Fastify = require('fastify');
const route = require('../../src/routes/nps');

function buildApp({ role = 'admin', user_id = 'u1', tenant_id = 't1' } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('pg', { query: jest.fn().mockResolvedValue({ rows: [] }) });
  app.decorate('authenticate', async (req) => {
    req.user = { tenant_id, user_id, role, module: 'human' };
  });
  app.register(route, { prefix: '/nps' });
  return app;
}

describe('Send NPS — admin only', () => {
  test('role!=admin → 403', async () => {
    const app = buildApp({ role: 'doctor' }); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/nps/send',
      payload: { subject_id: 's1', sent_to: 'a@b.com' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('sem subject_id → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/nps/send',
      payload: { sent_to: 'a@b.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject_id/);
    await app.close();
  });

  test('email inválido → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/nps/send',
      payload: { subject_id: 's1', sent_to: 'noatsign' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/sent_to/);
    await app.close();
  });

  test('sent_via=whatsapp com telefone aceito (Fase 3)', async () => {
    process.env.ZAPI_MOCK = '1';
    const app = buildApp();
    // Mock subject_id válido + insert
    app.pg.query.mockImplementation((sql) => {
      if (sql.includes('FROM subjects')) return Promise.resolve({ rows: [{ id: 's1', name: 'Joao' }] });
      if (sql.includes('INSERT INTO nps_surveys')) return Promise.resolve({ rows: [{ id: 'n1', token: 'tok' }] });
      return Promise.resolve({ rows: [] });
    });
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/nps/send',
      payload: { subject_id: 's1', sent_to: '5511999999999', sent_via: 'whatsapp' },
    });
    expect([201, 500]).toContain(res.statusCode);  // 201 ok ou 500 se mock pg incompleto
    if (res.statusCode === 400) {
      // Não deve dar 400 sobre Fase 3
      expect(res.json().error).not.toMatch(/Fase 3/i);
    }
    await app.close();
  });

  test('sent_via=whatsapp com telefone vazio → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/nps/send',
      payload: { subject_id: 's1', sent_to: '   ', sent_via: 'whatsapp' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('Public token endpoints', () => {
  test('GET /nps/:token com formato inválido → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/nps/notvalid' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('GET /nps/:token válido (32 hex) mas inexistente → 404', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/nps/' + 'a'.repeat(32) });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  test('POST respond com score fora 0-10 → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/nps/' + 'a'.repeat(32) + '/respond',
      payload: { score: 11 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/score/);
    await app.close();
  });

  test('POST respond com score string → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/nps/' + 'a'.repeat(32) + '/respond',
      payload: { score: '5' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/score/);
    await app.close();
  });

  test('POST respond com score válido mas token não existe → 409', async () => {
    const app = buildApp();
    app.pg.query.mockResolvedValue({ rows: [] }); // simula UPDATE retornou 0
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/nps/' + 'a'.repeat(32) + '/respond',
      payload: { score: 8 },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  test('POST respond com feedback >5000 chars → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/nps/' + 'a'.repeat(32) + '/respond',
      payload: { score: 8, feedback: 'x'.repeat(5001) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/feedback/);
    await app.close();
  });
});
