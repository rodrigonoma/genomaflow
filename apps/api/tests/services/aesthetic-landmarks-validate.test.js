'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
  validateLandmarks,
  isValidPose,
  FACE_POINTS,
  BODY_POINTS,
} = require('../../src/services/aesthetic-landmarks-validate');

// Fixture helpers
const validPoint = { x: 0.5, y: 0.5, z: 0 };
function makeFacePoints() { return Array(FACE_POINTS).fill(validPoint); }
function makeBodyPoints() { return Array(BODY_POINTS).fill(validPoint); }
function makeFaceLandmarks(overrides = {}) {
  return {
    type: 'face',
    provider: 'mediapipe',
    provider_version: '0.10.16',
    model: 'face_landmarker_v1',
    points: makeFacePoints(),
    detected_at: '2026-05-12T00:00:00Z',
    ...overrides,
  };
}
function makeBodyLandmarks(overrides = {}) {
  return {
    type: 'body',
    provider: 'mediapipe',
    provider_version: '0.10.16',
    model: 'pose_landmarker_v1',
    points: makeBodyPoints(),
    detected_at: '2026-05-12T00:00:00Z',
    ...overrides,
  };
}

describe('validateLandmarks — face', () => {
  test('468 pts válidos + pose frontal → { valid: true }', () => {
    expect(validateLandmarks(makeFaceLandmarks(), 'frontal')).toEqual({ valid: true });
  });

  test('468 pts + pose profile_left → OK', () => {
    expect(validateLandmarks(makeFaceLandmarks(), 'profile_left')).toEqual({ valid: true });
  });

  test('468 pts + pose 45_right → OK', () => {
    expect(validateLandmarks(makeFaceLandmarks(), '45_right')).toEqual({ valid: true });
  });

  test('467 pts → POINTS_COUNT', () => {
    const lm = makeFaceLandmarks({ points: makeFacePoints().slice(1) });
    expect(validateLandmarks(lm, 'frontal').error).toMatch(/^POINTS_COUNT_467_EXPECTED_468$/);
  });

  test('500 pts → POINTS_COUNT', () => {
    const lm = makeFaceLandmarks({ points: [...makeFacePoints(), ...Array(32).fill(validPoint)] });
    expect(validateLandmarks(lm, 'frontal').error).toMatch(/^POINTS_COUNT_500_EXPECTED_468$/);
  });
});

describe('validateLandmarks — body', () => {
  test('33 pts válidos + pose body_front → OK', () => {
    expect(validateLandmarks(makeBodyLandmarks(), 'body_front')).toEqual({ valid: true });
  });

  test('33 pts + body_lateral_left → OK', () => {
    expect(validateLandmarks(makeBodyLandmarks(), 'body_lateral_left')).toEqual({ valid: true });
  });

  test('32 pts → POINTS_COUNT', () => {
    const lm = makeBodyLandmarks({ points: makeBodyPoints().slice(1) });
    expect(validateLandmarks(lm, 'body_front').error).toMatch(/^POINTS_COUNT_32_EXPECTED_33$/);
  });
});

describe('validateLandmarks — provider/type whitelist', () => {
  test('provider desconhecido → INVALID_PROVIDER', () => {
    const lm = makeFaceLandmarks({ provider: 'openpose' });
    expect(validateLandmarks(lm, 'frontal').error).toBe('INVALID_PROVIDER');
  });

  test('provider null → INVALID_PROVIDER', () => {
    const lm = makeFaceLandmarks({ provider: null });
    expect(validateLandmarks(lm, 'frontal').error).toBe('INVALID_PROVIDER');
  });

  test('type inválido → INVALID_TYPE', () => {
    const lm = makeFaceLandmarks({ type: 'hand' });
    expect(validateLandmarks(lm, 'frontal').error).toBe('INVALID_TYPE');
  });

  test('type=face mas pose corporal → TYPE_POSE_MISMATCH', () => {
    expect(validateLandmarks(makeFaceLandmarks(), 'body_front').error).toBe('TYPE_POSE_MISMATCH');
  });

  test('type=body mas pose facial → TYPE_POSE_MISMATCH', () => {
    expect(validateLandmarks(makeBodyLandmarks(), 'frontal').error).toBe('TYPE_POSE_MISMATCH');
  });
});

describe('validateLandmarks — points range', () => {
  test('ponto x=5 (fora de [-1,2]) → POINT_OUT_OF_RANGE', () => {
    const lm = makeFaceLandmarks();
    lm.points[10] = { x: 5, y: 0.5, z: 0 };
    expect(validateLandmarks(lm, 'frontal').error).toBe('POINT_OUT_OF_RANGE');
  });

  test('ponto y=-5 → POINT_OUT_OF_RANGE', () => {
    const lm = makeFaceLandmarks();
    lm.points[20] = { x: 0.5, y: -5, z: 0 };
    expect(validateLandmarks(lm, 'frontal').error).toBe('POINT_OUT_OF_RANGE');
  });

  test('ponto z=NaN → POINT_OUT_OF_RANGE', () => {
    const lm = makeFaceLandmarks();
    lm.points[30] = { x: 0.5, y: 0.5, z: NaN };
    expect(validateLandmarks(lm, 'frontal').error).toBe('POINT_OUT_OF_RANGE');
  });

  test('ponto sem coords (object vazio) → POINT_OUT_OF_RANGE', () => {
    const lm = makeFaceLandmarks();
    lm.points[40] = {};
    expect(validateLandmarks(lm, 'frontal').error).toBe('POINT_OUT_OF_RANGE');
  });

  test('ponto extrapolação leve dentro de tolerância (x=1.05) → OK', () => {
    const lm = makeFaceLandmarks();
    lm.points[50] = { x: 1.05, y: 0.95, z: 0 };
    expect(validateLandmarks(lm, 'frontal')).toEqual({ valid: true });
  });
});

describe('validateLandmarks — shape básico', () => {
  test('null → LANDMARKS_MISSING', () => {
    expect(validateLandmarks(null, 'frontal').error).toBe('LANDMARKS_MISSING');
  });

  test('undefined → LANDMARKS_MISSING', () => {
    expect(validateLandmarks(undefined, 'frontal').error).toBe('LANDMARKS_MISSING');
  });

  test('string → LANDMARKS_MISSING', () => {
    expect(validateLandmarks('not-an-object', 'frontal').error).toBe('LANDMARKS_MISSING');
  });

  test('points não-array → POINTS_NOT_ARRAY', () => {
    const lm = makeFaceLandmarks({ points: 'not-array' });
    expect(validateLandmarks(lm, 'frontal').error).toBe('POINTS_NOT_ARRAY');
  });
});

describe('isValidPose', () => {
  test('faciais válidas', () => {
    for (const p of ['frontal', 'profile_left', 'profile_right', '45_left', '45_right']) {
      expect(isValidPose(p)).toBe(true);
    }
  });

  test('corporais válidas', () => {
    for (const p of ['body_front', 'body_back', 'body_lateral_left', 'body_lateral_right']) {
      expect(isValidPose(p)).toBe(true);
    }
  });

  test('rejeita inválidas', () => {
    for (const p of ['', null, undefined, 'frontal_left', 'body', 'face']) {
      expect(isValidPose(p)).toBe(false);
    }
  });
});
