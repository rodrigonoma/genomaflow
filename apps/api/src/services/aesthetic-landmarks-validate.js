'use strict';

/**
 * aesthetic-landmarks-validate
 *
 * Validação server-side do JSON de landmarks que o cliente envia junto
 * com cada foto no tier=advanced. Cliente envia foto + landmarks
 * pré-calculados (MediaPipe Web durante captura guiada). Servidor confia
 * mas valida shape rigorosamente — defesa em profundidade contra input
 * malicioso ou outdated.
 *
 * Spec: docs/superpowers/specs/2026-05-12-aesthetic-v2-fase1-design.md §5.4
 */

const FACE_POINTS = 468;
const BODY_POINTS = 33;

const VALID_PROVIDERS = new Set(['mediapipe']);

const FACE_POSES = new Set([
  'frontal', 'profile_left', 'profile_right', '45_left', '45_right',
]);

const BODY_POSES = new Set([
  'body_front', 'body_back', 'body_lateral_left', 'body_lateral_right',
]);

const ALL_POSES = new Set([...FACE_POSES, ...BODY_POSES]);

// Tolerância pra extrapolação leve fora do frame [-1, 2]:
// MediaPipe pode emitir pontos ligeiramente fora se o landmark estiver
// no limite da imagem (oclusão por borda).
const MIN_COORD = -1;
const MAX_COORD = 2;

function isValidPoint(p) {
  if (!p || typeof p !== 'object') return false;
  const { x, y, z } = p;
  return Number.isFinite(x) && x >= MIN_COORD && x <= MAX_COORD
      && Number.isFinite(y) && y >= MIN_COORD && y <= MAX_COORD
      && Number.isFinite(z) && z >= MIN_COORD && z <= MAX_COORD;
}

/**
 * Valida shape de landmarks. Retorna { valid: true } ou
 * { valid: false, error: 'CÓDIGO_DO_ERRO' }.
 *
 * @param {object|null} lm  Landmarks payload do cliente
 * @param {string}     pose Pose declarada na mesma foto (validada antes)
 */
function validateLandmarks(lm, pose) {
  if (!lm || typeof lm !== 'object') {
    return { valid: false, error: 'LANDMARKS_MISSING' };
  }

  // Whitelist de providers — só mediapipe por enquanto
  if (!VALID_PROVIDERS.has(lm.provider)) {
    return { valid: false, error: 'INVALID_PROVIDER' };
  }

  if (lm.type !== 'face' && lm.type !== 'body') {
    return { valid: false, error: 'INVALID_TYPE' };
  }

  if (!Array.isArray(lm.points)) {
    return { valid: false, error: 'POINTS_NOT_ARRAY' };
  }

  const expected = lm.type === 'face' ? FACE_POINTS : BODY_POINTS;
  if (lm.points.length !== expected) {
    return {
      valid: false,
      error: `POINTS_COUNT_${lm.points.length}_EXPECTED_${expected}`,
    };
  }

  if (!lm.points.every(isValidPoint)) {
    return { valid: false, error: 'POINT_OUT_OF_RANGE' };
  }

  // Coerência type ↔ pose (defesa contra cliente que manda face landmarks
  // num upload de body_front, por exemplo)
  if (pose) {
    const isFace = FACE_POSES.has(pose);
    const isBody = BODY_POSES.has(pose);
    if (lm.type === 'face' && !isFace) {
      return { valid: false, error: 'TYPE_POSE_MISMATCH' };
    }
    if (lm.type === 'body' && !isBody) {
      return { valid: false, error: 'TYPE_POSE_MISMATCH' };
    }
  }

  return { valid: true };
}

/**
 * Valida pose declarada — true para válida, false para inválida.
 * Helper exposto pra reuso em routes.
 */
function isValidPose(pose) {
  return ALL_POSES.has(pose);
}

module.exports = {
  validateLandmarks,
  isValidPose,
  FACE_POINTS,
  BODY_POINTS,
  FACE_POSES,
  BODY_POSES,
  ALL_POSES,
};
