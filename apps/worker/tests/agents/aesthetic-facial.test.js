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

  // ---------------------------------------------------------------------------
  // V2 Fase 2: Region.severity opcional
  // ---------------------------------------------------------------------------
  test('V2-F2: severity 0-100 preservada quando válida', () => {
    const dirty = { rugas: { score: 50, regions: [
      { type: 'bbox', x: 0.1, y: 0.1, width: 0.2, height: 0.2, severity: 75 },
    ]}};
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas.regions[0].severity).toBe(75);
  });

  test('V2-F2: severity ausente → não aparece no output (sem default)', () => {
    const dirty = { rugas: { score: 50, regions: [
      { type: 'bbox', x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    ]}};
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas.regions[0]).not.toHaveProperty('severity');
  });

  test('V2-F2: severity 150 → clamp em 100', () => {
    const dirty = { rugas: { score: 50, regions: [
      { type: 'bbox', x: 0.1, y: 0.1, width: 0.2, height: 0.2, severity: 150 },
    ]}};
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas.regions[0].severity).toBe(100);
  });

  test('V2-F2: severity -10 → clamp em 0', () => {
    const dirty = { rugas: { score: 50, regions: [
      { type: 'bbox', x: 0.1, y: 0.1, width: 0.2, height: 0.2, severity: -10 },
    ]}};
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas.regions[0].severity).toBe(0);
  });

  test('V2-F2: severity não-numérica descartada (não vira NaN)', () => {
    const dirty = { rugas: { score: 50, regions: [
      { type: 'bbox', x: 0.1, y: 0.1, width: 0.2, height: 0.2, severity: 'high' },
    ]}};
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas.regions[0]).not.toHaveProperty('severity');
  });

  test('V2-F2: severity arredonda fracionária', () => {
    const dirty = { rugas: { score: 50, regions: [
      { type: 'bbox', x: 0.1, y: 0.1, width: 0.2, height: 0.2, severity: 67.6 },
    ]}};
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas.regions[0].severity).toBe(68);
  });

  // ---------------------------------------------------------------------------
  // REGRESSION GUARD — bug 2026-05-12
  // Contrato Region do worker DEVE bater o shape em apps/web/.../analysis.model.ts.
  // Mismatch (worker grava w/h, tuplas, from/to; frontend lê width/height, {x,y},
  // x1/y1/x2/y2) fez os marcadores SVG nunca aparecerem no overlay.
  // ---------------------------------------------------------------------------
  test('output shape: bbox usa width/height (NÃO w/h)', () => {
    const dirty = {
      rugas: { score: 50, regions: [
        { type: 'bbox', x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
        { type: 'bbox', x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
      ]},
    };
    const clean = sanitizeMetrics(dirty, 'facial');
    const [a, b] = clean.rugas.regions;
    expect(a).toEqual({ type: 'bbox', x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
    expect(b).toEqual({ type: 'bbox', x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
    expect(a).not.toHaveProperty('w');
    expect(a).not.toHaveProperty('h');
  });

  test('output shape: polyline/polygon usa points como {x,y} (NÃO tuplas)', () => {
    const dirty = {
      rugas: { score: 50, regions: [
        { type: 'polyline', points: [[0.1, 0.2], [0.3, 0.4]] },
        { type: 'polygon', points: [{ x: 0.5, y: 0.6 }, { x: 0.7, y: 0.8 }] },
      ]},
    };
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas.regions[0]).toEqual({
      type: 'polyline',
      points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
    });
    expect(clean.rugas.regions[1]).toEqual({
      type: 'polygon',
      points: [{ x: 0.5, y: 0.6 }, { x: 0.7, y: 0.8 }],
    });
  });

  test('output shape: line usa x1/y1/x2/y2 (NÃO from/to)', () => {
    const dirty = {
      rugas: { score: 50, regions: [
        { type: 'line', from: [0.1, 0.2], to: [0.3, 0.4] },
        { type: 'line', x1: 0.5, y1: 0.6, x2: 0.7, y2: 0.8 },
      ]},
    };
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas.regions[0]).toEqual({ type: 'line', x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 });
    expect(clean.rugas.regions[1]).toEqual({ type: 'line', x1: 0.5, y1: 0.6, x2: 0.7, y2: 0.8 });
    expect(clean.rugas.regions[0]).not.toHaveProperty('from');
    expect(clean.rugas.regions[0]).not.toHaveProperty('to');
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
