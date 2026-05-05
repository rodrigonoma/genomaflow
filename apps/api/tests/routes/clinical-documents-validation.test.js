/**
 * Validação isolada das rotas /clinical-documents.
 */

const Fastify = require('fastify');
const route = require('../../src/routes/clinical-documents');

function buildApp({ role = 'admin', user_id = 'u1', tenant_id = 't1' } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('pg', { query: jest.fn().mockResolvedValue({ rows: [] }) });
  app.decorate('authenticate', async (req) => {
    req.user = { tenant_id, user_id, role, module: 'human' };
  });
  app.register(route, { prefix: '/clinical-documents' });
  return app;
}

describe('Documents validation', () => {
  test('POST sem subject_id → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/clinical-documents',
      payload: { doc_type: 'atestado', title: 'T', body: 'B' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject_id/);
    await app.close();
  });

  test('POST com doc_type inválido → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/clinical-documents',
      payload: { subject_id: 's1', doc_type: 'banana', title: 'T', body: 'B' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/doc_type/);
    await app.close();
  });

  test('POST sem title → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/clinical-documents',
      payload: { subject_id: 's1', doc_type: 'atestado', body: 'B' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/title/);
    await app.close();
  });

  test('GET sem subject_id → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/clinical-documents' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject_id/);
    await app.close();
  });

  test('upload-pdf com s3_key fora do prefixo → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/clinical-documents/some-id/upload-pdf',
      payload: { s3_key: 'random/path/file.pdf' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/s3_key/);
    await app.close();
  });
});

describe('Templates ACL', () => {
  test('POST template com role!=admin → 403', async () => {
    const app = buildApp({ role: 'doctor' }); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/clinical-documents/templates',
      payload: { doc_type: 'atestado', name: 'T', body: 'B' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('POST template com doc_type inválido → 400', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/clinical-documents/templates',
      payload: { doc_type: 'banana', name: 'T', body: 'B' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/doc_type/);
    await app.close();
  });
});
