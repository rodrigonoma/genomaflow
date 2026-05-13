/**
 * MediaPipeLoaderService
 *
 * Lazy singleton para FaceLandmarker (468 pts) e PoseLandmarker (33 pts).
 * Importa dinamicamente @mediapipe/tasks-vision pra não inflar o main bundle
 * (~10MB de WASM). Só carrega quando o esteticista efetivamente entra na
 * captura guiada (tier=advanced).
 *
 * Single-flight: chamadas concorrentes a getFaceLandmarker() retornam a
 * MESMA Promise enquanto o loading está em curso, evitando 2 fetches
 * paralelos do WASM. Após resolver, retorna instância cacheada.
 *
 * Spec: docs/superpowers/specs/2026-05-12-aesthetic-v2-fase1-design.md §8.1-8.2
 */
import { Injectable, signal } from '@angular/core';
import type {
  FaceLandmarker,
  PoseLandmarker,
  FaceLandmarkerResult,
  PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.16/wasm';

const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

@Injectable({ providedIn: 'root' })
export class MediaPipeLoaderService {
  /** Versão exposta para incluir em landmarks.provider_version (audit). */
  readonly version = '0.10.16';

  /** True enquanto a primeira carga de qualquer landmarker está em curso. */
  readonly loading = signal(false);

  private faceLandmarker?: FaceLandmarker;
  private poseLandmarker?: PoseLandmarker;
  private loadingFace?: Promise<FaceLandmarker>;
  private loadingPose?: Promise<PoseLandmarker>;

  // -------------------------------------------------------------------------
  // Face Landmarker (468 pontos)
  // -------------------------------------------------------------------------

  async getFaceLandmarker(): Promise<FaceLandmarker> {
    if (this.faceLandmarker) return this.faceLandmarker;
    if (this.loadingFace) return this.loadingFace;

    this.loading.set(true);
    this.loadingFace = (async () => {
      try {
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
        const resolver = await FilesetResolver.forVisionTasks(WASM_BASE);
        const lm = await FaceLandmarker.createFromOptions(resolver, {
          baseOptions: {
            modelAssetPath: FACE_MODEL_URL,
            delegate: 'GPU',
          },
          outputFaceBlendshapes: false,
          runningMode: 'VIDEO',
          numFaces: 1,
        });
        this.faceLandmarker = lm;
        return lm;
      } finally {
        this.loading.set(false);
      }
    })();
    return this.loadingFace;
  }

  // -------------------------------------------------------------------------
  // Pose Landmarker (33 pontos)
  // -------------------------------------------------------------------------

  async getPoseLandmarker(): Promise<PoseLandmarker> {
    if (this.poseLandmarker) return this.poseLandmarker;
    if (this.loadingPose) return this.loadingPose;

    this.loading.set(true);
    this.loadingPose = (async () => {
      try {
        const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
        const resolver = await FilesetResolver.forVisionTasks(WASM_BASE);
        const lm = await PoseLandmarker.createFromOptions(resolver, {
          baseOptions: {
            modelAssetPath: POSE_MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
        this.poseLandmarker = lm;
        return lm;
      } finally {
        this.loading.set(false);
      }
    })();
    return this.loadingPose;
  }

  /**
   * Detecta landmarks faciais num frame de vídeo. Retorna primeiro rosto
   * detectado (numFaces=1) ou null se nenhum rosto presente.
   */
  detectFaceForVideo(
    landmarker: FaceLandmarker,
    video: HTMLVideoElement,
    timestampMs: number,
  ): FaceLandmarkerResult {
    return landmarker.detectForVideo(video, timestampMs);
  }

  detectPoseForVideo(
    landmarker: PoseLandmarker,
    video: HTMLVideoElement,
    timestampMs: number,
  ): PoseLandmarkerResult {
    return landmarker.detectForVideo(video, timestampMs);
  }
}
