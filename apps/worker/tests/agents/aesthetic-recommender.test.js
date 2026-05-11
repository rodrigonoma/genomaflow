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
});
