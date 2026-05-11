'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
  REGION_METRICS,
  VALID_ANALYSIS_TYPES,
  SENSITIVE_REGIONS,
  metricsForRegion,
  isValidMetric,
} = require('../../src/constants/aesthetic-metrics');

describe('aesthetic-metrics catalog', () => {
  test('facial has 11 métricas', () => {
    expect(REGION_METRICS.facial).toHaveLength(11);
    expect(REGION_METRICS.facial).toEqual(expect.arrayContaining([
      'rugas', 'firmeza', 'elasticidade', 'textura', 'manchas',
      'poros', 'olheiras', 'vermelhidao', 'uniformidade_tom',
      'acne', 'simetria',
    ]));
  });

  test('VALID_ANALYSIS_TYPES tem 10 valores e bate com CHECK constraint', () => {
    expect(VALID_ANALYSIS_TYPES).toHaveLength(10);
    expect(VALID_ANALYSIS_TYPES).toEqual([
      'facial','eyelids','neck','breast','arms',
      'abdomen','legs','glutes','full_body','other',
    ]);
  });

  test('SENSITIVE_REGIONS inclui breast, glutes, abdomen', () => {
    expect(SENSITIVE_REGIONS).toEqual(expect.arrayContaining(['breast','glutes','abdomen']));
  });

  test('metricsForRegion retorna array', () => {
    expect(metricsForRegion('facial')).toEqual(REGION_METRICS.facial);
    expect(metricsForRegion('other')).toEqual([]);
    expect(metricsForRegion('invalid')).toEqual([]);
  });

  test('isValidMetric bate com região', () => {
    expect(isValidMetric('facial', 'rugas')).toBe(true);
    expect(isValidMetric('facial', 'culote_esquerdo')).toBe(false);
    expect(isValidMetric('legs', 'culote_esquerdo')).toBe(true);
  });

  test('kebab_case names consistentes (sem espaços, sem maiúsculas)', () => {
    for (const region of Object.keys(REGION_METRICS)) {
      for (const metric of REGION_METRICS[region]) {
        expect(metric).toMatch(/^[a-z0-9_]+$/);
      }
    }
  });
});
