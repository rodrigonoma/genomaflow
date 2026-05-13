'use strict';

const { describe, test, expect } = require('@jest/globals');

jest.mock('../../src/db/tenant', () => ({
  withTenant: jest.fn(async (pg, _tenantId, fn) => fn(pg)),
}));

const {
  getByAnalysisId,
  createPending,
  markProcessing,
  markDone,
  markError,
  VALID_MODEL_TYPES,
} = require('../../src/services/aesthetic-depth-models');

function makePg(queryResult) {
  return { query: jest.fn().mockResolvedValueOnce({ rows: queryResult || [], rowCount: queryResult?.length || 0 }) };
}

describe('VALID_MODEL_TYPES whitelist', () => {
  test('aceita heightmap e multiview_fusion', () => {
    expect([...VALID_MODEL_TYPES].sort()).toEqual(['heightmap', 'multiview_fusion']);
  });
});

describe('getByAnalysisId', () => {
  test('retorna row mais recente por analysis_id', async () => {
    const pg = makePg([{ id: 'd1', analysis_id: 'a1', status: 'done' }]);
    const r = await getByAnalysisId(pg, { tenantId: 't1', analysisId: 'a1' });
    expect(r.id).toBe('d1');
    expect(pg.query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC/);
    expect(pg.query.mock.calls[0][0]).toMatch(/LIMIT 1/);
  });

  test('retorna null quando vazio', async () => {
    const pg = makePg([]);
    expect(await getByAnalysisId(pg, { tenantId: 't1', analysisId: 'nope' })).toBeNull();
  });
});

describe('createPending', () => {
  test('INSERT com status pending + modelType default heightmap', async () => {
    const pg = makePg([{ id: 'd1', analysis_id: 'a1', status: 'pending', model_type: 'heightmap' }]);
    const r = await createPending(pg, { tenantId: 't1', analysisId: 'a1', userId: 'u1' });
    expect(r.status).toBe('pending');
    expect(r.model_type).toBe('heightmap');
    expect(pg.query.mock.calls[0][1]).toEqual(['t1', 'a1', 'heightmap']);
  });

  test('rejeita modelType inválido com status 400', async () => {
    await expect(createPending({}, {
      tenantId: 't1', analysisId: 'a1', userId: 'u1', modelType: 'invalid',
    })).rejects.toMatchObject({ message: 'INVALID_MODEL_TYPE', status: 400 });
  });

  test('aceita multiview_fusion explicit', async () => {
    const pg = makePg([{ id: 'd1', model_type: 'multiview_fusion' }]);
    await createPending(pg, {
      tenantId: 't1', analysisId: 'a1', userId: 'u1', modelType: 'multiview_fusion',
    });
    expect(pg.query.mock.calls[0][1][2]).toBe('multiview_fusion');
  });
});

describe('markProcessing', () => {
  test('UPDATE status processing', async () => {
    const pg = makePg([]);
    await markProcessing(pg, 'd1');
    expect(pg.query.mock.calls[0][0]).toMatch(/SET status = 'processing'/);
    expect(pg.query.mock.calls[0][1]).toEqual(['d1']);
  });
});

describe('markDone', () => {
  test('UPDATE com keys S3 + metadata JSON', async () => {
    const pg = makePg([]);
    await markDone(pg, 'd1', {
      s3KeyDepth: 'aesthetic-depth/t1/a1.png',
      s3KeyTexture: 'aesthetic-photos/t1/a1/frontal.jpg',
      providerVersion: 'depth-anything-v2-small@1.0',
      metadata: { processing_ms: 4500, depth_resolution: '518x518' },
    });
    const params = pg.query.mock.calls[0][1];
    expect(params[0]).toBe('d1');
    expect(params[1]).toBe('aesthetic-depth/t1/a1.png');
    expect(params[2]).toBeNull(); // s3_key_glb (F3.1 não preenche)
    expect(params[3]).toBe('aesthetic-photos/t1/a1/frontal.jpg');
    expect(params[4]).toBe('depth-anything-v2-small@1.0');
    expect(JSON.parse(params[5])).toEqual({ processing_ms: 4500, depth_resolution: '518x518' });
  });

  test('metadata null quando não passado', async () => {
    const pg = makePg([]);
    await markDone(pg, 'd1', { s3KeyDepth: 'k' });
    expect(pg.query.mock.calls[0][1][5]).toBeNull();
  });
});

describe('markError', () => {
  test('UPDATE com error_code + message', async () => {
    const pg = makePg([]);
    await markError(pg, 'd1', { errorCode: 'ONNX_FAIL', errorMessage: 'inference timeout' });
    expect(pg.query.mock.calls[0][1]).toEqual(['d1', 'ONNX_FAIL', 'inference timeout']);
  });

  test('error_message truncada em 500 chars', async () => {
    const pg = makePg([]);
    const long = 'x'.repeat(1000);
    await markError(pg, 'd1', { errorCode: 'X', errorMessage: long });
    expect(pg.query.mock.calls[0][1][2].length).toBe(500);
  });

  test('fallback UNKNOWN quando errorCode ausente', async () => {
    const pg = makePg([]);
    await markError(pg, 'd1', { errorMessage: 'something' });
    expect(pg.query.mock.calls[0][1][1]).toBe('UNKNOWN');
  });
});
