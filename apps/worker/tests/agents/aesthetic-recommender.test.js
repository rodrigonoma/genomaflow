'use strict';

const { describe, test, expect } = require('@jest/globals');

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic { constructor() {} messages = { create: mockCreate }; },
}));

const { recommendProtocol, sanitizeRecommendations } = require('../../src/agents/aesthetic-recommender');

describe('recommendProtocol', () => {
  test('retorna recommendations + tokens', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Microagulhamento',
          target_metric: 'rugas',
          indication_text: 'Estímulo de colágeno pra rugas dinâmicas',
          sessions_recommended: 3,
          interval_days: 30,
          urgency: 'medium',
          expected_outcome: 'Melhora visível em 3 sessões',
        }],
        lifestyle_recommendations: {
          estimated_daily_calories_kcal: 1800,
          hydration_ml_per_day: 2500,
          disclaimer: 'Consulte nutricionista (CRN)',
        },
        summary_for_patient: 'Plano simples...',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });
    const result = await recommendProtocol({
      metrics: { rugas: { score: 70, regions: [] } },
      subject: { age_years: 40, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
    });
    expect(result.recommendations.treatment_protocol).toHaveLength(1);
    expect(result.tokens_output).toBe(400);
  });

  test('esteticista NÃO recebe sugestões que requerem medico', () => {
    const raw = {
      treatment_protocol: [
        { treatment_name: 'Botox', requires_medico: true, target_metric: 'rugas' },
        { treatment_name: 'Microagulhamento', requires_medico: false, target_metric: 'rugas' },
      ],
    };
    const clean = sanitizeRecommendations(raw, 'esteticista');
    expect(clean.treatment_protocol).toHaveLength(1);
    expect(clean.treatment_protocol[0].treatment_name).toBe('Microagulhamento');
  });

  test('medico recebe tudo', () => {
    const raw = {
      treatment_protocol: [
        { treatment_name: 'Botox', requires_medico: true, target_metric: 'rugas' },
        { treatment_name: 'Microagulhamento', requires_medico: false, target_metric: 'rugas' },
      ],
    };
    const clean = sanitizeRecommendations(raw, 'medico');
    expect(clean.treatment_protocol).toHaveLength(2);
  });

  test('disclaimer nutrição sempre presente quando lifestyle existe', () => {
    const raw = {
      lifestyle_recommendations: { estimated_daily_calories_kcal: 2000 },
    };
    const clean = sanitizeRecommendations(raw, 'medico');
    expect(clean.lifestyle_recommendations.disclaimer).toBeDefined();
    expect(clean.lifestyle_recommendations.disclaimer).toMatch(/nutricionista|CRN/i);
  });

  test('clamp sessions + interval pra valores razoáveis', () => {
    const raw = {
      treatment_protocol: [{
        treatment_name: 'X', target_metric: 'rugas',
        sessions_recommended: 100, interval_days: -10,
        requires_medico: false,
      }],
    };
    const clean = sanitizeRecommendations(raw, 'medico');
    expect(clean.treatment_protocol[0].sessions_recommended).toBeLessThanOrEqual(20);
    expect(clean.treatment_protocol[0].interval_days).toBeGreaterThanOrEqual(7);
  });

  test('BAD_LLM_OUTPUT em JSON inválido', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: 'lorem ipsum não é json' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await expect(recommendProtocol({
      metrics: { rugas: { score: 70 } },
      subject: { age_years: 30, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
    })).rejects.toMatchObject({ code: 'BAD_LLM_OUTPUT' });
  });

  test('catalog matching: nome exato (case-insensitive) enriquece com treatment_id e in_catalog=true', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Microagulhamento',
          target_metric: 'rugas',
          indication_text: 'Estímulo de colágeno',
          sessions_recommended: 3,
          interval_days: 30,
          urgency: 'medium',
          expected_outcome: 'Melhora em 3 sessões',
          requires_medico: false,
        }],
        lifestyle_recommendations: {},
        summary_for_patient: 'Plano teste',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });

    const availableTreatments = [
      { id: 'cat-uuid-001', name: 'Microagulhamento', category: 'skin', requires_medico: false },
      { id: 'cat-uuid-002', name: 'Botox', category: 'injectable', requires_medico: true },
    ];

    const result = await recommendProtocol({
      metrics: { rugas: { score: 70 } },
      subject: { age_years: 40, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
      availableTreatments,
    });

    const tx = result.recommendations.treatment_protocol[0];
    expect(tx.treatment_id).toBe('cat-uuid-001');
    expect(tx.in_catalog).toBe(true);
    // requires_medico deve vir do catálogo, não do LLM
    expect(tx.requires_medico).toBe(false);
  });

  test('catalog matching: nome fora do catálogo → in_catalog=false, sem treatment_id', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Tratamento Novo XYZ',
          target_metric: 'rugas',
          indication_text: 'Tratamento experimental',
          sessions_recommended: 2,
          interval_days: 45,
          urgency: 'low',
          expected_outcome: 'Resultado hipotético',
          requires_medico: false,
        }],
        lifestyle_recommendations: {},
        summary_for_patient: 'Plano teste',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });

    const availableTreatments = [
      { id: 'cat-uuid-001', name: 'Microagulhamento', category: 'skin', requires_medico: false },
    ];

    const result = await recommendProtocol({
      metrics: { rugas: { score: 70 } },
      subject: { age_years: 40, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
      availableTreatments,
    });

    const tx = result.recommendations.treatment_protocol[0];
    expect(tx.in_catalog).toBe(false);
    expect(tx.treatment_id).toBeUndefined();
  });

  test('sem availableTreatments → comportamento legacy (in_catalog=false no sanitize, sem treatment_id)', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Microagulhamento',
          target_metric: 'rugas',
          indication_text: 'Estímulo de colágeno',
          sessions_recommended: 3,
          interval_days: 30,
          urgency: 'medium',
          expected_outcome: 'Melhora em 3 sessões',
          requires_medico: false,
        }],
        lifestyle_recommendations: {},
        summary_for_patient: 'Plano teste',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });

    const result = await recommendProtocol({
      metrics: { rugas: { score: 70 } },
      subject: { age_years: 40, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
      // availableTreatments omitido — comportamento F1/F2 legacy
    });

    const tx = result.recommendations.treatment_protocol[0];
    expect(tx.treatment_id).toBeUndefined();
    // in_catalog=false vem do sanitizeTreatment (valor padrão para o campo)
    expect(tx.in_catalog).toBe(false);
  });
});
