'use strict';

const { describe, test, expect } = require('@jest/globals');

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic { constructor() {} messages = { create: mockCreate }; },
}));

const { analyzeBody, sanitizeBodyMetrics } = require('../../src/agents/aesthetic-body');

describe('analyzeBody', () => {
  test('happy path retorna metrics corporais + observations', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        metrics: {
          culote_esquerdo: { score: 65, confidence: 'medium', regions: [{ type: 'polygon', points: [[0.3,0.5],[0.35,0.5],[0.35,0.6],[0.3,0.6]] }] },
          culote_direito: { score: 60, confidence: 'medium', regions: [] },
        },
        observations: { qualitative: 'presença moderada de culote em ambas as faces laterais' }
      })}],
      usage: { input_tokens: 1200, output_tokens: 800 },
    });
    const result = await analyzeBody({
      photoBuffers: [Buffer.from('fake')],
      subject: { age_years: 35, sex: 'F' },
      analysisType: 'legs',
    });
    expect(result.metrics.culote_esquerdo.score).toBe(65);
    expect(result.tokens_input).toBe(1200);
  });

  test('rejeita métricas fora do catálogo da região', () => {
    const dirty = {
      culote_esquerdo: { score: 50, regions: [] },
      rugas: { score: 70, regions: [] }, // não é legs
    };
    const clean = sanitizeBodyMetrics(dirty, 'legs');
    expect(clean.culote_esquerdo).toBeDefined();
    expect(clean.rugas).toBeUndefined();
  });

  test('clamp score 0-100', () => {
    const dirty = {
      culote_esquerdo: { score: 150, regions: [] },
      celulite_coxas: { score: -10, regions: [] },
    };
    const clean = sanitizeBodyMetrics(dirty, 'legs');
    expect(clean.culote_esquerdo.score).toBe(100);
    expect(clean.celulite_coxas.score).toBe(0);
  });

  test('region polygon points sliced to MAX_POINTS=50', () => {
    const longPoints = Array(80).fill([0.5, 0.5]);
    const dirty = {
      culote_esquerdo: { score: 50, regions: [{ type: 'polygon', points: longPoints }] },
    };
    const clean = sanitizeBodyMetrics(dirty, 'legs');
    expect(clean.culote_esquerdo.regions[0].points.length).toBeLessThanOrEqual(50);
  });

  test('NO_BODY_DETECTED quando IA flag', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({ no_body_detected: true, reason: 'imagem não mostra corpo' }) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await expect(analyzeBody({
      photoBuffers: [Buffer.from('fake')],
      subject: { age_years: 30, sex: 'F' },
      analysisType: 'abdomen',
    })).rejects.toMatchObject({ code: 'NO_BODY_DETECTED' });
  });

  test('BAD_LLM_OUTPUT em JSON inválido', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: 'lorem ipsum' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await expect(analyzeBody({
      photoBuffers: [Buffer.from('fake')],
      subject: { age_years: 30, sex: 'F' },
      analysisType: 'legs',
    })).rejects.toMatchObject({ code: 'BAD_LLM_OUTPUT' });
  });
});
