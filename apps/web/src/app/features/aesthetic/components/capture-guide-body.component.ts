/**
 * CaptureGuideBodyComponent
 *
 * Análogo ao CaptureGuideFacial mas para análise corporal (tier=advanced).
 * 4 poses sequenciais: body_front → body_back → body_lateral_left → body_lateral_right.
 * Usa MediaPipe PoseLandmarker (33 pts) ao invés de FaceMesh.
 *
 * Heurísticas: FULL_BODY_VISIBLE, POSTURE_NEUTRAL, FEET_ALIGNED,
 * POSE_DIRECTION, FOCUS, EXPOSURE.
 *
 * Spec: docs/superpowers/specs/2026-05-12-aesthetic-v2-fase1-design.md §6.3
 */
import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import {
  CaptureValidatorService,
  FaceValidationResult,
  BodyPose,
  PosePoint,
} from '../services/capture-validator.service';
import { MediaPipeLoaderService } from '../services/mediapipe-loader.service';
import { AestheticFacialService } from '../services/aesthetic-facial.service';
import { humanizeError, waitForVideoDimensions } from '../services/capture-error-handling';

interface CapturedPhoto {
  pose: BodyPose;
  photoId: string;
}

const POSE_SEQUENCE: BodyPose[] = [
  'body_front',
  'body_back',
  'body_lateral_left',
  'body_lateral_right',
];

const POSE_LABEL: Record<BodyPose, string> = {
  body_front: 'Frente',
  body_back: 'Costas',
  body_lateral_left: 'Lateral esquerda',
  body_lateral_right: 'Lateral direita',
};

const POSE_HINT: Record<BodyPose, string> = {
  body_front: 'Fique de frente para a câmera, braços relaxados ao lado do corpo.',
  body_back: 'Vire-se de costas, mantenha postura neutra.',
  body_lateral_left: 'Vire o lado ESQUERDO para a câmera, olhe pra frente.',
  body_lateral_right: 'Vire o lado DIREITO para a câmera, olhe pra frente.',
};

@Component({
  selector: 'app-capture-guide-body',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  styles: [`
    :host { display: block; }

    .capture-wrap {
      display: flex; flex-direction: column; align-items: center;
      gap: 1rem; padding: 1rem;
      color: #dae2fd;
    }
    .stage {
      position: relative;
      width: 100%; max-width: 380px; aspect-ratio: 9/16;
      background: #000; border-radius: 12px; overflow: hidden;
      border: 3px solid rgba(245, 158, 11, 0.4);
    }
    .stage.approved { border-color: #10b981; }
    video, canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    video { object-fit: cover; }
    canvas.preview { display: none; }

    .target-overlay {
      position: absolute; inset: 0;
      pointer-events: none;
      display: flex; align-items: center; justify-content: center;
    }
    .target-body {
      width: 40%; height: 92%;
      border: 2px dashed rgba(255, 255, 255, 0.7);
      border-radius: 30px;
    }

    .pose-progress {
      display: flex; gap: 0.5rem;
      width: 100%; max-width: 380px;
      justify-content: space-between;
    }
    .pose-step {
      flex: 1; height: 6px; border-radius: 3px;
      background: rgba(192, 193, 255, 0.15);
    }
    .pose-step.done { background: #10b981; }
    .pose-step.active { background: linear-gradient(90deg, #f59e0b, #ec4899); }

    h3 { margin: 0; font-size: 1.05rem; }
    p.hint { margin: 0; font-size: 0.88rem; color: #9b9aad; text-align: center; max-width: 380px; }

    .checklist {
      list-style: none; margin: 0; padding: 0;
      display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem 1rem;
      font-size: 0.8rem;
      width: 100%; max-width: 380px;
    }
    .check-item { display: flex; align-items: center; gap: 0.4rem; }
    .check-icon { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
    .check-icon.ok { background: #10b981; }
    .check-icon.fail { background: #ef4444; }

    .actions {
      display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center;
      width: 100%;
    }
    /* Mobile portrait: video + checklist empurram botões pra fora do viewport.
       Sticky bottom garante CTA sempre visível (ver capture-guide-facial). */
    @media (max-width: 768px) {
      .actions {
        position: sticky;
        bottom: 0;
        background: #1a1f33;
        padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0));
        margin: 0 -1rem -1rem;
        border-top: 1px solid rgba(192, 193, 255, 0.1);
        z-index: 10;
      }
    }

    .error-banner {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.25);
      color: #ef4444;
      padding: 0.6rem 0.9rem;
      border-radius: 6px;
      font-size: 0.85rem;
      max-width: 380px;
    }
  `],
  template: `
    <div class="capture-wrap" data-testid="capture-guide-body">

      @if (loading()) {
        <p class="hint">Carregando MediaPipe Pose (~10s na primeira vez)...</p>
      }

      @if (error()) {
        <div class="error-banner" data-testid="capture-error">{{ error() }}</div>
      }

      <div class="pose-progress" data-testid="pose-progress">
        @for (p of poseSequence; track p; let i = $index) {
          <div class="pose-step"
               [class.done]="capturedCount() > i"
               [class.active]="capturedCount() === i"></div>
        }
      </div>

      <h3 data-testid="pose-label">
        Pose {{ capturedCount() + 1 }} de {{ poseSequence.length }}:
        {{ currentPoseLabel() }}
      </h3>

      <p class="hint">{{ currentHint() }}</p>

      <div class="stage" [class.approved]="lastValidation()?.approved">
        <video #video autoplay playsinline muted></video>
        <canvas #preview class="preview" width="240" height="320"></canvas>
        <div class="target-overlay">
          <div class="target-body"></div>
        </div>
      </div>

      @if (lastValidation(); as v) {
        <ul class="checklist" data-testid="checklist">
          @for (issue of v.issues; track issue.code) {
            <li class="check-item">
              <span class="check-icon" [class.ok]="issue.ok" [class.fail]="!issue.ok"></span>
              <span>{{ issue.message }}</span>
            </li>
          }
        </ul>
      }

      <!-- Botão de captura SEMPRE habilitado (UX). Cor muda conforme
           validação aprovou ou não. Botão "Pular validação" removido —
           agora o próprio Capturar serve como fallback. -->
      <div class="actions">
        <button mat-flat-button
                [color]="canCapture() ? 'primary' : 'accent'"
                data-testid="btn-capture"
                (click)="captureCurrent()">
          📷
          @if (capturedCount() < poseSequence.length - 1) {
            {{ canCapture() ? 'Capturar e seguir' : 'Capturar mesmo assim' }}
          } @else {
            {{ canCapture() ? 'Capturar e finalizar' : 'Finalizar mesmo assim' }}
          }
        </button>
        <button mat-button
                data-testid="btn-cancel"
                (click)="cancel.emit()">
          Cancelar
        </button>
      </div>
    </div>
  `,
})
export class CaptureGuideBodyComponent implements OnInit, OnDestroy {
  private readonly validator = inject(CaptureValidatorService);
  private readonly mediaLoader = inject(MediaPipeLoaderService);
  private readonly svc = inject(AestheticFacialService);
  private readonly destroyRef = inject(DestroyRef);

  @Input({ required: true }) subjectId!: string;
  @Input({ required: true }) sessionId!: string;
  /** photo_type a registrar no backend (full_body, abdomen, etc). */
  @Input() photoType = 'full_body_front';

  @Output() complete = new EventEmitter<{ photoIds: string[]; sessionId: string }>();
  @Output() cancel = new EventEmitter<void>();

  readonly poseSequence = POSE_SEQUENCE;
  readonly captured = signal<CapturedPhoto[]>([]);
  readonly capturedCount = computed(() => this.captured().length);
  readonly currentPose = computed<BodyPose | null>(() => {
    const i = this.capturedCount();
    return i < POSE_SEQUENCE.length ? POSE_SEQUENCE[i] : null;
  });
  readonly currentPoseLabel = computed(() => {
    const p = this.currentPose();
    return p ? POSE_LABEL[p] : '';
  });
  readonly currentHint = computed(() => {
    const p = this.currentPose();
    return p ? POSE_HINT[p] : 'Captura concluída.';
  });

  readonly lastValidation = signal<FaceValidationResult | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly canCapture = computed(() => !!this.lastValidation()?.approved && !this.loading());

  @ViewChild('video', { static: true }) videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('preview', { static: true }) previewRef!: ElementRef<HTMLCanvasElement>;

  private stream?: MediaStream;
  private rafId?: number;
  private lastLandmarks?: PosePoint[];
  private destroyed = false;

  async ngOnInit(): Promise<void> {
    try {
      await this._startCamera();
      const landmarker = await this.mediaLoader.getPoseLandmarker();
      this.loading.set(false);
      this._loop(landmarker);
    } catch (e) {
      this.error.set(this._humanizeError(e));
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this._stopCamera();
  }

  async captureCurrent(): Promise<void> {
    if (!this.lastLandmarks) {
      this.error.set('Aguardando detecção. Posicione-se na moldura e aguarde alguns segundos.');
      return;
    }
    if (this.loading()) return;
    const pose = this.currentPose();
    if (!pose) return;

    try {
      this.error.set(null);
      const blob = await this._snapshotJpeg();
      const photoId = await this._uploadPhoto(blob, pose, this.lastLandmarks);
      const captured: CapturedPhoto[] = [...this.captured(), { pose, photoId }];
      this.captured.set(captured);

      if (captured.length === POSE_SEQUENCE.length) {
        this.complete.emit({
          photoIds: captured.map(c => c.photoId),
          sessionId: this.sessionId,
        });
      }
    } catch (e) {
      this.error.set(this._humanizeError(e));
    }
  }

  async skipValidation(): Promise<void> {
    if (!this.lastLandmarks) {
      this.error.set('Aguardando detecção. Posicione-se na moldura.');
      return;
    }
    const pose = this.currentPose();
    if (!pose) return;
    try {
      const blob = await this._snapshotJpeg();
      const photoId = await this._uploadPhoto(blob, pose, this.lastLandmarks);
      const captured: CapturedPhoto[] = [...this.captured(), { pose, photoId }];
      this.captured.set(captured);
      if (captured.length === POSE_SEQUENCE.length) {
        this.complete.emit({
          photoIds: captured.map(c => c.photoId),
          sessionId: this.sessionId,
        });
      }
    } catch (e) {
      this.error.set(this._humanizeError(e));
    }
  }

  // -------------------------------------------------------------------------

  private async _startCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Câmera não suportada neste dispositivo/navegador.');
    }
    // Câmera traseira (environment) pra corpo inteiro — paciente posa, outra
    // pessoa fotografa. Permite fallback pra user se environment não disponível.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: false,
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: false,
      });
    }
    this.stream = stream;
    const video = this.videoRef.nativeElement;
    video.srcObject = stream;
    await video.play();
  }

  private _stopCamera(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = undefined;
  }

  private _loop(landmarker: import('@mediapipe/tasks-vision').PoseLandmarker): void {
    if (this.destroyed) return;

    try {
      const video = this.videoRef.nativeElement;
      const canvas = this.previewRef.nativeElement;
      const ctx = canvas.getContext('2d');

      if (video.readyState >= 2 && ctx && video.videoWidth > 0 && video.videoHeight > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const tsMs = performance.now();
        const result = this.mediaLoader.detectPoseForVideo(landmarker, video, tsMs);
        const lm = result.landmarks?.[0];
        if (lm && lm.length === 33) {
          const pts: PosePoint[] = lm.map(p => ({
            x: p.x, y: p.y, z: p.z ?? 0,
            visibility: (p as { visibility?: number }).visibility,
          }));
          this.lastLandmarks = pts;
          const pose = this.currentPose();
          if (pose) {
            this.lastValidation.set(this.validator.validateBody(pts, canvas, pose));
          }
        } else {
          this.lastLandmarks = undefined;
          this.lastValidation.set(null);
        }
      }
    } catch (loopErr) {
      console.error('[CaptureGuideBody] loop falhou — desativando detecção:', loopErr);
      this.error.set(
        'Detecção corporal indisponível neste dispositivo. ' +
        'Use "Pular validação" pra capturar manualmente.',
      );
      return;
    }

    this.rafId = requestAnimationFrame(() => this._loop(landmarker));
  }

  private async _snapshotJpeg(): Promise<Blob> {
    const video = this.videoRef.nativeElement;
    // iOS Safari pode reportar videoWidth=0 nos primeiros frames; aguarda
    // até 2s. Fallback 720x1280 (aspect ratio corporal portrait).
    const { width: w, height: h } = await waitForVideoDimensions(video, 2000, 720, 1280);

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Falha ao criar canvas de snapshot.');
    try {
      ctx.drawImage(video, 0, 0, w, h);
    } catch (drawErr) {
      throw new Error(`drawImage falhou: ${drawErr instanceof Error ? drawErr.message : 'erro'}`);
    }
    return await new Promise<Blob>((resolve, reject) => {
      try {
        c.toBlob(
          b => b ? resolve(b) : reject(new Error('toBlob retornou null (canvas pode estar vazio)')),
          'image/jpeg',
          0.92,
        );
      } catch (tbErr) {
        reject(new Error(`toBlob throw: ${tbErr instanceof Error ? tbErr.message : 'erro'}`));
      }
    });
  }

  private async _uploadPhoto(
    blob: Blob,
    pose: BodyPose,
    landmarks: PosePoint[],
  ): Promise<string> {
    const lmPayload = {
      type: 'body',
      provider: 'mediapipe',
      provider_version: this.mediaLoader.version,
      model: 'pose_landmarker_v1',
      points: landmarks,
      detected_at: new Date().toISOString(),
    };
    const fd = new FormData();
    fd.append('file', blob, `${pose}.jpg`);
    fd.append('subject_id', this.subjectId);
    fd.append('photo_type', this.photoType);
    fd.append('pose', pose);
    fd.append('session_id', this.sessionId);
    fd.append('landmarks', JSON.stringify(lmPayload));

    const resp = await new Promise<{ id: string }>((resolve, reject) => {
      this.svc.uploadPhotoV2(fd).subscribe({
        next: (r) => resolve(r),
        error: (e) => reject(e),
      });
    });
    return resp.id;
  }

  private _humanizeError(e: unknown): string {
    return humanizeError(e, '[CaptureGuideBody]');
  }
}
