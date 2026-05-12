/**
 * AutoCropPreviewModalComponent
 *
 * Exibe lado a lado a foto original vs a versão com auto-blur aplicado
 * pelo endpoint POST /aesthetic/photos/preview-blur.
 *
 * Emite ao fechar:
 *   { confirmed: true,  autoCrop: true  } → esteticista aceita o blur → upload com auto_crop=true
 *   { confirmed: true,  autoCrop: false } → esteticista quer enviar sem blur
 *   { confirmed: false }                  → cancelado
 *
 * Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md §6.7 / TODO#5
 */
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Inject,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { AestheticFacialService } from '../services/aesthetic-facial.service';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AutoCropPreviewModalData {
  /** Arquivo original selecionado pela esteticista */
  originalFile: File;
  /** UUID do sujeito (subject_id) para o consent gate */
  subjectId: string;
}

export interface AutoCropPreviewModalResult {
  confirmed: boolean;
  /** Apenas presente quando confirmed=true */
  autoCrop?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-auto-crop-preview-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatProgressSpinnerModule, MatDialogModule],
  styles: [`
    :host { display: block; }

    .preview-dialog {
      font-family: 'Inter', sans-serif;
      color: #dae2fd;
      min-width: 320px;
    }

    .dialog-title {
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 1rem;
      color: #dae2fd;
    }

    .images-row {
      display: flex;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .img-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
    }

    .img-panel img {
      width: 100%;
      max-height: 280px;
      object-fit: contain;
      border-radius: 8px;
      border: 1px solid rgba(70,69,84,0.4);
      background: #1a1a2e;
    }

    .img-label {
      font-size: 11px;
      color: #9b9aad;
      text-align: center;
    }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(139, 92, 246, 0.2);
      color: #a78bfa;
      border: 1px solid rgba(139, 92, 246, 0.4);
      margin-top: 4px;
    }

    .badge.zero {
      background: rgba(107, 114, 128, 0.2);
      color: #9ca3af;
      border-color: rgba(107, 114, 128, 0.4);
    }

    .loading-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      padding: 2rem 0;
      color: #9b9aad;
      font-size: 13px;
    }

    .error-msg {
      color: #ff6b6b;
      font-size: 13px;
      text-align: center;
      padding: 1rem 0;
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .actions-row {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }

    .disclaimer {
      font-size: 11px;
      color: #7c7b8f;
      text-align: center;
      padding: 0.75rem 0 0;
      border-top: 1px solid rgba(70,69,84,0.2);
      margin-top: 0.75rem;
    }

    .disclaimer span {
      color: #f9c74f;
    }
  `],
  template: `
    <div class="preview-dialog">
      <h2 class="dialog-title">Preview do Auto-blur</h2>

      @if (loading()) {
        <div class="loading-wrap">
          <mat-spinner diameter="36"></mat-spinner>
          <span>Aplicando auto-blur via IA…</span>
        </div>
      } @else if (errorMsg()) {
        <p class="error-msg">{{ errorMsg() }}</p>
        <div class="actions-row" style="justify-content:flex-end;margin-top:.5rem">
          <button mat-button (click)="cancel()">Fechar</button>
        </div>
      } @else {
        <div class="images-row">
          <div class="img-panel">
            <img [src]="originalUrl()" alt="Original" />
            <span class="img-label">Original</span>
          </div>
          <div class="img-panel">
            <img [src]="blurredUrl()" alt="Com auto-blur" />
            <span class="img-label">Com auto-blur</span>
            @if (regionsCount() > 0) {
              <span class="badge">{{ regionsCount() }} {{ regionsCount() === 1 ? 'região borrada' : 'regiões borradas' }}</span>
            } @else {
              <span class="badge zero">Nenhuma região detectada</span>
            }
          </div>
        </div>

        <div class="actions">
          <div class="actions-row">
            <button mat-button (click)="cancel()">Cancelar</button>
            <button mat-stroked-button (click)="acceptWithoutBlur()">
              Enviar SEM blur (já está pronto)
            </button>
            <button mat-flat-button color="primary" (click)="acceptWithBlur()">
              Aceitar e enviar com blur
            </button>
          </div>
        </div>

        <p class="disclaimer">
          <span>Atenção:</span> Auto-blur é assistido por IA e pode falhar. Revise a imagem antes de enviar.
        </p>
      }
    </div>
  `,
})
export class AutoCropPreviewModalComponent implements OnInit, OnDestroy {

  private readonly service = inject(AestheticFacialService);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly loading = signal(true);
  readonly errorMsg = signal<string | null>(null);
  readonly originalUrl = signal<string>('');
  readonly blurredUrl = signal<string>('');
  readonly regionsCount = signal(0);

  private _originalObjectUrl = '';
  private _blurredObjectUrl = '';

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: AutoCropPreviewModalData,
    private dialogRef: MatDialogRef<AutoCropPreviewModalComponent, AutoCropPreviewModalResult>,
  ) {}

  async ngOnInit(): Promise<void> {
    // Objeto URL para o original — revogado no destroy
    this._originalObjectUrl = URL.createObjectURL(this.data.originalFile);
    this.originalUrl.set(this._originalObjectUrl);

    try {
      const response = await firstValueFrom(
        this.service.previewBlur(this.data.originalFile, this.data.subjectId),
      );

      const applied = Number(response.headers.get('x-auto-crop-applied') ?? '0');
      const regions = Number(response.headers.get('x-auto-crop-regions') ?? '0');
      this.regionsCount.set(regions > 0 ? regions : applied);

      const blob = response.body as Blob;
      this._blurredObjectUrl = URL.createObjectURL(blob);
      this.blurredUrl.set(this._blurredObjectUrl);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao gerar preview. Tente novamente.';
      this.errorMsg.set(msg);
    } finally {
      this.loading.set(false);
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy(): void {
    if (this._originalObjectUrl) URL.revokeObjectURL(this._originalObjectUrl);
    if (this._blurredObjectUrl) URL.revokeObjectURL(this._blurredObjectUrl);
  }

  acceptWithBlur(): void {
    this.dialogRef.close({ confirmed: true, autoCrop: true });
  }

  acceptWithoutBlur(): void {
    this.dialogRef.close({ confirmed: true, autoCrop: false });
  }

  cancel(): void {
    this.dialogRef.close({ confirmed: false });
  }
}
