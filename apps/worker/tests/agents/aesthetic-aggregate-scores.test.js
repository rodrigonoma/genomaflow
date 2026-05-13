'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
  computeAllAggregateScores,
  computeAggregate,
  SCORE_MAP,
} = require('../../src/agents/aesthetic-aggregate-scores');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function m(score, confidence = 'high', extras = {}) {
  return { score, confidence, regions: [], ...extras };
}

// ---------------------------------------------------------------------------
// SCORE_MAP shape — regression contra refactor acidental
// ---------------------------------------------------------------------------

describe('SCORE_MAP', () => {
  test('tem exatamente 6 scores não-comparativos', () => {
    expect(Object.keys(SCORE_MAP).sort()).toEqual([
      'aggregate_acne',
      'aggregate_dark_circles',
      'aggregate_skin_texture',
      'aggregate_spots',
      'aggregate_symmetry',
      'aggregate_wrinkles',
    ]);
  });

  test('aggregate_symmetry inclui geometria advanced (mediapipe)', () => {
    expect(SCORE_MAP.aggregate_symmetry).toEqual(expect.arrayContaining([
      'simetria',
      'symmetry_horizontal',
      'head_tilt_roll',
      'mandibular_angle_left',
      'mandibular_angle_right',
    ]));
  });
});

// ---------------------------------------------------------------------------
// computeAggregate — função unitária
// ---------------------------------------------------------------------------

describe('computeAggregate', () => {
  test('média simples de scores presentes', () => {
    const metrics = { a: m(80), b: m(60), c: m(40) };
    const r = computeAggregate(metrics, ['a', 'b', 'c']);
    expect(r.score).toBe(60); // (80+60+40)/3
    expect(r.contributors).toBe(3);
  });

  test('arredonda pro inteiro mais próximo', () => {
    const metrics = { a: m(70), b: m(71) };
    expect(computeAggregate(metrics, ['a', 'b']).score).toBe(71); // 70.5 → 71
  });

  test('contributoras ausentes não viram zero — só reduzem amostra', () => {
    const metrics = { a: m(90) }; // só 1 das 3 presente
    const r = computeAggregate(metrics, ['a', 'b', 'c']);
    expect(r.score).toBe(90);
    expect(r.contributors).toBe(1);
  });

  test('todas ausentes → null', () => {
    expect(computeAggregate({}, ['x', 'y'])).toBeNull();
  });

  test('score não-numérico é ignorado', () => {
    const metrics = { a: m(50), b: { score: 'not-a-number', confidence: 'high' } };
    const r = computeAggregate(metrics, ['a', 'b']);
    expect(r.score).toBe(50);
    expect(r.contributors).toBe(1);
  });

  test('regions sempre vazio (aggregate não tem geometria visual)', () => {
    const r = computeAggregate({ a: m(80) }, ['a']);
    expect(r.regions).toEqual([]);
  });

  test('source = "aggregate" sempre (discriminador frontend)', () => {
    const r = computeAggregate({ a: m(80) }, ['a']);
    expect(r.source).toBe('aggregate');
  });
});

// ---------------------------------------------------------------------------
// Confidence aggregation
// ---------------------------------------------------------------------------

describe('confidence aggregation', () => {
  test('todas high → high', () => {
    const metrics = { a: m(80, 'high'), b: m(70, 'high') };
    expect(computeAggregate(metrics, ['a', 'b']).confidence).toBe('high');
  });

  test('mistura high+medium → medium', () => {
    const metrics = { a: m(80, 'high'), b: m(70, 'medium') };
    expect(computeAggregate(metrics, ['a', 'b']).confidence).toBe('medium');
  });

  test('qualquer low → low (pior caso)', () => {
    const metrics = { a: m(80, 'high'), b: m(70, 'low'), c: m(60, 'medium') };
    expect(computeAggregate(metrics, ['a', 'b', 'c']).confidence).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// computeAllAggregateScores — orquestração
// ---------------------------------------------------------------------------

describe('computeAllAggregateScores', () => {
  test('mergedMetrics vazio → {}', () => {
    expect(computeAllAggregateScores({})).toEqual({});
  });

  test('null/undefined → {}', () => {
    expect(computeAllAggregateScores(null)).toEqual({});
    expect(computeAllAggregateScores(undefined)).toEqual({});
  });

  test('Vision standard (sem geometria) — calcula scores aplicáveis', () => {
    const merged = {
      rugas: m(70),
      firmeza: m(65),
      elasticidade: m(60),
      olheiras: m(50),
      acne: m(80),
      // sem simetria, sem manchas, sem textura
    };
    const out = computeAllAggregateScores(merged);
    expect(out.aggregate_wrinkles.score).toBe(65); // (70+65+60)/3
    expect(out.aggregate_dark_circles.score).toBe(50);
    expect(out.aggregate_acne.score).toBe(80);
    // omitidos por falta de contributoras:
    expect(out.aggregate_skin_texture).toBeUndefined();
    expect(out.aggregate_spots).toBeUndefined();
    expect(out.aggregate_symmetry).toBeUndefined();
  });

  test('Vision + geometria (advanced) — symmetry inclui mediapipe metrics', () => {
    const merged = {
      simetria: m(80),                  // Vision
      symmetry_horizontal: m(88),       // mediapipe
      head_tilt_roll: m(95),            // mediapipe
      mandibular_angle_left: m(78),     // mediapipe
      mandibular_angle_right: m(76),    // mediapipe
    };
    const out = computeAllAggregateScores(merged);
    // (80 + 88 + 95 + 78 + 76) / 5 = 83.4 → 83
    expect(out.aggregate_symmetry.score).toBe(83);
    expect(out.aggregate_symmetry.contributors).toBe(5);
  });

  test('preserva métricas originais intactas (não muta input)', () => {
    const merged = { rugas: m(70), firmeza: m(60) };
    const snapshot = JSON.parse(JSON.stringify(merged));
    computeAllAggregateScores(merged);
    expect(merged).toEqual(snapshot);
  });

  test('cenário facial advanced realista — todos 6 scores ou subset', () => {
    const merged = {
      // Vision facial completo
      rugas: m(72), manchas: m(65), vermelhidao: m(60),
      olheiras: m(55), poros: m(70), acne: m(85),
      simetria: m(82), uniformidade_tom: m(75),
      textura: m(70), firmeza: m(68), elasticidade: m(66),
      // Geometria advanced
      symmetry_horizontal: m(90), head_tilt_roll: m(92),
      mandibular_angle_left: m(80), mandibular_angle_right: m(78),
      interocular_distance: m(50),
      proportion_thirds: m(70),
    };
    const out = computeAllAggregateScores(merged);
    expect(Object.keys(out).sort()).toEqual([
      'aggregate_acne',
      'aggregate_dark_circles',
      'aggregate_skin_texture',
      'aggregate_spots',
      'aggregate_symmetry',
      'aggregate_wrinkles',
    ]);
    // Spot-check: skin_texture = (textura+poros+uniformidade_tom)/3 = (70+70+75)/3 = 71.67 → 72
    expect(out.aggregate_skin_texture.score).toBe(72);
  });
});
