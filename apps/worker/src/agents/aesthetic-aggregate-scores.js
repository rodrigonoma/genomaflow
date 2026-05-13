'use strict';

/**
 * aesthetic-aggregate-scores
 *
 * Calcula 6 scores agregados não-comparativos a partir do mergedMetrics
 * (Vision + landmarks já mesclados). Determinístico, sem IA — pura média
 * sobre métricas que existirem. Ausência de uma contributora não dá zero,
 * apenas reduz amostra.
 *
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase2-design.md §4
 */

// Mapeamento score agregado → métricas que contribuem.
// Geometria (mediapipe) só existe em tier=advanced — em standard cai fora
// automaticamente porque a chave não está no mergedMetrics.
const SCORE_MAP = {
  aggregate_skin_texture: ['textura', 'poros', 'uniformidade_tom'],
  aggregate_spots: ['manchas', 'vermelhidao'],
  aggregate_symmetry: [
    'simetria',
    // mediapipe (advanced only)
    'symmetry_horizontal',
    'head_tilt_roll',
    'mandibular_angle_left',
    'mandibular_angle_right',
  ],
  aggregate_wrinkles: ['rugas', 'firmeza', 'elasticidade'],
  aggregate_dark_circles: ['olheiras'],
  aggregate_acne: ['acne'],
};

function aggregateConfidence(contributors) {
  const confs = contributors.map(m => m.confidence);
  if (confs.includes('low')) return 'low';
  if (confs.includes('medium')) return 'medium';
  return 'high';
}

function computeAggregate(metrics, contributorKeys) {
  const present = contributorKeys
    .map(k => metrics[k])
    .filter(m => m && typeof m.score === 'number' && Number.isFinite(m.score));
  if (present.length === 0) return null;

  const score = Math.round(
    present.reduce((s, m) => s + m.score, 0) / present.length
  );

  return {
    score,
    confidence: aggregateConfidence(present),
    regions: [],
    source: 'aggregate',
    contributors: present.length,
  };
}

/**
 * Computa todos os scores agregados a partir do mergedMetrics.
 * Retorna objeto com chaves `aggregate_*`. Scores sem contributoras
 * presentes são omitidos (não vai como zero).
 *
 * @param {Object} mergedMetrics  Mapa Vision + landmarks já mesclado
 * @returns {Object}              Mapa de aggregate_* → MetricData
 */
function computeAllAggregateScores(mergedMetrics) {
  if (!mergedMetrics || typeof mergedMetrics !== 'object') return {};
  const out = {};
  for (const [aggKey, contributors] of Object.entries(SCORE_MAP)) {
    const result = computeAggregate(mergedMetrics, contributors);
    if (result) out[aggKey] = result;
  }
  return out;
}

module.exports = {
  computeAllAggregateScores,
  computeAggregate,
  SCORE_MAP,
};
