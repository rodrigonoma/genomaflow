'use strict';

const { describe, test, expect } = require('@jest/globals');
const Fastify = require('fastify');

// Stub withTenant: passa fn(pg) direto pra queries serem capturadas pelo mock de pg
jest.mock('../../src/db/tenant', () => ({
  withTenant: jest.fn(async (pg, _tid, fn) => fn(pg)),
}));

async function buildApp(role = 'admin', module = 'estetica') {
  const app = Fastify({ logger: false });
  const queries = [];
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module };
  });
  app.decorate('pg', {
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/INSERT INTO aesthetic_consent/i.test(sql)) {
        return { rows: [{ id: 'c1', created_at: new Date().toISOString() }], rowCount: 1 };
      }
      if (/SELECT .* FROM aesthetic_consent/i.test(sql)) {
        return { rows: params[0] === 'subject-yes'
          ? [{ id: 'c1', created_at: '2026-05-11T10:00:00Z', reinforced_regions: [] }]
          : [] };
      }
      return { rows: [], rowCount: 0 };
    }),
  });
  // Stub withTenant via decorate (alguns endpoints chamam)
  app._queries = queries;
  app.register(require('../../src/routes/aesthetic-consent'), { prefix: '/api/aesthetic' });
  return app;
}

describe('POST /aesthetic/consent', () => {
  test('cria consent e retorna 201', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/consent',
      payload: { subject_id: 'sub1', notes: 'paciente concordou em pessoa' },
      headers: { 'user-agent': 'test-agent' },
      remoteAddress: '10.0.0.1',
    });
    expect(res.statusCode).toBe(201);
    const insert = app._queries.find(q => /INSERT INTO aesthetic_consent/i.test(q.sql));
    expect(insert).toBeDefined();
    expect(insert.params).toContain('sub1');
  });

  test('bloqueia 403 pra módulo human', async () => {
    const app = await buildApp('admin', 'human');
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/consent',
      payload: { subject_id: 'sub1' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('400 se subject_id faltando', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/consent',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  test('aceita reinforced_regions array', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/consent',
      payload: { subject_id: 'sub1', reinforced_regions: ['breast', 'glutes'] },
    });
    expect(res.statusCode).toBe(201);
    const insert = app._queries.find(q => /INSERT INTO aesthetic_consent/i.test(q.sql));
    expect(insert.params.some(p => Array.isArray(p) && p.includes('breast'))).toBe(true);
  });
});

describe('GET /aesthetic/consent/:subject_id', () => {
  test('retorna 200 com confirmed:true se consent existe', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/consent/subject-yes',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ confirmed: true });
  });

  test('retorna 200 com confirmed:false se não existe', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/consent/subject-no',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ confirmed: false });
  });
});
