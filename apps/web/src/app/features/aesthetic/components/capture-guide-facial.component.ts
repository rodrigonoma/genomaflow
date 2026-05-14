/**
 * CaptureGuideFacialComponent
 *
 * Wizard de captura guiada V2 (tier=advanced). Coordena:
 *   1. webcam stream
 *   2. lazy-load MediaPipe Face Mesh (468 pts)
 *   3. loop de validação live (7 heurísticas → overlay verde/vermelho)
 *   4. snapshot quando todas heurísticas passam
 *   5. upload de cada foto com pose + landmarks JSON
 *   6. emite evento `complete` quando todas as 5 poses estão capturadas
 *
 * Poses sequenciais: frontal → profile_left → profile_right → 45_left → 45_right.
 *
 * Spec: docs/superpowers/specs/2026-05-12-aesthetic-v2-fase1-design.md §4.1, §6
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
  FacialPose,
} from '../services/capture-validator.service';
import { MediaPipeLoaderService } from '../services/mediapipe-loader.service';
import { AestheticFacialService } from '../services/aesthetic-facial.service';
import { humanizeError, waitForVideoDimensions } from '../services/capture-error-handling';

interface CapturedPhoto {
  pose: FacialPose;
  photoId: string;
}

const POSE_SEQUENCE: FacialPose[] = [
  'frontal',
  'profile_left',
  'profile_right',
  '45_left',
  '45_right',
];

const POSE_LABEL: Record<FacialPose, string> = {
  frontal: 'Frontal',
  profile_left: 'Perfil esquerdo',
  profile_right: 'Perfil direito',
  '45_left': 'Diagonal 45° esquerda',
  '45_right': 'Diagonal 45° direita',
};

@Component({
  selector: 'app-capture-guide-facial',
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
      width: 100%; max-width: 480px; aspect-ratio: 3/4;
      background: #000; border-radius: 12px; overflow: hidden;
      border: 3px solid rgba(245, 158, 11, 0.4);
    }
    .stage.approved { border-color: #10b981; }
    video, canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    video { object-fit: cover; }
    canvas.preview { display: none; } /* hidden — só usamos pra detect */

    .target-overlay {
      position: absolute; inset: 0;
      pointer-events: none;
      display: flex; align-items: center; justify-content: center;
    }
    .target-frame {
      width: 60%; height: 75%;
      border: 2px dashed rgba(255, 255, 255, 0.7);
      border-radius: 50%;
    }

    .pose-progress {
      display: flex; gap: 0.5rem;
      width: 100%; max-width: 480px;
      justify-content: space-between;
    }
    .pose-step {
      flex: 1; height: 6px; border-radius: 3px;
      background: rgba(192, 193, 255, 0.15);
    }
    .pose-step.done { background: #10b981; }
    .pose-step.active { background: linear-gradient(90deg, #f59e0b, #ec4899); }

    h3 { margin: 0; font-size: 1.1rem; }
    p.hint { margin: 0; font-size: 0.9rem; color: #9b9aad; text-align: center; }

    .checklist {
      list-style: none; margin: 0; padding: 0;
      display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem 1rem;
      font-size: 0.82rem;
      width: 100%; max-width: 480px;
    }
    .check-item { display: flex; align-items: center; gap: 0.4rem; }
    .check-icon { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
    .check-icon.ok { background: #10b981; }
    .check-icon.fail { background: #ef4444; }

    .actions {
      display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center;
      width: 100%;
    }
    /* Mobile portrait: video + checklist empurram botões pra fora do
       viewport. Sticky bottom garante CTA sempre visível.
       Bug reportado 2026-05-14: 'centralizei rosto e não tem botão'. */
    @media (max-width: 768px) {
      .actions {
        position: sticky;
        bottom: 0;
        background: #1a1f33;
        padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0));
        margin: 0 -1rem -1rem;  /* sangra até as bordas do capture-wrap padding */
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
      max-width: 480px;
    }
  `],
  template: `
    <div class="capture-wrap" data-testid="capture-guide-facial">

      @if (loading()) {
        <p class="hint">
          Carregando MediaPipe (~10s na primeira vez)...
        </p>
      }

      @if (error()) {
        <div class="error-banner" data-testid="capture-error">
          {{ error() }}
        </div>
      }

      <!-- Progresso de poses -->
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

      <!-- Webcam stage -->
      <div class="stage" [class.approved]="lastValidation()?.approved">
        <video #video autoplay playsinline muted></video>
        <canvas #preview class="preview" width="320" height="240"></canvas>
        <div class="target-overlay">
          <div class="target-frame"></div>
        </div>
      </div>

      <!-- Checklist live -->
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

      <!-- Actions -->
      <div class="actions">
        <button mat-flat-button color="primary"
                data-testid="btn-capture"
                [disabled]="!canCapture()"
                (click)="captureCurrent()">
          @if (capturedCount() < poseSequence.length - 1) {
            Capturar e ir para próxima
          } @else {
            Capturar última e finalizar
          }
        </button>
        <button mat-stroked-button
                data-testid="btn-skip-validation"
                (click)="skipValidation()">
          Pular validação
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
export class CaptureGuideFacialComponent implements OnInit, OnDestroy {
  // -------------------------------------------------------------------------
  // Dependencies
  // -------------------------------------------------------------------------

  private readonly validator = inject(CaptureValidatorService);
  private readonly mediaLoader = inject(MediaPipeLoaderService);
  private readonly svc = inject(AestheticFacialService);
  private readonly destroyRef = inject(DestroyRef);

  // -------------------------------------------------------------------------
  // Inputs / Outputs
  // -------------------------------------------------------------------------

  /** Subject (paciente). Obrigatório pra upload. */
  @Input({ required: true }) subjectId!: string;
  /** Session pré-criada (POST /aesthetic/sessions). Obrigatório. */
  @Input({ required: true }) sessionId!: string;

  /** Emite { photoIds, sessionId } quando todas as 5 poses foram capturadas. */
  @Output() complete = new EventEmitter<{ photoIds: string[]; sessionId: string }>();
  @Output() cancel = new EventEmitter<void>();

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  readonly poseSequence = POSE_SEQUENCE;
  readonly captured = signal<CapturedPhoto[]>([]);
  readonly capturedCount = computed(() => this.captured().length);
  readonly currentPose = computed<FacialPose | null>(() => {
    const i = this.capturedCount();
    return i < POSE_SEQUENCE.length ? POSE_SEQUENCE[i] : null;
  });
  readonly currentPoseLabel = computed(() => {
    const p = this.currentPose();
    return p ? POSE_LABEL[p] : '';
  });
  readonly currentHint = computed(() => {
    const p = this.currentPose();
    if (!p) return 'Captura concluída.';
    switch (p) {
      case 'frontal': return 'Olhe direto para a câmera, expressão neutra.';
      case 'profile_left': return 'Gire o rosto 90° para a SUA esquerda.';
      case 'profile_right': return 'Gire o rosto 90° para a SUA direita.';
      case '45_left': return 'Gire o rosto 45° para a SUA esquerda.';
      case '45_right': return 'Gire o rosto 45° para a SUA direita.';
    }
  });

  readonly lastValidation = signal<FaceValidationResult | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly canCapture = computed(() => !!this.lastValidation()?.approved && !this.loading());

  // -------------------------------------------------------------------------
  // ViewChilds
  // -------------------------------------------------------------------------

  @ViewChild('video', { static: true }) videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('preview', { static: true }) previewRef!: ElementRef<HTMLCanvasElement>;

  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  private stream?: MediaStream;
  private rafId?: number;
  private lastLandmarks?: Array<{ x: number; y: number; z: number }>;
  private destroyed = false;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async ngOnInit(): Promise<void> {
    try {
      await this._startCamera();
      const landmarker = await this.mediaLoader.getFaceLandmarker();
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

  // -------------------------------------------------------------------------
  // Capture flow
  // -------------------------------------------------------------------------

  async captureCurrent(): Promise<void> {
    if (!this.canCapture() || !this.lastLandmarks) return;
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

  /** Permite ao usuário subir a foto atual mesmo sem todas as heurísticas OK. */
  async skipValidation(): Promise<void> {
    if (!this.lastLandmarks) {
      this.error.set('Aguardando detecção de rosto. Posicione-se na moldura.');
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
  // Internals — camera, detection loop, snapshot, upload
  // -------------------------------------------------------------------------

  private async _startCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Câmera não suportada neste dispositivo/navegador.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    const video = this.videoRef.nativeElement;
    video.srcObject = this.stream;
    await video.play();
  }

  private _stopCamera(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = undefined;
  }

  private _loop(landmarker: import('@mediapipe/tasks-vision').FaceLandmarker): void {
    if (this.destroyed) return;

    try {
      const video = this.videoRef.nativeElement;
      const canvas = this.previewRef.nativeElement;
      const ctx = canvas.getContext('2d');

      // Aguarda video ter dimensões reais (iOS Safari demora pra reportar)
      if (video.readyState >= 2 && ctx && video.videoWidth > 0 && video.videoHeight > 0) {
        // Snapshot do frame atual no canvas pra Laplacian/histogram
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const tsMs = performance.now();
        const result = this.mediaLoader.detectFaceForVideo(landmarker, video, tsMs);

        const lm = result.faceLandmarks?.[0];
        if (lm && lm.length === 468) {
          const pts = lm.map(p => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
          this.lastLandmarks = pts;
          const pose = this.currentPose();
          if (pose) {
            this.lastValidation.set(this.validator.validateFace(pts, canvas, pose));
          }
        } else {
          this.lastLandmarks = undefined;
          this.lastValidation.set(null);
        }
      }
    } catch (loopErr) {
      // MediaPipe pode lançar em devices que não suportam WebGL/WASM
      // direito (ex: Safari iOS antigo). Loga + para o loop pra evitar
      // spam de error no console. Frontend continua usável via "Pular
      // validação".
      console.error('[CaptureGuide] loop falhou — desativando detecção:', loopErr);
      this.error.set(
        'Detecção facial indisponível neste dispositivo. ' +
        'Use "Pular validação" pra capturar manualmente.',
      );
      return;
    }

    this.rafId = requestAnimationFrame(() => this._loop(landmarker));
  }

  private async _snapshotJpeg(): Promise<Blob> {
    const video = this.videoRef.nativeElement;

    // iOS Safari pode reportar videoWidth=0 nos primeiros frames mesmo com
    // readyState >= 2. Helper aguarda até 2s antes de cair em fallback.
    const { width: w, height: h } = await waitForVideoDimensions(video, 2000, 640, 480);

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
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
          (b) => b ? resolve(b) : reject(new Error('toBlob retornou null (canvas pode estar vazio)')),
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
    pose: FacialPose,
    landmarks: Array<{ x: number; y: number; z: number }>,
  ): Promise<string> {
    const lmPayload = {
      type: 'face',
      provider: 'mediapipe',
      provider_version: this.mediaLoader.version,
      model: 'face_landmarker_v1',
      points: landmarks,
      detected_at: new Date().toISOString(),
    };
    const fd = new FormData();
    fd.append('file', blob, `${pose}.jpg`);
    fd.append('subject_id', this.subjectId);
    fd.append('photo_type', 'facial_front');
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
    return humanizeError(e, '[CaptureGuideFacial]');
  }
}
