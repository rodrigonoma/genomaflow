'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
  computeLandmarkMetrics,
  symmetryHorizontal,
  proportionThirds,
  mandibularAngle,
  headTiltRoll,
  interocularDistance,
  postureShoulderAsymmetry,
  postureHipAsymmetry,
  waistHipRatioVisual,
  postureAlignmentLateral,
} = require('../../src/agents/aesthetic-landmarks-metrics');

// ---------------------------------------------------------------------------
// Fixtures — landmarks faciais sintéticos
// Cria array de 468 pts default em (0.5, 0.5, 0) e permite override por índice.
// ---------------------------------------------------------------------------

function facePts(overrides = {}) {
  const pts = Array(468).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [i, p] of Object.entries(overrides)) {
    pts[+i] = { ...pts[+i], ...p };
  }
  return pts;
}

function bodyPts(overrides = {}) {
  const pts = Array(33).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  for (const [i, p] of Object.entries(overrides)) {
    pts[+i] = { ...pts[+i], ...p };
  }
  return pts;
}

function facePhoto(pose, overrides = {}) {
  return {
    id: `photo-${pose}`,
    pose,
    landmarks: { type: 'face', points: facePts(overrides) },
  };
}

function bodyPhoto(pose, overrides = {}) {
  return {
    id: `photo-${pose}`,
    pose,
    landmarks: { type: 'body', points: bodyPts(overrides) },
  };
}

// ---------------------------------------------------------------------------
// Métricas faciais individuais
// ---------------------------------------------------------------------------

describe('symmetryHorizontal', () => {
  test('face perfeitamente simétrica → score próximo de 100', () => {
    // Pares simétricos em torno de 0.5
    const photo = facePhoto('frontal', {
      33: { x: 0.30 }, 263: { x: 0.70 },
      133: { x: 0.42 }, 362: { x: 0.58 },
      61: { x: 0.40 }, 291: { x: 0.60 },
      205: { x: 0.36 }, 425: { x: 0.64 },
      127: { x: 0.22 }, 356: { x: 0.78 },
    });
    const m = symmetryHorizontal([photo]);
    expect(m).not.toBeNull();
    expect(m.score).toBeGreaterThan(95);
    expect(m.source).toBe('mediapipe');
    expect(m.pose_used).toBe('frontal');
  });

  test('face muito assimétrica → score baixo', () => {
    const photo = facePhoto('frontal', {
      33: { x: 0.20 }, 263: { x: 0.95 }, // grande deslocamento
      133: { x: 0.35 }, 362: { x: 0.85 },
      61: { x: 0.30 }, 291: { x: 0.80 },
      205: { x: 0.25 }, 425: { x: 0.90 },
      127: { x: 0.10 }, 356: { x: 0.99 },
    });
    const m = symmetryHorizontal([photo]);
    expect(m.score).toBeLessThan(50);
  });

  test('retorna null sem foto frontal', () => {
    const photo = facePhoto('profile_left');
    expect(symmetryHorizontal([photo])).toBeNull();
  });
});

describe('proportionThirds', () => {
  test('terços perfeitos (1:1) → score 100', () => {
    const photo = facePhoto('frontal', {
      10: { y: 0.20 },    // hairline
      1:  { y: 0.50 },    // nose
      152: { y: 0.80 },   // chin
    });
    const m = proportionThirds([photo]);
    expect(m).not.toBeNull();
    expect(m.score).toBe(100);
    expect(m.value_raw).toBeCloseTo(1, 1);
  });

  test('terços desproporcionais → score reduzido', () => {
    const photo = facePhoto('frontal', {
      10: { y: 0.20 },
      1:  { y: 0.35 },    // nose curto → t1 < t2
      152: { y: 0.80 },
    });
    const m = proportionThirds([photo]);
    expect(m.score).toBeLessThan(80);
  });
});

describe('mandibularAngle', () => {
  test('45° pose com ângulo ~120° → score alto', () => {
    // Construir vetores que formem 120° no gonion
    // gonion em (0.4, 0.6); tragus em (0.4, 0.4) (acima);
    // mento em (0.5732, 0.7) — ângulo 120°
    const photo = facePhoto('45_left', {
      172: { x: 0.4, y: 0.6 },      // gonion L
      234: { x: 0.4, y: 0.4 },      // tragus L (acima)
      152: { x: 0.5732, y: 0.7 },   // mento
    });
    const m = mandibularAngle([photo], 'left');
    expect(m).not.toBeNull();
    expect(m.value_raw).toBeGreaterThan(110);
    expect(m.value_raw).toBeLessThan(130);
    expect(m.score).toBeGreaterThan(60);
  });

  test('sem pose disponível → null', () => {
    expect(mandibularAngle([facePhoto('frontal')], 'left')).toBeNull();
  });
});

describe('headTiltRoll', () => {
  test('olhos nivelados → roll ~0 e score 100', () => {
    const photo = facePhoto('frontal', {
      33: { x: 0.4, y: 0.5 },
      263: { x: 0.6, y: 0.5 },
    });
    const m = headTiltRoll([photo]);
    expect(m.score).toBe(100);
    expect(m.value_raw).toBeLessThan(0.1);
  });

  test('cabeça muito inclinada (>10°) → score 0', () => {
    const photo = facePhoto('frontal', {
      33: { x: 0.4, y: 0.5 },
      263: { x: 0.6, y: 0.6 },  // ~27° de roll
    });
    const m = headTiltRoll([photo]);
    expect(m.score).toBe(0);
  });
});

describe('interocularDistance', () => {
  test('mensura distância e retorna score neutro 50', () => {
    const photo = facePhoto('frontal', {
      33: { x: 0.4, y: 0.5 },
      263: { x: 0.6, y: 0.5 },
    });
    const m = interocularDistance([photo]);
    expect(m.score).toBe(50);
    expect(m.value_raw).toBeCloseTo(0.2, 2);
  });
});

// ---------------------------------------------------------------------------
// Métricas corporais
// ---------------------------------------------------------------------------

describe('postureShoulderAsymmetry', () => {
  test('ombros nivelados → score 100', () => {
    const photo = bodyPhoto('body_front', {
      11: { y: 0.30 },
      12: { y: 0.30 },
    });
    expect(postureShoulderAsymmetry([photo]).score).toBe(100);
  });

  test('ombros muito desalinhados (>5%) → score 0', () => {
    const photo = bodyPhoto('body_front', {
      11: { y: 0.30 },
      12: { y: 0.40 },
    });
    expect(postureShoulderAsymmetry([photo]).score).toBe(0);
  });
});

describe('postureHipAsymmetry', () => {
  test('quadris nivelados → score 100', () => {
    const photo = bodyPhoto('body_front', {
      23: { y: 0.55 },
      24: { y: 0.55 },
    });
    expect(postureHipAsymmetry([photo]).score).toBe(100);
  });
});

describe('waistHipRatioVisual', () => {
  test('proporção shoulder/hip OK + confidence low', () => {
    const photo = bodyPhoto('body_front', {
      11: { x: 0.30 },
      12: { x: 0.70 },
      23: { x: 0.35 },
      24: { x: 0.65 },
    });
    const m = waistHipRatioVisual([photo]);
    expect(m.score).toBe(50);
    expect(m.confidence).toBe('low');
    expect(m.value_raw).toBeCloseTo(0.4 / 0.3, 1);
  });
});

describe('postureAlignmentLateral', () => {
  test('head e hip_mid alinhados verticalmente → score 100', () => {
    const photo = bodyPhoto('body_lateral_left', {
      0: { x: 0.5 },
      23: { x: 0.5 },
      24: { x: 0.5 },
    });
    expect(postureAlignmentLateral([photo]).score).toBe(100);
  });

  test('grande desvio horizontal (>8%) → score 0', () => {
    const photo = bodyPhoto('body_lateral_right', {
      0: { x: 0.7 },
      23: { x: 0.5 },
      24: { x: 0.5 },
    });
    const m = postureAlignmentLateral([photo]);
    expect(m.score).toBe(0);
    expect(m.pose_used).toBe('body_lateral_right');
  });

  test('usa lateral_right quando lateral_left ausente', () => {
    const photo = bodyPhoto('body_lateral_right', {
      0: { x: 0.5 }, 23: { x: 0.5 }, 24: { x: 0.5 },
    });
    expect(postureAlignmentLateral([photo])).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Orquestração — computeLandmarkMetrics
// ---------------------------------------------------------------------------

describe('computeLandmarkMetrics — facial', () => {
  test('produz 6 métricas faciais com 5 fotos completas', async () => {
    const photos = [
      facePhoto('frontal', {
        33: { x: 0.3 }, 263: { x: 0.7 },
        10: { y: 0.2 }, 1: { y: 0.5 }, 152: { y: 0.8 },
      }),
      facePhoto('profile_left'),
      facePhoto('profile_right'),
      facePhoto('45_left', {
        172: { x: 0.4, y: 0.6 },
        234: { x: 0.4, y: 0.4 },
        152: { x: 0.5732, y: 0.7 },
      }),
      facePhoto('45_right', {
        397: { x: 0.6, y: 0.6 },
        454: { x: 0.6, y: 0.4 },
        152: { x: 0.4268, y: 0.7 },
      }),
    ];
    const { metrics } = await computeLandmarkMetrics({ photos, analysisType: 'facial' });
    expect(Object.keys(metrics)).toEqual(
      expect.arrayContaining([
        'symmetry_horizontal',
        'proportion_thirds',
        'mandibular_angle_left',
        'mandibular_angle_right',
        'head_tilt_roll',
        'interocular_distance',
      ])
    );
    // Todas com source mediapipe + regions vazio
    for (const v of Object.values(metrics)) {
      expect(v.source).toBe('mediapipe');
      expect(v.regions).toEqual([]);
    }
  });

  test('sem foto frontal → omite métricas que dependem de frontal', async () => {
    const photos = [facePhoto('profile_left')];
    const { metrics } = await computeLandmarkMetrics({ photos, analysisType: 'facial' });
    expect(metrics.symmetry_horizontal).toBeUndefined();
    expect(metrics.proportion_thirds).toBeUndefined();
    expect(metrics.head_tilt_roll).toBeUndefined();
    // mandibular_angle_left ainda OK se 45_left ausente mas profile_left tem dados
  });
});

describe('computeLandmarkMetrics — corporal', () => {
  test('produz 4 métricas corporais com 4 fotos', async () => {
    const photos = [
      bodyPhoto('body_front', {
        11: { x: 0.3, y: 0.3 }, 12: { x: 0.7, y: 0.3 },
        23: { x: 0.35, y: 0.55 }, 24: { x: 0.65, y: 0.55 },
      }),
      bodyPhoto('body_back'),
      bodyPhoto('body_lateral_left', {
        0: { x: 0.5 }, 23: { x: 0.5 }, 24: { x: 0.5 },
      }),
      bodyPhoto('body_lateral_right'),
    ];
    const { metrics } = await computeLandmarkMetrics({ photos, analysisType: 'full_body' });
    expect(Object.keys(metrics)).toEqual(
      expect.arrayContaining([
        'posture_shoulder_asymmetry',
        'posture_hip_asymmetry',
        'waist_hip_ratio_visual',
        'posture_alignment_lateral',
      ])
    );
  });

  test('analysisType=abdomen ainda calcula métricas corporais', async () => {
    const photos = [bodyPhoto('body_front', {
      11: { x: 0.3, y: 0.3 }, 12: { x: 0.7, y: 0.3 },
    })];
    const { metrics } = await computeLandmarkMetrics({ photos, analysisType: 'abdomen' });
    expect(metrics.posture_shoulder_asymmetry).toBeDefined();
  });
});

describe('computeLandmarkMetrics — degradação graciosa', () => {
  test('photos vazio retorna metrics vazio (não throw)', async () => {
    const { metrics } = await computeLandmarkMetrics({ photos: [], analysisType: 'facial' });
    expect(metrics).toEqual({});
  });

  test('photos sem landmarks → métricas omitidas (não throw)', async () => {
    const photos = [{ id: 'x', pose: 'frontal', landmarks: null }];
    const { metrics } = await computeLandmarkMetrics({ photos, analysisType: 'facial' });
    expect(metrics).toEqual({});
  });
});
