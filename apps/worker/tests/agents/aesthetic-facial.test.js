'use strict';

const { describe, test, expect } = require('@jest/globals');

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic { constructor() {} messages = { create: mockCreate }; },
  };
});

const { analyzeFacial, sanitizeMetrics } = require('../../src/agents/aesthetic-facial');

describe('analyzeFacial', () => {
  test('happy path retorna metrics + observations', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        metrics: {
          rugas: { score: 72, confidence: 'high', regions: [{ type: 'bbox', x: 0.5, y: 0.3, w: 0.1, h: 0.05 }] },
          firmeza: { score: 65, confidence: 'high', regions: [] },
        },
        observations: { qualitative: 'pele com presença de rugas moderadas' }
      }) }],
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    const result = await analyzeFacial({
      photoBuffers: [Buffer.from('fake')],
      subject: { age_years: 35, fitzpatrick_type: 3, skin_concerns: [], sex: 'F' },
      analysisType: 'facial',
    });
    expect(result.metrics.rugas.score).toBe(72);
    expect(result.tokens_input).toBe(1000);
  });

  test('clamp score 0-100 + slice arrays', () => {
    const dirty = {
      rugas: { score: 150, confidence: 'high', regions: Array(50).fill({ type: 'bbox', x: 0.5, y: 0.5, w: 0.1, h: 0.1 }) },
      firmeza: { score: -10, regions: [] },
    };
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas.score).toBe(100);
    expect(clean.firmeza.score).toBe(0);
    expect(clean.rugas.regions.length).toBeLessThanOrEqual(20);
  });

  test('region type whitelist (rejeita inválido)', () => {
    const dirty = {
      rugas: { score: 50, regions: [
        { type: 'bbox', x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
        { type: 'invalid_type', x: 0.5, y: 0.5 },
        { type: 'polyline', points: [[0.1, 0.1], [0.2, 0.2]] },
      ]},
    };
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas.regions.map(r => r.type)).toEqual(['bbox', 'polyline']);
  });

  test('rejeita métrica fora do catálogo da região', () => {
    const dirty = {
      rugas: { score: 50, regions: [] },
      culote_esquerdo: { score: 70, regions: [] }, // não é facial
    };
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas).toBeDefined();
    expect(clean.culote_esquerdo).toBeUndefined();
  });

  test('NO_FACE_DETECTED quando IA retorna flag', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({ no_face_detected: true }) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await expect(analyzeFacial({
      photoBuffers: [Buffer.from('fake')],
      subject: { age_years: 30, fitzpatrick_type: 3, skin_concerns: [], sex: 'F' },
      analysisType: 'facial',
    })).rejects.toMatchObject({ code: 'NO_FACE_DETECTED' });
  });

  test('BAD_LLM_OUTPUT em JSON inválido', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: 'isso não é json' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await expect(analyzeFacial({
      photoBuffers: [Buffer.from('fake')],
      subject: { age_years: 30, fitzpatrick_type: 3, skin_concerns: [], sex: 'F' },
      analysisType: 'facial',
    })).rejects.toMatchObject({ code: 'BAD_LLM_OUTPUT' });
  });
});
