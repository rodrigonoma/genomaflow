/**
 * Validação isolada das rotas /vaccines (Fastify isolado, sem DB).
 * Modelo: tests/routes/encounters-validation.test.js.
 */

const Fastify = require('fastify');
const vaccinesRoute = require('../../src/routes/vaccines');

function buildApp({ role = 'admin', user_id = 'u1', tenant_id = 't1' } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('pg', { query: jest.fn().mockResolvedValue({ rows: [] }) });
  app.decorate('authenticate', async (req) => {
    req.user = { tenant_id, user_id, role, module: 'veterinary' };
  });
  app.register(vaccinesRoute, { prefix: '/vaccines' });
  return app;
}

describe('POST /vaccines — validation', () => {
  test('sem subject_id → 400', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/vaccines', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject_id/);
    await app.close();
  });

  test('sem vaccine_name → 400', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/vaccines',
      payload: { subject_id: 's1', applied_at: '2026-05-05' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/vaccine_name/);
    await app.close();
  });

  test('sem applied_at → 400', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/vaccines',
      payload: { subject_id: 's1', vaccine_name: 'V8' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/applied_at/);
    await app.close();
  });

  test('applied_at formato inválido → 400', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/vaccines',
      payload: { subject_id: 's1', vaccine_name: 'V8', applied_at: '05/05/2026' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/applied_at/);
    await app.close();
  });

  test('next_dose_date formato inválido → 400', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/vaccines',
      payload: {
        subject_id: 's1', vaccine_name: 'V8', applied_at: '2026-05-05',
        next_dose_date: 'invalid'
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/next_dose_date/);
    await app.close();
  });

  test('attachments com 11 itens → 400', async () => {
    const app = buildApp();
    await app.ready();
    const att = Array(11).fill({ filename: 'x', s3_key: 'k' });
    const res = await app.inject({
      method: 'POST', url: '/vaccines',
      payload: { subject_id: 's1', vaccine_name: 'V8', applied_at: '2026-05-05', attachments: att },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/máximo 10/);
    await app.close();
  });
});

describe('GET /vaccines — validation', () => {
  test('sem subject_id → 400', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/vaccines' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject_id/);
    await app.close();
  });
});

describe('Protocols ACL', () => {
  test('POST /vaccines/protocols com role!=admin → 403', async () => {
    const app = buildApp({ role: 'doctor' });
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/vaccines/protocols',
      payload: { species: 'dog', name: 'V8', doses: [] },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('POST /vaccines/protocols com species inválido → 400', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/vaccines/protocols',
      payload: { species: 'dragon', name: 'X' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/species/);
    await app.close();
  });
});
