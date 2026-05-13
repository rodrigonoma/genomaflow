'use strict';

const { describe, test, expect } = require('@jest/globals');
const Fastify = require('fastify');

// Stub withTenant: passa fn(pg) direto pra queries serem capturadas pelo mock
jest.mock('../../src/db/tenant', () => ({
  withTenant: jest.fn(async (pg, _tid, fn) => fn(pg)),
}));

async function buildApp(role = 'admin', moduleName = 'estetica') {
  const app = Fastify({ logger: false });
  const queries = [];
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module: moduleName };
  });
  app.decorate('pg', {
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/INSERT INTO aesthetic_sessions/i.test(sql)) {
        return {
          rows: [{
            id: 'sess-1',
            tenant_id: 't1',
            subject_id: params[1],
            user_id: params[2],
            session_date: '2026-05-12T10:00:00Z',
            session_type: params[3],
            notes: params[4],
            created_at: '2026-05-12T10:00:00Z',
          }],
        };
      }
      if (/SELECT [\s\S]* FROM aesthetic_sessions/i.test(sql) && /WHERE id = \$1/.test(sql)) {
        // getById
        if (params[0] === 'sess-existing') {
          return { rows: [{
            id: 'sess-existing', tenant_id: 't1', subject_id: 's1',
            session_type: 'facial_analysis', session_date: 'now',
          }] };
        }
        return { rows: [] };
      }
      if (/SELECT [\s\S]* FROM aesthetic_sessions/i.test(sql)) {
        // list
        return { rows: [
          { id: 'sess-1', session_date: '2026-05-12T10:00:00Z', session_type: 'facial_analysis' },
          { id: 'sess-2', session_date: '2026-05-11T10:00:00Z', session_type: 'body_analysis' },
        ] };
      }
      return { rows: [] };
    }),
  });
  app._queries = queries;
  app.register(require('../../src/routes/aesthetic-sessions'), { prefix: '/api/aesthetic' });
  return app;
}

// ---------------------------------------------------------------------------
// POST /aesthetic/sessions
// ---------------------------------------------------------------------------

describe('POST /aesthetic/sessions', () => {
  test('cria session facial_analysis → 201', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/sessions',
      payload: { subject_id: 's1', session_type: 'facial_analysis', notes: 'primeira' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe('sess-1');
    expect(body.session_type).toBe('facial_analysis');
    const insert = app._queries.find(q => /INSERT INTO aesthetic_sessions/i.test(q.sql));
    expect(insert).toBeDefined();
    expect(insert.params).toEqual(['t1', 's1', 'u1', 'facial_analysis', 'primeira']);
  });

  test('cria session body_analysis → 201', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/sessions',
      payload: { subject_id: 's1', session_type: 'body_analysis' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().session_type).toBe('body_analysis');
  });

  test('400 sem subject_id', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/sessions',
      payload: { session_type: 'facial_analysis' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject_id/);
  });

  test('400 sem session_type', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/sessions',
      payload: { subject_id: 's1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/session_type/);
  });

  test('400 session_type inválido (INVALID_SESSION_TYPE)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/sessions',
      payload: { subject_id: 's1', session_type: 'invalid_xyz' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_SESSION_TYPE');
  });

  test('403 módulo human', async () => {
    const app = await buildApp('admin', 'human');
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/sessions',
      payload: { subject_id: 's1', session_type: 'facial_analysis' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('403 módulo veterinary', async () => {
    const app = await buildApp('admin', 'veterinary');
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/sessions',
      payload: { subject_id: 's1', session_type: 'facial_analysis' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('master role acessa mesmo sem módulo estetica', async () => {
    const app = await buildApp('master', 'human');
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/sessions',
      payload: { subject_id: 's1', session_type: 'facial_analysis' },
    });
    expect(res.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// GET /aesthetic/sessions
// ---------------------------------------------------------------------------

describe('GET /aesthetic/sessions', () => {
  test('lista sessions de subject → 200', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/sessions?subject_id=s1',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
  });

  test('400 sem subject_id', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/sessions',
    });
    expect(res.statusCode).toBe(400);
  });

  test('limit é clampado em 100', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/sessions?subject_id=s1&limit=999',
    });
    expect(res.statusCode).toBe(200);
    const q = app._queries.find(qq => /FROM aesthetic_sessions/i.test(qq.sql) && /LIMIT/.test(qq.sql));
    expect(q.params[2]).toBe(100);
  });

  test('403 módulo human', async () => {
    const app = await buildApp('admin', 'human');
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/sessions?subject_id=s1',
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /aesthetic/sessions/:id
// ---------------------------------------------------------------------------

describe('GET /aesthetic/sessions/:id', () => {
  test('retorna session existente → 200', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/sessions/sess-existing',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('sess-existing');
  });

  test('404 quando não encontrada', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/sessions/nao-existe',
    });
    expect(res.statusCode).toBe(404);
  });

  test('403 módulo human', async () => {
    const app = await buildApp('admin', 'human');
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/sessions/sess-existing',
    });
    expect(res.statusCode).toBe(403);
  });
});
