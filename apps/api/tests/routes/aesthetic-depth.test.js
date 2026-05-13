'use strict';

const { describe, test, expect } = require('@jest/globals');
const Fastify = require('fastify');

jest.mock('../../src/queues/aesthetic-depth-queue', () => ({
  enqueue: jest.fn(async () => ({ id: 'job-d-1' })),
}));

jest.mock('../../src/services/aesthetic-s3', () => ({
  signedUrlFor: jest.fn(async ({ key }) => `https://s3.example/${key}?signed=1`),
}));

jest.mock('../../src/db/tenant', () => ({
  withTenant: jest.fn(async (pg, _t, fn) => fn(pg)),
}));

async function buildApp({
  role = 'admin', moduleName = 'estetica',
  analysisStatus = 'done', analysisTier = 'advanced',
  existingDepth = null,
} = {}) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module: moduleName };
  });
  const queries = [];
  app.decorate('pg', {
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      // getDetail analyses
      if (/SELECT \* FROM aesthetic_analyses/i.test(sql)) {
        if (params[0] === 'not-found') return { rows: [] };
        return { rows: [{
          id: params[0], tenant_id: 't1', subject_id: 's1',
          status: analysisStatus, tier: analysisTier,
        }] };
      }
      // getByAnalysisId depth (mais recente)
      if (/SELECT [\s\S]* FROM aesthetic_depth_models/i.test(sql) && /ORDER BY created_at DESC/.test(sql)) {
        return { rows: existingDepth ? [existingDepth] : [] };
      }
      // createPending depth
      if (/INSERT INTO aesthetic_depth_models/i.test(sql)) {
        return { rows: [{
          id: 'd-new', analysis_id: params[1], status: 'pending', model_type: params[2],
          created_at: '2026-05-13T00:00:00Z',
        }] };
      }
      return { rows: [] };
    }),
  });
  app._queries = queries;
  app.register(require('../../src/routes/aesthetic-depth'), { prefix: '/api/aesthetic' });
  return app;
}

// ---------------------------------------------------------------------------
// POST /aesthetic/analyses/:id/depth
// ---------------------------------------------------------------------------

describe('POST /aesthetic/analyses/:id/depth', () => {
  test('happy path advanced → 202 + status pending + enqueue chamado', async () => {
    const app = await buildApp();
    const { enqueue } = require('../../src/queues/aesthetic-depth-queue');
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/depth',
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe('pending');
    expect(body.model_type).toBe('heightmap');
    expect(enqueue).toHaveBeenCalled();
  });

  test('404 análise inexistente', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/not-found/depth',
    });
    expect(res.statusCode).toBe(404);
  });

  test('400 TIER_NOT_ADVANCED em análise standard', async () => {
    const app = await buildApp({ analysisTier: 'standard' });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/depth',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('TIER_NOT_ADVANCED');
  });

  test('400 ANALYSIS_NOT_DONE em análise pending', async () => {
    const app = await buildApp({ analysisStatus: 'pending' });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/depth',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ANALYSIS_NOT_DONE');
  });

  test('idempotente: depth done existente → retorna direto sem enfileirar', async () => {
    const app = await buildApp({
      existingDepth: {
        id: 'd-existing', analysis_id: 'a-1', status: 'done',
        model_type: 'heightmap',
        s3_key_depth: 'aesthetic-depth/t1/a1.png',
        s3_key_texture: 'aesthetic-photos/t1/a1/frontal.jpg',
        metadata: { processing_ms: 4500 },
        created_at: '2026-05-13T00:00:00Z',
        completed_at: '2026-05-13T00:01:00Z',
      },
    });
    const { enqueue } = require('../../src/queues/aesthetic-depth-queue');
    enqueue.mockClear();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/depth',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('done');
    expect(body.depth_url).toContain('aesthetic-depth/t1/a1.png');
    expect(body.texture_url).toContain('frontal.jpg');
    expect(enqueue).not.toHaveBeenCalled();
  });

  test('idempotente: depth pending existente → retorna 200 sem novo enqueue', async () => {
    const app = await buildApp({
      existingDepth: {
        id: 'd-pending', analysis_id: 'a-1', status: 'pending',
        model_type: 'heightmap',
        created_at: '2026-05-13T00:00:00Z',
      },
    });
    const { enqueue } = require('../../src/queues/aesthetic-depth-queue');
    enqueue.mockClear();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/depth',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pending');
    expect(enqueue).not.toHaveBeenCalled();
  });

  test('depth com status=error → cria novo (não é idempotente em erro)', async () => {
    const app = await buildApp({
      existingDepth: {
        id: 'd-old', analysis_id: 'a-1', status: 'error',
        model_type: 'heightmap',
        error_code: 'ONNX_FAIL',
        created_at: '2026-05-13T00:00:00Z',
      },
    });
    const { enqueue } = require('../../src/queues/aesthetic-depth-queue');
    enqueue.mockClear();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/depth',
    });
    expect(res.statusCode).toBe(202);
    expect(enqueue).toHaveBeenCalled();
  });

  test('403 módulo human', async () => {
    const app = await buildApp({ moduleName: 'human' });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/depth',
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /aesthetic/analyses/:id/depth
// ---------------------------------------------------------------------------

describe('GET /aesthetic/analyses/:id/depth', () => {
  test('retorna 200 com depth_url quando done', async () => {
    const app = await buildApp({
      existingDepth: {
        id: 'd1', analysis_id: 'a-1', status: 'done',
        model_type: 'heightmap',
        s3_key_depth: 'aesthetic-depth/t1/a1.png',
        s3_key_texture: 'aesthetic-photos/t1/a1/frontal.jpg',
        metadata: { processing_ms: 4500 },
        created_at: 'x', completed_at: 'y',
      },
    });
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/analyses/a-1/depth',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('done');
    expect(body.depth_url).toBeDefined();
    expect(body.texture_url).toBeDefined();
    expect(body.metadata.processing_ms).toBe(4500);
  });

  test('404 quando depth não foi gerado', async () => {
    const app = await buildApp({ existingDepth: null });
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/analyses/a-1/depth',
    });
    expect(res.statusCode).toBe(404);
  });

  test('retorna error_code quando status=error', async () => {
    const app = await buildApp({
      existingDepth: {
        id: 'd1', analysis_id: 'a-1', status: 'error',
        model_type: 'heightmap',
        error_code: 'ONNX_FAIL',
        error_message: 'inference timeout',
        created_at: 'x', completed_at: 'y',
      },
    });
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/analyses/a-1/depth',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('error');
    expect(body.error_code).toBe('ONNX_FAIL');
  });
});
