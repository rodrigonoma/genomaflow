'use strict';

const { describe, test, expect } = require('@jest/globals');
const { listEvolutionPoints, AGGREGATE_KEYS } = require('../../src/services/aesthetic-evolution');

function makePg(rows) {
  return { query: jest.fn().mockResolvedValueOnce({ rows: rows || [] }) };
}

describe('AGGREGATE_KEYS', () => {
  test('expõe 6 categorias canônicas', () => {
    expect(AGGREGATE_KEYS.sort()).toEqual([
      'acne', 'dark_circles', 'skin_texture', 'spots', 'symmetry', 'wrinkles',
    ]);
  });
});

describe('listEvolutionPoints', () => {
  test('retorna pontos ordenados ASC + aggregate_scores mapeados', async () => {
    const pg = makePg([
      {
        id: 'a1', completed_at: '2026-04-01T10:00:00Z',
        tier: 'standard', analysis_type: 'facial',
        metrics: {
          aggregate_skin_texture: { score: 70 },
          aggregate_wrinkles: { score: 65 },
        },
      },
      {
        id: 'a2', completed_at: '2026-05-01T10:00:00Z',
        tier: 'advanced', analysis_type: 'facial',
        metrics: {
          aggregate_skin_texture: { score: 75 },
          aggregate_wrinkles: { score: 70 },
          aggregate_symmetry: { score: 88 },
        },
      },
    ]);

    const r = await listEvolutionPoints(pg, { tenantId: 't1', subjectId: 's1' });

    expect(r.subject_id).toBe('s1');
    expect(r.points.length).toBe(2);
    expect(r.points[0].analysis_id).toBe('a1');
    expect(r.points[0].tier).toBe('standard');
    expect(r.points[0].aggregate_scores.skin_texture).toBe(70);
    expect(r.points[0].aggregate_scores.wrinkles).toBe(65);
    expect(r.points[0].aggregate_scores.symmetry).toBeNull();
    expect(r.points[1].aggregate_scores.symmetry).toBe(88);
  });

  test('análise legacy sem metrics → todos os 6 aggregates vêm null (gap)', async () => {
    const pg = makePg([
      { id: 'a-legacy', completed_at: '2026-01-01T10:00:00Z', tier: 'standard', metrics: null },
    ]);
    const r = await listEvolutionPoints(pg, { tenantId: 't1', subjectId: 's1' });
    for (const k of AGGREGATE_KEYS) {
      expect(r.points[0].aggregate_scores[k]).toBeNull();
    }
  });

  test('SQL ORDER BY COALESCE(completed_at, created_at) ASC + LIMIT clamp', async () => {
    const pg = makePg([]);
    await listEvolutionPoints(pg, { tenantId: 't1', subjectId: 's1', limit: 999 });
    const sql = pg.query.mock.calls[0][0];
    const params = pg.query.mock.calls[0][1];
    expect(sql).toMatch(/ORDER BY COALESCE\(completed_at, created_at\) ASC/);
    expect(params[2]).toBe(100); // clamp 100
  });

  test('limit default 50 quando não passa', async () => {
    const pg = makePg([]);
    await listEvolutionPoints(pg, { tenantId: 't1', subjectId: 's1' });
    expect(pg.query.mock.calls[0][1][2]).toBe(50);
  });

  test('completed_at null usa created_at como fallback', async () => {
    const pg = makePg([
      { id: 'a1', completed_at: null, created_at: '2026-01-01T10:00:00Z', tier: 'standard', metrics: {} },
    ]);
    const r = await listEvolutionPoints(pg, { tenantId: 't1', subjectId: 's1' });
    expect(r.points[0].completed_at).toBe('2026-01-01T10:00:00Z');
  });
});
