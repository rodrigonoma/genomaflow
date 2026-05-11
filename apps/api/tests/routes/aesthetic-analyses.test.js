'use strict';

const { describe, test, expect } = require('@jest/globals');
const Fastify = require('fastify');

jest.mock('../../src/queues/aesthetic-analysis-queue', () => ({
  enqueue: jest.fn(async () => 'job-123'),
}));

async function buildApp({ balance = 100, hasConsent = true, photosOk = true, role = 'admin', module = 'estetica' } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module, professional_type: 'medico' };
  });
  const queries = [];
  app.decorate('pg', {
    connect: jest.fn(async () => app.pg),
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/COALESCE\(SUM\(amount\)/i.test(sql)) return { rows: [{ balance: String(balance) }] };
      if (/SELECT .* FROM aesthetic_consent/i.test(sql)) return { rows: hasConsent ? [{ id: 'c1' }] : [] };
      if (/SELECT id FROM aesthetic_photos/i.test(sql)) {
        if (!photosOk) return { rows: [] };
        return { rows: params[0].map((id) => ({ id })) };
      }
      if (/INSERT INTO aesthetic_analyses/i.test(sql)) return { rows: [{ id: 'a-new' }] };
      if (/INSERT INTO credit_ledger/i.test(sql)) return { rows: [{ id: 'cl1' }] };
      return { rows: [] };
    }),
    release: jest.fn(),
  });
  app._queries = queries;
  app.register(require('../../src/routes/aesthetic-analyses'), { prefix: '/api/aesthetic' });
  return app;
}

describe('POST /aesthetic/analyses', () => {
  test('cria análise + enqueue + debita créditos', async () => {
    const app = await buildApp();
    const { enqueue } = require('../../src/queues/aesthetic-analysis-queue');
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1','p2'] },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({ analysis_id: 'a-new', status: 'pending' });
    expect(enqueue).toHaveBeenCalled();
    const debitCall = app._queries.find(q => /INSERT INTO credit_ledger/.test(q.sql));
    expect(debitCall.params[1]).toBe(-5);
  });

  test('402 sem créditos suficientes', async () => {
    const app = await buildApp({ balance: 2 });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1'] },
    });
    expect(res.statusCode).toBe(402);
    expect(JSON.parse(res.body).error).toBe('INSUFFICIENT_CREDITS');
  });

  test('403 sem consent', async () => {
    const app = await buildApp({ hasConsent: false });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1'] },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('CONSENT_MISSING');
  });

  test('400 photo_ids vazio', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 photos_ids > 3', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1','p2','p3','p4'] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 analysis_type inválido', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'invalid', subject_id: 'sub1', photo_ids: ['p1'] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 photo_id não pertence ao tenant', async () => {
    const app = await buildApp({ photosOk: false });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['stranger-photo'] },
    });
    expect(res.statusCode).toBe(400);
  });
});
