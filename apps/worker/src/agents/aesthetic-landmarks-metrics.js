'use strict';

/**
 * aesthetic-landmarks-metrics
 *
 * Worker agent V2 (tier=advanced). Lê landmarks gravados no cliente
 * em aesthetic_photos.landmarks (MediaPipe FaceMesh 468 pts ou
 * PoseLandmarker 33 pts) e calcula 10 métricas geométricas:
 *
 * Faciais (6):
 *   symmetry_horizontal      simetria de pontos espelhados
 *   proportion_thirds        regra de ouro testa/nariz/queixo
 *   mandibular_angle_left    ângulo no gonion (tragus, gonion, mento)
 *   mandibular_angle_right   espelhado
 *   head_tilt_roll           inclinação Z entre olhos
 *   interocular_distance     distância normalizada (referência, score neutro)
 *
 * Corporais (4):
 *   posture_shoulder_asymmetry   diferença Y ombro_esq vs ombro_dir
 *   posture_hip_asymmetry        idem quadril
 *   waist_hip_ratio_visual       estimativa 2D shoulder_width/hip_width
 *   posture_alignment_lateral    desvio horizontal head→hip_mid (lateral)
 *
 * Saída: { metrics: Record<string, MetricData> } onde cada métrica tem
 * shape compatível com aesthetic_analyses.metrics existente:
 *   { score: 0-100, value_raw, confidence: 'high'|'low', pose_used,
 *     source: 'mediapipe', regions: [] }
 *
 * Spec: docs/superpowers/specs/2026-05-12-aesthetic-v2-fase1-design.md §5.5, §9
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampScore(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function findPhoto(photos, poses) {
  const candidates = Array.isArray(poses) ? poses : [poses];
  for (const pose of candidates) {
    const p = photos.find(ph => ph && ph.pose === pose && _hasLandmarkPoints(ph));
    if (p) return p;
  }
  return null;
}

function _hasLandmarkPoints(photo) {
  return photo?.landmarks
    && Array.isArray(photo.landmarks.points)
    && photo.landmarks.points.length > 0;
}

function _pt(photo, idx) {
  return photo.landmarks.points[idx];
}

function _angleDeg(v1, v2) {
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m1 = Math.hypot(v1.x, v1.y);
  const m2 = Math.hypot(v2.x, v2.y);
  if (m1 === 0 || m2 === 0) return null;
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  return Math.acos(cos) * 180 / Math.PI;
}

function _baseMetric(score, value_raw, pose_used, confidence = 'high') {
  return {
    score: clampScore(score),
    value_raw,
    confidence,
    regions: [],
    pose_used,
    source: 'mediapipe',
  };
}

// ---------------------------------------------------------------------------
// Métricas faciais — MediaPipe FaceMesh canonical indices
// ---------------------------------------------------------------------------

/**
 * symmetry_horizontal: distância média de pontos espelhados em relação ao eixo
 * vertical do rosto (x=0.5). Quanto mais simétrico, score mais alto.
 */
function symmetryHorizontal(photos) {
  const photo = findPhoto(photos, 'frontal');
  if (!photo) return null;
  // Pares L/R selecionados de regiões visualmente relevantes
  const pairs = [
    [33, 263],   // outer eye corners
    [133, 362],  // inner eye corners
    [61, 291],   // mouth corners
    [205, 425],  // cheek points
    [127, 356],  // jaw outer
  ];
  let sumDist = 0;
  let valid = 0;
  for (const [l, r] of pairs) {
    const pl = _pt(photo, l);
    const pr = _pt(photo, r);
    if (!pl || !pr) continue;
    // |distância_horizontal_esq - distância_horizontal_dir|
    sumDist += Math.abs((0.5 - pl.x) - (pr.x - 0.5));
    valid++;
  }
  if (valid === 0) return null;
  const avgDev = sumDist / valid;
  // avgDev > 5% = score 0; avgDev=0 = score 100
  const score = 100 * (1 - avgDev / 0.05);
  return _baseMetric(score, avgDev, 'frontal');
}

/**
 * proportion_thirds: regra de ouro — testa, nariz, queixo proporção 1:1:1.
 * Score alto se ratio entre os terços é próximo de 1.
 */
function proportionThirds(photos) {
  const photo = findPhoto(photos, 'frontal');
  if (!photo) return null;
  const hairline = _pt(photo, 10);
  const nose = _pt(photo, 1);
  const chin = _pt(photo, 152);
  if (!hairline || !nose || !chin) return null;
  const t1 = nose.y - hairline.y;
  const t2 = chin.y - nose.y;
  if (t1 <= 0 || t2 <= 0) return null;
  const ratio = t1 / t2;
  const dev = Math.abs(ratio - 1);
  const score = 100 * (1 - dev / 0.3);
  return _baseMetric(score, ratio, 'frontal');
}

/**
 * mandibular_angle: ângulo no gonion entre tragus e mento.
 * Faixa ideal estética 110-130°; faixa "perfeita" centrada em 120°.
 */
function mandibularAngle(photos, side) {
  const preferredPoses = side === 'left'
    ? ['45_left', 'profile_left']
    : ['45_right', 'profile_right'];
  const photo = findPhoto(photos, preferredPoses);
  if (!photo) return null;
  // tragus ~ 234 (L) / 454 (R); gonion ~ 172 (L) / 397 (R); mento ~ 152
  const tragusIdx = side === 'left' ? 234 : 454;
  const gonionIdx = side === 'left' ? 172 : 397;
  const tragus = _pt(photo, tragusIdx);
  const gonion = _pt(photo, gonionIdx);
  const mento = _pt(photo, 152);
  if (!tragus || !gonion || !mento) return null;
  const v1 = { x: tragus.x - gonion.x, y: tragus.y - gonion.y };
  const v2 = { x: mento.x - gonion.x, y: mento.y - gonion.y };
  const angleDeg = _angleDeg(v1, v2);
  if (angleDeg == null) return null;
  const ideal = 120;
  const dev = Math.abs(angleDeg - ideal);
  // dev > 20° = score 0
  const score = 100 * (1 - dev / 20);
  return _baseMetric(score, angleDeg, photo.pose);
}

/**
 * head_tilt_roll: inclinação da cabeça em graus (diferença Y entre olhos).
 * Score 100 = perfeitamente nivelada; > 10° = score 0.
 */
function headTiltRoll(photos) {
  const photo = findPhoto(photos, 'frontal');
  if (!photo) return null;
  const leftEye = _pt(photo, 33);
  const rightEye = _pt(photo, 263);
  if (!leftEye || !rightEye) return null;
  const rollRad = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  const rollDeg = Math.abs(rollRad * 180 / Math.PI);
  const score = 100 * (1 - rollDeg / 10);
  return _baseMetric(score, rollDeg, 'frontal');
}

/**
 * interocular_distance: distância normalizada entre olhos.
 * Métrica de referência (não há "bom" ou "ruim") — score neutro 50.
 */
function interocularDistance(photos) {
  const photo = findPhoto(photos, 'frontal');
  if (!photo) return null;
  const l = _pt(photo, 33);
  const r = _pt(photo, 263);
  if (!l || !r) return null;
  const dx = r.x - l.x;
  const dy = r.y - l.y;
  const dist = Math.hypot(dx, dy);
  return _baseMetric(50, dist, 'frontal', 'high');
}

// ---------------------------------------------------------------------------
// Métricas corporais — MediaPipe Pose canonical indices
// ---------------------------------------------------------------------------

/**
 * posture_shoulder_asymmetry: diferença Y entre ombros (11 esq, 12 dir).
 * Score 100 = ombros perfeitamente alinhados; > 5% = score 0.
 */
function postureShoulderAsymmetry(photos) {
  const photo = findPhoto(photos, 'body_front');
  if (!photo) return null;
  const l = _pt(photo, 11);
  const r = _pt(photo, 12);
  if (!l || !r) return null;
  const dy = Math.abs(l.y - r.y);
  const score = 100 * (1 - dy / 0.05);
  return _baseMetric(score, dy, 'body_front');
}

/**
 * posture_hip_asymmetry: análogo, quadris (23 esq, 24 dir).
 */
function postureHipAsymmetry(photos) {
  const photo = findPhoto(photos, 'body_front');
  if (!photo) return null;
  const l = _pt(photo, 23);
  const r = _pt(photo, 24);
  if (!l || !r) return null;
  const dy = Math.abs(l.y - r.y);
  const score = 100 * (1 - dy / 0.05);
  return _baseMetric(score, dy, 'body_front');
}

/**
 * waist_hip_ratio_visual: razão visual largura ombros/largura quadril (2D).
 * Score neutro 50 — referência, não é "bom"/"ruim".
 * confidence='low' por ser estimativa 2D sem profundidade.
 */
function waistHipRatioVisual(photos) {
  const photo = findPhoto(photos, 'body_front');
  if (!photo) return null;
  const lS = _pt(photo, 11);
  const rS = _pt(photo, 12);
  const lH = _pt(photo, 23);
  const rH = _pt(photo, 24);
  if (!lS || !rS || !lH || !rH) return null;
  const shoulderW = Math.abs(lS.x - rS.x);
  const hipW = Math.abs(lH.x - rH.x);
  if (hipW === 0) return null;
  const ratio = shoulderW / hipW;
  return _baseMetric(50, ratio, 'body_front', 'low');
}

/**
 * posture_alignment_lateral: desvio horizontal head→hip_mid em pose lateral.
 * Score 100 = alinhamento perfeito; > 8% = score 0.
 */
function postureAlignmentLateral(photos) {
  const photo = findPhoto(photos, ['body_lateral_left', 'body_lateral_right']);
  if (!photo) return null;
  const head = _pt(photo, 0);
  const lH = _pt(photo, 23);
  const rH = _pt(photo, 24);
  if (!head || !lH || !rH) return null;
  const hipMidX = (lH.x + rH.x) / 2;
  const dx = Math.abs(head.x - hipMidX);
  const score = 100 * (1 - dx / 0.08);
  return _baseMetric(score, dx, photo.pose);
}

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------

const FACIAL_REGIONS = new Set(['facial', 'eyelids', 'neck']);

/**
 * Calcula todas as métricas geométricas aplicáveis ao analysisType.
 * Falha de uma métrica individual (landmarks ausentes ou pose não disponível)
 * é registrada como ausência silenciosa — não bloqueia o restante.
 *
 * @param {Object} params
 * @param {Array<{pose: string, landmarks: {points: Array<{x,y,z}>}}>} params.photos
 * @param {string} params.analysisType
 * @returns {Promise<{ metrics: Object }>}
 */
async function computeLandmarkMetrics({ photos, analysisType }) {
  const out = {};

  if (FACIAL_REGIONS.has(analysisType)) {
    const map = {
      symmetry_horizontal: symmetryHorizontal(photos),
      proportion_thirds: proportionThirds(photos),
      mandibular_angle_left: mandibularAngle(photos, 'left'),
      mandibular_angle_right: mandibularAngle(photos, 'right'),
      head_tilt_roll: headTiltRoll(photos),
      interocular_distance: interocularDistance(photos),
    };
    for (const [k, v] of Object.entries(map)) {
      if (v) out[k] = v;
    }
  } else {
    const map = {
      posture_shoulder_asymmetry: postureShoulderAsymmetry(photos),
      posture_hip_asymmetry: postureHipAsymmetry(photos),
      waist_hip_ratio_visual: waistHipRatioVisual(photos),
      posture_alignment_lateral: postureAlignmentLateral(photos),
    };
    for (const [k, v] of Object.entries(map)) {
      if (v) out[k] = v;
    }
  }

  return { metrics: out };
}

module.exports = {
  computeLandmarkMetrics,
  // Helpers exportados para testes
  symmetryHorizontal,
  proportionThirds,
  mandibularAngle,
  headTiltRoll,
  interocularDistance,
  postureShoulderAsymmetry,
  postureHipAsymmetry,
  waistHipRatioVisual,
  postureAlignmentLateral,
};
