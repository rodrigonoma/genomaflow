/**
 * PhotoUploaderComponent
 *
 * Recebe array de File[] (do photo-quality-guide), valida cada arquivo via
 * PhotoValidatorService, comprime via canvas (JPEG q=0.85) e faz POST para
 * /aesthetic/photos via AestheticFacialService.
 *
 * Emite uploadComplete(string[]) quando todos os uploads terminam e
 * uploadError({ file, error }) para cada arquivo inválido ou falha de upload.
 *
 * Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md §5.2
 */
import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { PhotoValidatorService } from '../services/photo-validator.service';
import { AestheticFacialService } from '../services/aesthetic-facial.service';
import {
  AutoCropPreviewModalComponent,
  AutoCropPreviewModalData,
  AutoCropPreviewModalResult,
} from './auto-crop-preview-modal.component';

// ---------------------------------------------------------------------------
// Inline message constants (MVP — small enough to keep here)
// ---------------------------------------------------------------------------

const MSG = {
  validating: (name: string) => `Validando ${name}…`,
  uploading: (name: string) => `Enviando ${name}…`,
  warning: (name: string, w: string) => `⚠️ ${name}: ${w}`,
  error: (name: string, e: string) => `❌ ${name}: ${e}`,
  uploadFailed: (name: string, e: string) => `Falha ao enviar ${name}: ${e}`,
  done: 'Upload concluído.',
  cancelled: 'Upload cancelado.',
} as const;

// ---------------------------------------------------------------------------
// File status
// ---------------------------------------------------------------------------

export type FileStatus = 'pending' | 'validating' | 'uploading' | 'done' | 'error' | 'warning';

export interface FileEntry {
  file: File;
  status: FileStatus;
  statusText: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-photo-uploader',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatCheckboxModule, MatProgressBarModule, FormsModule],
  styles: [`
    :host { display: block; }

    .uploader-container {
      font-family: 'Inter', sans-serif;
      color: #9b9aad;
      font-size: 13px;
    }

    .file-list {
      list-style: none;
      margin: 0 0 1rem;
      padding: 0;
    }

    .file-list li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0;
      border-bottom: 1px solid rgba(70,69,84,0.1);
    }

    .file-list li:last-child { border-bottom: none; }

    .status-icon { font-size: 14px; flex-shrink: 0; }
    .file-name { flex: 1; color: #dae2fd; }
    .status-text { color: #7c7b8f; font-size: 11px; }

    .progress-wrap {
      margin-bottom: 1rem;
    }

    .messages {
      list-style: none;
      margin: 0.75rem 0 0;
      padding: 0;
    }

    .messages li {
      font-size: 12px;
      color: #9b9aad;
      line-height: 1.5;
      padding: 0.2rem 0;
    }

    .messages li.is-error { color: #ff6b6b; }
    .messages li.is-warning { color: #f9c74f; }

    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 1rem;
    }
  `],
  template: `
    <div class="uploader-container">

      @if (entries().length > 0) {
        <ul class="file-list">
          @for (entry of entries(); track $index) {
            <li>
              <span class="status-icon">{{ statusIcon(entry.status) }}</span>
              <span class="file-name">{{ entry.file.name }}</span>
              <span class="status-text">{{ entry.statusText }}</span>
            </li>
          }
        </ul>
      }

      @if (uploading()) {
        <div class="progress-wrap">
          <mat-progress-bar mode="determinate" [value]="progress()"></mat-progress-bar>
        </div>
      }

      @if (messages().length > 0) {
        <ul class="messages">
          @for (msg of messages(); track $index) {
            <li [class.is-error]="msg.type === 'error'" [class.is-warning]="msg.type === 'warning'">
              {{ msg.text }}
            </li>
          }
        </ul>
      }

      @if (uploading()) {
        <div class="actions">
          <button mat-button (click)="cancel()">Cancelar</button>
        </div>
      }

    </div>
  `,
})
export class PhotoUploaderComponent {

  // ---------------------------------------------------------------------------
  // Injections
  // ---------------------------------------------------------------------------

  private readonly validator = inject(PhotoValidatorService);
  private readonly facialService = inject(AestheticFacialService);
  private readonly dialog = inject(MatDialog);

  // ---------------------------------------------------------------------------
  // Inputs
  // ---------------------------------------------------------------------------

  @Input() subjectId!: string;
  @Input() photoType!: string;
  /**
   * Writable signal holding the files to upload.
   * NOTE for Task 24 (orchestrator): bind via `comp.files.set(selectedFiles)`
   * instead of template `[files]="..."` — Angular @Input + signal() does NOT
   * use the Angular 18 `input()` reactive-input API and won't react to template
   * binding. Call `.set()` directly after receiving `photosSelected` from
   * PhotoQualityGuideComponent.
   */
  @Input() files = signal<File[]>([]);

  /**
   * Quando true, o upload será feito com is_sensitive=true no backend.
   * Se previewBlurEnabled também for true, abre o preview antes do envio.
   */
  @Input() isSensitive = false;

  /**
   * Quando true E isSensitive=true, exibe o modal de preview auto-blur antes
   * de cada upload sensível. O usuário pode aceitar com blur, sem blur, ou cancelar.
   * Default: false (opt-in explícito).
   */
  @Input() previewBlurEnabled = false;

  // ---------------------------------------------------------------------------
  // Outputs
  // ---------------------------------------------------------------------------

  @Output() readonly uploadComplete = new EventEmitter<string[]>();
  @Output() readonly uploadError = new EventEmitter<{ file: string; error: string }>();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  readonly uploading = signal(false);
  readonly progress = signal(0);
  readonly messages = signal<Array<{ text: string; type: 'info' | 'warning' | 'error' }>>([]);
  readonly entries = signal<FileEntry[]>([]);

  private _cancelled = false;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Called externally (or by parent) to start the upload pipeline. */
  async startUpload(): Promise<void> {
    const fileList = this.files();
    if (!fileList || fileList.length === 0) return;

    this._cancelled = false;
    this.uploading.set(true);
    this.progress.set(0);
    this.messages.set([]);
    this.entries.set(fileList.map(f => ({ file: f, status: 'pending', statusText: '' })));

    const photoIds: string[] = [];
    const total = fileList.length;

    for (let i = 0; i < fileList.length; i++) {
      if (this._cancelled) break;

      const file = fileList[i];

      // --- Validate ---
      this._updateEntry(i, 'validating', MSG.validating(file.name));

      let result;
      try {
        result = await this.validator.validate(file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro de validação';
        this._addMessage(`❌ ${file.name}: ${msg}`, 'error');
        this._updateEntry(i, 'error', msg);
        this.uploadError.emit({ file: file.name, error: msg });
        this.progress.set(Math.round(((i + 1) / total) * 100));
        continue;
      }

      if (!result.valid) {
        const errMsg = result.error ?? 'Arquivo inválido';
        this._addMessage(MSG.error(file.name, errMsg), 'error');
        this._updateEntry(i, 'error', errMsg);
        this.uploadError.emit({ file: file.name, error: errMsg });
        this.progress.set(Math.round(((i + 1) / total) * 100));
        continue;
      }

      // Warning — show but continue
      if (result.warning) {
        this._addMessage(MSG.warning(file.name, result.warning), 'warning');
      }

      // --- Compress ---
      let blob: Blob;
      try {
        blob = await this._compressImage(file);
      } catch {
        // Canvas not available (e.g., jsdom) — use original file
        blob = file;
      }

      // --- Preview blur (opt-in: isSensitive + previewBlurEnabled) ---
      let autoCrop: boolean | undefined;
      if (this.isSensitive && this.previewBlurEnabled) {
        this._updateEntry(i, 'validating', 'Aguardando confirmação do preview de blur…');
        let previewResult: AutoCropPreviewModalResult | undefined;
        try {
          previewResult = await firstValueFrom(
            this.dialog.open<AutoCropPreviewModalComponent, AutoCropPreviewModalData, AutoCropPreviewModalResult>(
              AutoCropPreviewModalComponent,
              { data: { originalFile: file, subjectId: this.subjectId }, width: '720px', maxWidth: '95vw' },
            ).afterClosed(),
          );
        } catch {
          // Dialog closed unexpectedly — treat as cancel
        }

        if (!previewResult || !previewResult.confirmed) {
          this._addMessage(MSG.cancelled, 'info');
          this._updateEntry(i, 'error', 'Cancelado pelo usuário');
          this.progress.set(Math.round(((i + 1) / total) * 100));
          continue;
        }

        autoCrop = previewResult.autoCrop;
      }

      // --- Upload ---
      this._updateEntry(i, 'uploading', MSG.uploading(file.name));

      const formData = new FormData();
      formData.append('file', blob, file.name);
      formData.append('subject_id', this.subjectId);
      formData.append('photo_type', this.photoType);

      if (this.isSensitive) {
        formData.append('is_sensitive', 'true');
        // autoCrop is only set when previewBlurEnabled; undefined means default (true for sensitive)
        if (autoCrop === false) {
          formData.append('auto_crop', 'false');
        }
      }

      try {
        const photo = await firstValueFrom(this.facialService.uploadPhoto(formData));
        photoIds.push(photo.id);
        this._updateEntry(i, 'done', '');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Erro no upload';
        this._addMessage(MSG.uploadFailed(file.name, errMsg), 'error');
        this._updateEntry(i, 'error', errMsg);
        this.uploadError.emit({ file: file.name, error: errMsg });
      }

      this.progress.set(Math.round(((i + 1) / total) * 100));
    }

    this.uploading.set(false);

    if (!this._cancelled) {
      if (photoIds.length > 0) {
        this._addMessage(MSG.done, 'info');
      }
      this.uploadComplete.emit(photoIds);
    }
  }

  cancel(): void {
    this._cancelled = true;
    this.uploading.set(false);
    this._addMessage(MSG.cancelled, 'info');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  protected statusIcon(status: FileStatus): string {
    switch (status) {
      case 'done':      return '✅';
      case 'error':     return '❌';
      case 'warning':   return '⚠️';
      case 'uploading': return '⬆️';
      case 'validating': return '🔍';
      default:          return '📷';
    }
  }

  private _updateEntry(index: number, status: FileStatus, statusText: string): void {
    this.entries.update(list => {
      const next = [...list];
      next[index] = { ...next[index], status, statusText };
      return next;
    });
  }

  private _addMessage(text: string, type: 'info' | 'warning' | 'error'): void {
    this.messages.update(msgs => [...msgs, { text, type }]);
  }

  /**
   * Compresses a File to JPEG at quality 0.85 via canvas.
   * In jsdom (no real canvas), canvas.toBlob returns null — callers should
   * catch and fall back to the original file.
   */
  private _compressImage(file: File): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }

        ctx.drawImage(img, 0, 0);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas toBlob returned null'));
            }
          },
          'image/jpeg',
          0.85,
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Falha ao carregar imagem para compressão'));
      };

      img.src = objectUrl;
    });
  }
}
