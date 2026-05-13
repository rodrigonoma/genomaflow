/**
 * CaptureValidatorService
 *
 * 7 heurísticas client-side rodadas frame-a-frame durante o preview da
 * captura guiada (tier=advanced). Todas executam em <5ms em hardware
 * razoável, suportando 15-30 fps de feedback live sem ping pra servidor.
 *
 * Heurísticas faciais:
 *   1. POSE          yaw aproximado pela diferença Z entre olhos vs pose esperada
 *   2. EYES_OPEN     EAR (eye aspect ratio) > 0.2
 *   3. MOUTH_CLOSED  MAR (mouth aspect ratio) < 0.5
 *   4. CENTERED      bbox center próximo a 0.5 horizontal e vertical
 *   5. FOCUS         Laplacian variance no canvas crop do rosto > threshold
 *   6. EXPOSURE      histogram mean ∈ [70, 180]
 *   7. (futuro)      sem filtro de beleza / fundo neutro (desativados V1)
 *
 * Spec: docs/superpowers/specs/2026-05-12-aesthetic-v2-fase1-design.md §6.2
 */
import { Injectable } from '@angular/core';

export type FacialPose =
  | 'frontal'
  | 'profile_left'
  | 'profile_right'
  | '45_left'
  | '45_right';

export type BodyPose =
  | 'body_front'
  | 'body_back'
  | 'body_lateral_left'
  | 'body_lateral_right';

/** Ponto MediaPipe Pose: x, y, z normalizados + visibility (0-1). */
export interface PosePoint extends Point3D {
  visibility?: number;
}

export interface ValidationIssue {
  code: string;
  message: string;
  ok: boolean;
}

export interface FaceValidationResult {
  approved: boolean;
  score: number; // 0-1
  issues: ValidationIssue[];
  yawDeg: number;
}

export interface Point3D { x: number; y: number; z: number }

// MediaPipe Face Mesh canonical indices (uso interno)
const IDX = {
  LEFT_EYE_OUTER: 33,
  RIGHT_EYE_OUTER: 263,
  // EAR esquerdo: outer, top-outer, top-inner, inner, bottom-inner, bottom-outer
  LEFT_EYE_EAR: [33, 160, 158, 133, 153, 144],
  UPPER_LIP_CENTER: 13,
  LOWER_LIP_CENTER: 14,
  MOUTH_CORNER_L: 78,
  MOUTH_CORNER_R: 308,
};

@Injectable({ providedIn: 'root' })
export class CaptureValidatorService {

  /** Yaw em radianos pela diferença Z entre olhos (positivo = girado pra direita). */
  yawFromLandmarks(pts: Point3D[]): number {
    const l = pts[IDX.LEFT_EYE_OUTER];
    const r = pts[IDX.RIGHT_EYE_OUTER];
    return Math.atan2(r.z - l.z, r.x - l.x);
  }

  /** EAR — eye aspect ratio. Olho aberto típico ~0.25-0.35; fechado <0.2. */
  eyeAspectRatio(pts: Point3D[], idx = IDX.LEFT_EYE_EAR): number {
    const p = idx.map(i => pts[i]);
    const v1 = Math.hypot(p[1].x - p[5].x, p[1].y - p[5].y);
    const v2 = Math.hypot(p[2].x - p[4].x, p[2].y - p[4].y);
    const h  = Math.hypot(p[0].x - p[3].x, p[0].y - p[3].y);
    return (v1 + v2) / (2 * h);
  }

  /** MAR — mouth aspect ratio. Boca fechada ~0.0-0.1; aberta >0.5. */
  mouthAspectRatio(pts: Point3D[]): number {
    const v = Math.hypot(
      pts[IDX.UPPER_LIP_CENTER].x - pts[IDX.LOWER_LIP_CENTER].x,
      pts[IDX.UPPER_LIP_CENTER].y - pts[IDX.LOWER_LIP_CENTER].y,
    );
    const h = Math.hypot(
      pts[IDX.MOUTH_CORNER_L].x - pts[IDX.MOUTH_CORNER_R].x,
      pts[IDX.MOUTH_CORNER_L].y - pts[IDX.MOUTH_CORNER_R].y,
    );
    return h > 0 ? v / h : 0;
  }

  /** Centro do rosto (média dos pontos). */
  centerFromLandmarks(pts: Point3D[]): { cx: number; cy: number } {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { cx: sx / pts.length, cy: sy / pts.length };
  }

  /**
   * Laplacian variance num canvas grayscale. Quanto maior, mais nítido.
   * >100 em VGA ~ foco aceitável; <50 é desfocado.
   */
  laplacianVariance(canvas: HTMLCanvasElement): number {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;
    const w = canvas.width, h = canvas.height;
    if (w < 3 || h < 3) return 0;
    const { data } = ctx.getImageData(0, 0, w, h);

    // Converte para grayscale em Float32Array
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const j = i * 4;
      gray[i] = 0.299 * data[j] + 0.587 * data[j+1] + 0.114 * data[j+2];
    }

    // Aplica kernel Laplacian 3x3 [[0,1,0],[1,-4,1],[0,1,0]]
    let sum = 0, sumSq = 0, count = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const lap = -4 * gray[i]
                  + gray[i - 1] + gray[i + 1]
                  + gray[i - w] + gray[i + w];
        sum += lap;
        sumSq += lap * lap;
        count++;
      }
    }
    if (count === 0) return 0;
    const mean = sum / count;
    return sumSq / count - mean * mean;
  }

  /** Média de luminância do canvas (0-255). */
  histogramMean(canvas: HTMLCanvasElement): number {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += (data[i] + data[i+1] + data[i+2]) / 3;
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  // -------------------------------------------------------------------------
  // Validação composta — 7 heurísticas faciais
  // -------------------------------------------------------------------------

  validateFace(
    landmarks: Point3D[],
    canvas: HTMLCanvasElement,
    expectedPose: FacialPose,
  ): FaceValidationResult {
    const issues: ValidationIssue[] = [];

    const yaw = this.yawFromLandmarks(landmarks);
    const yawDeg = Math.abs(yaw * 180 / Math.PI);

    // 1) POSE
    const poseOk = this._poseMatches(expectedPose, yawDeg);
    issues.push({
      code: 'POSE',
      ok: poseOk,
      message: poseOk ? 'Pose OK' : `Ajuste a pose: ${this._poseLabel(expectedPose)}`,
    });

    // 2) EYES_OPEN
    const ear = this.eyeAspectRatio(landmarks);
    issues.push({
      code: 'EYES_OPEN',
      ok: ear > 0.2,
      message: ear > 0.2 ? 'Olhos abertos' : 'Abra os olhos',
    });

    // 3) MOUTH_CLOSED
    const mar = this.mouthAspectRatio(landmarks);
    issues.push({
      code: 'MOUTH_CLOSED',
      ok: mar < 0.5,
      message: mar < 0.5 ? 'Boca fechada' : 'Mantenha a boca fechada',
    });

    // 4) CENTERED
    const { cx, cy } = this.centerFromLandmarks(landmarks);
    const centerOk = Math.abs(cx - 0.5) < 0.15 && Math.abs(cy - 0.5) < 0.15;
    issues.push({
      code: 'CENTERED',
      ok: centerOk,
      message: centerOk ? 'Centralizado' : 'Centralize o rosto na moldura',
    });

    // 5) FOCUS
    const focus = this.laplacianVariance(canvas);
    issues.push({
      code: 'FOCUS',
      ok: focus > 100,
      message: focus > 100 ? 'Foco OK' : 'Foco insuficiente — segure firme',
    });

    // 6) EXPOSURE
    const expo = this.histogramMean(canvas);
    const expoOk = expo > 70 && expo < 180;
    issues.push({
      code: 'EXPOSURE',
      ok: expoOk,
      message: expoOk ? 'Iluminação OK' : expo <= 70 ? 'Muito escuro' : 'Muito claro',
    });

    const okCount = issues.filter(i => i.ok).length;
    return {
      approved: okCount === issues.length,
      score: okCount / issues.length,
      issues,
      yawDeg,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers privados
  // -------------------------------------------------------------------------

  private _poseMatches(expected: FacialPose, yawDeg: number): boolean {
    if (expected === 'frontal') return yawDeg < 10;
    if (expected === 'profile_left' || expected === 'profile_right') return yawDeg > 60;
    if (expected === '45_left' || expected === '45_right') return yawDeg >= 30 && yawDeg <= 50;
    return false;
  }

  private _poseLabel(p: FacialPose): string {
    switch (p) {
      case 'frontal': return 'olhe para frente';
      case 'profile_left': return 'gire 90° para a esquerda';
      case 'profile_right': return 'gire 90° para a direita';
      case '45_left': return 'gire 45° para a esquerda';
      case '45_right': return 'gire 45° para a direita';
    }
  }

  // =========================================================================
  // BODY validation — MediaPipe Pose Landmarker (33 pts)
  // =========================================================================

  /**
   * Validação corporal com heurísticas:
   *  1. FULL_BODY_VISIBLE  head (0) + ankles (27, 28) com visibility > 0.5
   *  2. POSTURE_NEUTRAL    torso vertical (ombros 11,12 e quadril 23,24 alinhados verticalmente)
   *  3. FEET_ALIGNED       |ankle_left.x - ankle_right.x| < 0.15
   *  4. POSE_DIRECTION     pose declarada coerente com orientação detectada (ombros visíveis ou não)
   *  5. FOCUS              Laplacian variance > 100
   *  6. EXPOSURE           histogram mean ∈ [70, 180]
   */
  validateBody(
    landmarks: PosePoint[],
    canvas: HTMLCanvasElement,
    expectedPose: BodyPose,
  ): FaceValidationResult {
    const issues: ValidationIssue[] = [];

    // 1) FULL_BODY_VISIBLE
    const head = landmarks[0];
    const ankleL = landmarks[27];
    const ankleR = landmarks[28];
    const visOk = !!head && !!ankleL && !!ankleR
      && (head.visibility ?? 1) > 0.5
      && (ankleL.visibility ?? 1) > 0.5
      && (ankleR.visibility ?? 1) > 0.5;
    issues.push({
      code: 'FULL_BODY_VISIBLE',
      ok: visOk,
      message: visOk ? 'Corpo inteiro enquadrado' : 'Enquadre da cabeça aos pés',
    });

    // 2) POSTURE_NEUTRAL — eixos torso vertical
    let postureOk = false;
    if (landmarks[11] && landmarks[12] && landmarks[23] && landmarks[24]) {
      const shoulderMidX = (landmarks[11].x + landmarks[12].x) / 2;
      const hipMidX = (landmarks[23].x + landmarks[24].x) / 2;
      postureOk = Math.abs(shoulderMidX - hipMidX) < 0.06;
    }
    issues.push({
      code: 'POSTURE_NEUTRAL',
      ok: postureOk,
      message: postureOk ? 'Postura neutra' : 'Mantenha o tronco alinhado verticalmente',
    });

    // 3) FEET_ALIGNED
    let feetOk = false;
    if (ankleL && ankleR) {
      feetOk = Math.abs(ankleL.x - ankleR.x) < 0.20 && Math.abs(ankleL.y - ankleR.y) < 0.05;
    }
    issues.push({
      code: 'FEET_ALIGNED',
      ok: feetOk,
      message: feetOk ? 'Pés alinhados' : 'Mantenha os pés na mesma linha',
    });

    // 4) POSE_DIRECTION
    // Heurística simples: lateral_left tem ombro direito (12) bem mais "atrás"
    // (z maior) que o esquerdo (11); body_front tem z aproximado em ambos.
    let poseDirOk = false;
    if (landmarks[11] && landmarks[12]) {
      const dz = (landmarks[12].z ?? 0) - (landmarks[11].z ?? 0);
      const absDz = Math.abs(dz);
      if (expectedPose === 'body_front') {
        poseDirOk = absDz < 0.15;
      } else if (expectedPose === 'body_back') {
        // Não dá pra distinguir muito de body_front via mediapipe pose 2D;
        // usar visibilidade do nariz/olhos como proxy (front=visíveis, back=ocluídos).
        const nose = landmarks[0];
        const noseVis = nose?.visibility ?? 1;
        poseDirOk = absDz < 0.15 && noseVis < 0.5; // costas: rosto deve estar ocluído/baixa vis
      } else if (expectedPose === 'body_lateral_left') {
        poseDirOk = dz > 0.15;
      } else if (expectedPose === 'body_lateral_right') {
        poseDirOk = dz < -0.15;
      }
    }
    issues.push({
      code: 'POSE_DIRECTION',
      ok: poseDirOk,
      message: poseDirOk ? 'Pose OK' : this._bodyPoseLabel(expectedPose),
    });

    // 5) FOCUS
    const focus = this.laplacianVariance(canvas);
    issues.push({
      code: 'FOCUS',
      ok: focus > 100,
      message: focus > 100 ? 'Foco OK' : 'Foco insuficiente — peça pra alguém segurar o celular',
    });

    // 6) EXPOSURE
    const expo = this.histogramMean(canvas);
    const expoOk = expo > 70 && expo < 180;
    issues.push({
      code: 'EXPOSURE',
      ok: expoOk,
      message: expoOk ? 'Iluminação OK' : expo <= 70 ? 'Muito escuro' : 'Muito claro',
    });

    const okCount = issues.filter(i => i.ok).length;
    return {
      approved: okCount === issues.length,
      score: okCount / issues.length,
      issues,
      yawDeg: 0, // não aplicável a corporal — campo mantido pra compat de interface
    };
  }

  private _bodyPoseLabel(p: BodyPose): string {
    switch (p) {
      case 'body_front': return 'Fique de frente para a câmera';
      case 'body_back': return 'Vire de costas para a câmera';
      case 'body_lateral_left': return 'Vire o lado ESQUERDO para a câmera';
      case 'body_lateral_right': return 'Vire o lado DIREITO para a câmera';
    }
  }
}
