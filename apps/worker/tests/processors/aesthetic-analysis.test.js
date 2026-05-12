'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');

jest.mock('../../src/agents/aesthetic-facial', () => ({
  analyzeFacial: jest.fn(),
}));
jest.mock('../../src/agents/aesthetic-body', () => ({
  analyzeBody: jest.fn(),
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

describe('processAestheticAnalysis — catalog fetch', () => {
  beforeEach(() => jest.clearAllMocks());

  test('processor busca catálogo do DB e passa availableTreatments para o recommender', async () => {
    const { analyzeFacial } = require('../../src/agents/aesthetic-facial');
    const { recommendProtocol } = require('../../src/agents/aesthetic-recommender');

    analyzeFacial.mockResolvedValue({
      metrics: { rugas: { score: 72, regions: [] } },
      observations: {},
      tokens_input: 1000, tokens_output: 500,
    });
    recommendProtocol.mockResolvedValue({
      recommendations: { treatment_protocol: [], lifestyle_recommendations: {} },
      tokens_input: 500, tokens_output: 300,
    });

    // Catalog rows que o DB retornará ao query de aesthetic_treatments
    const fakeCatalog = [
      { id: 'cat-001', name: 'Microagulhamento', category: 'skin', requires_medico: false },
      { id: 'cat-002', name: 'Botox', category: 'injectable', requires_medico: true },
    ];

    const pool = {
      connect: jest.fn(async () => ({
        query: jest.fn(async (sql, params) => {
          if (/SELECT .* FROM aesthetic_photos/i.test(sql)) {
            return { rows: params[0].map((id) => ({ id, s3_key: `aesthetic-photos/t/s/${id}.jpg` })) };
          }
          if (/SELECT .* FROM subjects/i.test(sql)) {
            return { rows: [{ id: 'sub1', fitzpatrick_type: 3, sex: 'F', birth_date: '1990-01-01' }] };
          }
          if (/FROM aesthetic_treatments/i.test(sql)) {
            return { rows: fakeCatalog };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      })),
    };

    await processAestheticAnalysis({
      pool,
      data: { analysis_id: 'a1', tenant_id: 't1', subject_id: 'sub1', user_id: 'u1',
              analysis_type: 'facial', photo_ids: ['p1'], professional_type: 'medico' },
    });

    // Recommender deve ter recebido availableTreatments com as 2 linhas do catálogo
    expect(recommendProtocol).toHaveBeenCalledWith(
      expect.objectContaining({
        availableTreatments: expect.arrayContaining([
          expect.objectContaining({ id: 'cat-001', name: 'Microagulhamento' }),
          expect.objectContaining({ id: 'cat-002', name: 'Botox' }),
        ]),
      })
    );
    expect(recommendProtocol.mock.calls[0][0].availableTreatments).toHaveLength(2);
  });
});

describe('processAestheticAnalysis — aesthetic_profile fetch (F4)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('quando subjects.aesthetic_profile não vazio → recommendProtocol chamado com computedNutrition non-null', async () => {
    const { analyzeFacial } = require('../../src/agents/aesthetic-facial');
    const { recommendProtocol } = require('../../src/agents/aesthetic-recommender');

    analyzeFacial.mockResolvedValue({
      metrics: { rugas: { score: 72, regions: [] } },
      observations: {},
      tokens_input: 1000, tokens_output: 500,
    });
    recommendProtocol.mockResolvedValue({
      recommendations: { treatment_protocol: [], lifestyle_recommendations: {} },
      tokens_input: 500, tokens_output: 300,
    });

    // Perfil completo para computeAll retornar resultado (Mifflin-St Jeor precisa de height_cm, weight_kg, age, sex)
    const fakeProfile = {
      height_cm: 165, weight_kg: 60, age: 30, sex: 'F',
      activity_level: 'moderate', goals: ['wellness'],
    };

    const pool = {
      connect: jest.fn(async () => ({
        query: jest.fn(async (sql, params) => {
          if (/SELECT .* FROM aesthetic_photos/i.test(sql)) {
            return { rows: params[0].map((id) => ({ id, s3_key: `aesthetic-photos/t/s/${id}.jpg` })) };
          }
          if (/SELECT .* FROM subjects/i.test(sql)) {
            // Primeira query de subjects (com s.*) retorna o subject completo
            if (/SELECT s\.\*/i.test(sql) || /EXTRACT/i.test(sql)) {
              return { rows: [{ id: 'sub1', fitzpatrick_type: 3, sex: 'F', birth_date: '1990-01-01', aesthetic_profile: fakeProfile }] };
            }
            // Segunda query de subjects (aesthetic_profile) retorna o profile
            return { rows: [{ aesthetic_profile: fakeProfile }] };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      })),
    };

    await processAestheticAnalysis({
      pool,
      data: { analysis_id: 'a1', tenant_id: 't1', subject_id: 'sub1', user_id: 'u1',
              analysis_type: 'facial', photo_ids: ['p1'], professional_type: 'medico' },
    });

    // recommendProtocol deve ter sido chamado com computedNutrition não-null
    expect(recommendProtocol).toHaveBeenCalledWith(
      expect.objectContaining({
        computedNutrition: expect.objectContaining({
          tmb: expect.any(Number),
          calories: expect.any(Number),
          macros: expect.objectContaining({
            protein_g: expect.any(Number),
            carbs_g: expect.any(Number),
            fat_g: expect.any(Number),
          }),
        }),
      })
    );
  });

  test('quando subjects.aesthetic_profile está vazio → computedNutrition é null', async () => {
    const { analyzeFacial } = require('../../src/agents/aesthetic-facial');
    const { recommendProtocol } = require('../../src/agents/aesthetic-recommender');

    analyzeFacial.mockResolvedValue({
      metrics: { rugas: { score: 72, regions: [] } },
      observations: {},
      tokens_input: 1000, tokens_output: 500,
    });
    recommendProtocol.mockResolvedValue({
      recommendations: { treatment_protocol: [], lifestyle_recommendations: {} },
      tokens_input: 500, tokens_output: 300,
    });

    const pool = {
      connect: jest.fn(async () => ({
        query: jest.fn(async (sql, params) => {
          if (/SELECT .* FROM aesthetic_photos/i.test(sql)) {
            return { rows: params[0].map((id) => ({ id, s3_key: `path/${id}.jpg` })) };
          }
          if (/SELECT .* FROM subjects/i.test(sql)) {
            if (/EXTRACT/i.test(sql)) {
              return { rows: [{ id: 'sub1', fitzpatrick_type: 3, sex: 'F', birth_date: '1990-01-01' }] };
            }
            // aesthetic_profile vazio/null
            return { rows: [{ aesthetic_profile: null }] };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      })),
    };

    await processAestheticAnalysis({
      pool,
      data: { analysis_id: 'a1', tenant_id: 't1', subject_id: 'sub1', user_id: 'u1',
              analysis_type: 'facial', photo_ids: ['p1'], professional_type: 'medico' },
    });

    expect(recommendProtocol).toHaveBeenCalledWith(
      expect.objectContaining({
        computedNutrition: null,
      })
    );
  });
});

describe('processAestheticAnalysis — body region routing', () => {
  beforeEach(() => jest.clearAllMocks());

  test('analysis_type=legs roteia pra analyzeBody (não analyzeFacial)', async () => {
    const { analyzeFacial } = require('../../src/agents/aesthetic-facial');
    const { analyzeBody } = require('../../src/agents/aesthetic-body');
    const { recommendProtocol } = require('../../src/agents/aesthetic-recommender');

    analyzeBody.mockResolvedValue({
      metrics: { culote_esquerdo: { score: 65, regions: [] } },
      observations: { qualitative: 'ok' },
      tokens_input: 1000, tokens_output: 500,
    });
    recommendProtocol.mockResolvedValue({
      recommendations: {},
      tokens_input: 500, tokens_output: 300,
    });

    const queries = [];
    const pool = {
      connect: jest.fn(async () => ({
        query: jest.fn(async (sql, params) => {
          queries.push({ sql, params });
          if (/SELECT .* FROM aesthetic_photos/i.test(sql)) {
            return { rows: params[0].map((id) => ({ id, s3_key: `path/${id}.jpg` })) };
          }
          if (/SELECT .* FROM subjects/i.test(sql)) {
            return { rows: [{ id: 'sub1', sex: 'F', birth_date: '1990-01-01' }] };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      })),
    };

    await processAestheticAnalysis({
      pool,
      data: { analysis_id: 'a1', tenant_id: 't1', subject_id: 'sub1', user_id: 'u1',
              analysis_type: 'legs', photo_ids: ['p1'], professional_type: 'medico' },
    });

    expect(analyzeBody).toHaveBeenCalled();
    expect(analyzeFacial).not.toHaveBeenCalled();
  });
});
