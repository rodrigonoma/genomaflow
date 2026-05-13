'use strict';

/**
 * aesthetic-evolution service
 *
 * V2 Fase 4: lista temporal de análises de um subject com aggregate_*
 * scores. Frontend renderiza como gráfico ng2-charts (6 séries).
 *
 * Backward compat: análises pré-F2 (sem aggregates) entram na lista mas
 * todos os 6 aggregate_* vêm null (gap no gráfico).
 *
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase4-design.md §5.3
 */

const AGGREGATE_KEYS = [
  'skin_texture',
  'spots',
  'symmetry',
  'wrinkles',
  'dark_circles',
  'acne',
];

/**
 * Lista pontos da evolução estética do subject, ordenado ASC por
 * completed_at (timeline natural).
 *
 * Retorna: { subject_id, points: [{ analysis_id, completed_at, tier, aggregate_scores }] }
 *
 * @param {import('pg').Pool} pg
 * @param {Object} args
 * @param {string} args.tenantId
 * @param {string} args.subjectId
 * @param {number} [args.limit=50]
 */
async function listEvolutionPoints(pg, { tenantId, subjectId, limit = 50 }) {
  const { rows } = await pg.query(
    `SELECT id, completed_at, created_at, tier, analysis_type, metrics
       FROM aesthetic_analyses
      WHERE tenant_id = $1
        AND subject_id = $2
        AND status = 'done'
        AND deleted_at IS NULL
      ORDER BY COALESCE(completed_at, created_at) ASC
      LIMIT $3`,
    [tenantId, subjectId, Math.min(100, Math.max(1, limit))]
  );

  return {
    subject_id: subjectId,
    points: rows.map(r => {
      const metrics = r.metrics || {};
      const aggregate_scores = {};
      for (const k of AGGREGATE_KEYS) {
        const m = metrics[`aggregate_${k}`];
        aggregate_scores[k] = (m && typeof m.score === 'number') ? m.score : null;
      }
      return {
        analysis_id: r.id,
        completed_at: r.completed_at || r.created_at,
        tier: r.tier || 'standard',
        analysis_type: r.analysis_type,
        aggregate_scores,
      };
    }),
  };
}

module.exports = {
  listEvolutionPoints,
  AGGREGATE_KEYS,
};
