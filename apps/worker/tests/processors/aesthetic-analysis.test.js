'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');

jest.mock('../../src/agents/aesthetic-facial', () => ({
  analyzeFacial: jest.fn(),
}));
jest.mock('../../src/agents/aesthetic-recommender', () => ({
  recommendProtocol: jest.fn(),
}));
jest.mock('../../src/storage/s3', () => ({
  downloadFile: jest.fn(async () => Buffer.from('fake-jpg-bytes')),
}));

const { processAestheticAnalysis } = require('../../src/processors/aesthetic-analysis');

function mockPool(queries = []) {
  return {
    connect: jest.fn(async () => ({
      query: jest.fn(async (sql, params) => {
        queries.push({ sql, params });
        if (/SELECT .* FROM aesthetic_photos/i.test(sql)) {
          return { rows: params[0].map((id) => ({ id, s3_key: `aesthetic-photos/t/s/${id}.jpg` })) };
        }
        if (/UPDATE aesthetic_analyses SET status/i.test(sql)) {
          return { rowCount: 1 };
        }
        if (/SELECT \* FROM aesthetic_analyses/i.test(sql)) {
          return { rows: [{ id: params[0], analysis_type: 'facial', photo_ids: ['p1'], status: 'pending' }] };
        }
        if (/SELECT .* FROM subjects/i.test(sql)) {
          return { rows: [{ id: 'sub1', fitzpatrick_type: 3, skin_concerns: [], sex: 'F', birth_date: '1990-01-01' }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    })),
    query: jest.fn(async () => ({ rows: [] })),
  };
}

describe('processAestheticAnalysis', () => {
  beforeEach(() => jest.clearAllMocks());

  test('flow básico: status processing → done', async () => {
    const { analyzeFacial } = require('../../src/agents/aesthetic-facial');
    const { recommendProtocol } = require('../../src/agents/aesthetic-recommender');
    analyzeFacial.mockResolvedValue({
      metrics: { rugas: { score: 72, regions: [] } },
      observations: { qualitative: 'ok' },
      tokens_input: 1000, tokens_output: 500,
    });
    recommendProtocol.mockResolvedValue({
      recommendations: { treatment_protocol: [], lifestyle_recommendations: {} },
      tokens_input: 500, tokens_output: 300,
    });

    const queries = [];
    const pool = mockPool(queries);
    await processAestheticAnalysis({
      pool,
      data: { analysis_id: 'a1', tenant_id: 't1', subject_id: 'sub1', user_id: 'u1',
              analysis_type: 'facial', photo_ids: ['p1'], professional_type: 'medico' },
    });

    const statusUpdates = queries.filter(q => /UPDATE aesthetic_analyses SET status/i.test(q.sql));
    expect(statusUpdates.length).toBeGreaterThanOrEqual(2); // processing → done
    expect(statusUpdates[statusUpdates.length - 1].params).toContain('done');
  });

  test('erro NO_FACE_DETECTED dispara refund', async () => {
    const { analyzeFacial } = require('../../src/agents/aesthetic-facial');

    analyzeFacial.mockRejectedValue(Object.assign(new Error('No face'), { code: 'NO_FACE_DETECTED' }));

    const queries = [];
    const pool = mockPool(queries);
    await processAestheticAnalysis({
      pool,
      data: { analysis_id: 'a1', tenant_id: 't1', subject_id: 'sub1', user_id: 'u1',
              analysis_type: 'facial', photo_ids: ['p1'], professional_type: 'medico' },
    });

    const errorUpdates = queries.filter(q => /status = 'error'/i.test(q.sql));
    expect(errorUpdates.length).toBeGreaterThanOrEqual(1);
  });
});
