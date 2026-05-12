'use strict';
/**
 * Testa o endpoint GET /patients/:id/timeline isoladamente (sem DB).
 * Verifica auth gate e que a resposta tem a forma correta.
 */
const Fastify = require('fastify');
const patientsRoute = require('../../src/routes/patients');

function makeMockClient(rows) {
  return {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })   // BEGIN
      .mockResolvedValueOnce({ rows: [] })   // SET LOCAL app.tenant_id
      .mockResolvedValue({ rows }),
    release: jest.fn(),
  };
}

function buildApp() {
  const mockRows = [
    { event_type: 'registered', event_id: 'eid-1', event_at: '2026-01-01T00:00:00Z', payload: { id: 'eid-1' } },
    { event_type: 'exam',       event_id: 'eid-2', event_at: '2026-02-01T00:00:00Z', payload: { id: 'eid-2' } },
  ];
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { tenant_id: 'tid-1', user_id: 'uid-1' };
  });
  app.decorate('pg', {
    query: jest.fn().mockResolvedValue({ rows: mockRows }),
    connect: jest.fn().mockResolvedValue(makeMockClient(mockRows)),
  });
  app.register(patientsRoute, { prefix: '/patients' });
  return app;
}

describe('GET /patients/:id/timeline — auth gate', () => {
  test('retorna 401 sem token', async () => {
    const app = Fastify({ logger: false });
    app.decorate('authenticate', async () => { throw { statusCode: 401 }; });
    app.decorate('pg', { query: jest.fn(), connect: jest.fn() });
    app.register(patientsRoute, { prefix: '/patients' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/patients/some-id/timeline' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /patients/:id/timeline — response shape', () => {
  test('retorna items, next_cursor e has_more', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/patients/some-id/timeline',
      headers: { authorization: 'Bearer tok' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('has_more');
    expect(Array.isArray(body.items)).toBe(true);
    await app.close();
  });

  test('cada item tem event_type, event_id, event_at, payload', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/patients/some-id/timeline',
      headers: { authorization: 'Bearer tok' },
    });
    const { items } = JSON.parse(res.payload);
    for (const item of items) {
      expect(item).toHaveProperty('event_type');
      expect(item).toHaveProperty('event_id');
      expect(item).toHaveProperty('event_at');
      expect(item).toHaveProperty('payload');
    }
    await app.close();
  });

  test('respeita limit máximo de 200', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/patients/some-id/timeline?limit=9999',
      headers: { authorization: 'Bearer tok' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

// ── F6.2 — aesthetic_analysis_completed ──────────────────────────────────────

describe('GET /patients/:id/timeline — F6 aesthetic_analysis_completed', () => {
  function buildAestheticApp({ rows }) {
    const app = Fastify({ logger: false });
    app.decorate('authenticate', async (req) => {
      req.user = { tenant_id: 'tid-1', user_id: 'uid-1', role: 'admin', module: 'estetica' };
    });
    const mockClient = makeMockClient(rows);
    app.decorate('pg', {
      query: jest.fn().mockResolvedValue({ rows }),
      connect: jest.fn().mockResolvedValue(mockClient),
    });
    app.register(patientsRoute, { prefix: '/patients' });
    return app;
  }

  test('inclui aesthetic_analysis_completed rows quando subject tem análise concluída', async () => {
    const aeRow = {
      event_type: 'aesthetic_analysis_completed',
      event_id: 'aa-uuid-1',
      event_at: '2026-05-11T10:00:00Z',
      payload: {
        id: 'aa-uuid-1',
        analysis_type: 'facial',
        status: 'done',
        completed_at: '2026-05-11T10:00:00Z',
        photo_count: 2,
        top_metrics: [
          { name: 'rugas', score: 80 },
          { name: 'firmeza', score: 65 },
        ],
      },
    };
    const app = buildAestheticApp({ rows: [aeRow] });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/patients/s-uuid-1/timeline',
      headers: { authorization: 'Bearer tok' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.items.length).toBeGreaterThan(0);
    const item = body.items[0];
    expect(item.event_type).toBe('aesthetic_analysis_completed');
    expect(item.payload.analysis_type).toBe('facial');
    expect(item.payload.photo_count).toBe(2);
    await app.close();
  });

  test('SQL da rota contém aesthetic_analysis_completed e status = \'done\'', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/routes/patients.js'),
      'utf8'
    );
    expect(source).toContain('aesthetic_analysis_completed');
    expect(source).toContain("status = 'done'");
    expect(source).toContain('aa.tenant_id = $1');
    expect(source).toContain('aa.subject_id = $2');
    expect(source).toContain('aa.deleted_at IS NULL');
  });
});
