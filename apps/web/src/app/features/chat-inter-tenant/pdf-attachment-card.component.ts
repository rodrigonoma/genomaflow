import { Component, Input, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ChatService } from './chat.service';
import { MessageAttachment, PdfAttachmentPayload } from '../../shared/models/chat.models';

@Component({
  selector: 'app-pdf-attachment-card',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatSnackBarModule],
  styles: [`
    :host { display: block; margin-top: 0.5rem; }
    .card {
      background: #111929; border: 1px solid rgba(192,193,255,0.25);
      border-radius: 8px; padding: 0.75rem 0.875rem;
      display: flex; align-items: center; gap: 0.75rem;
      max-width: 440px;
    }
    .icon-wrap {
      background: rgba(255,180,171,0.1); border: 1px solid rgba(255,180,171,0.3);
      border-radius: 6px; padding: 0.375rem;
      display: flex; align-items: center; justify-content: center;
    }
    .icon-wrap mat-icon { color: #ffb4ab; font-size: 20px; width: 20px; height: 20px; }
    .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.125rem; }
    .filename {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 0.8125rem; color: #dae2fd;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .meta {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #7c7b8f;
      display: flex; align-items: center; gap: 0.375rem;
    }
    .pii-badge {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      padding: 1px 5px; border-radius: 2px;
      background: rgba(74,214,160,0.1); color: #4ad6a0;
      border: 1px solid rgba(74,214,160,0.2);
    }
    .action-btn { color: #c0c1ff; }
  `],
  template: `
    <div class="card">
      <div class="icon-wrap">
        <mat-icon>picture_as_pdf</mat-icon>
      </div>
      <div class="info">
        <span class="filename">{{ filename() }}</span>
        <div class="meta">
          <span>PDF</span>
          @if (attachment.original_size_bytes) {
            <span>· {{ formatSize(attachment.original_size_bytes) }}</span>
          }
          <span class="pii-badge">🛡 Verificado LGPD</span>
        </div>
      </div>
      <button mat-icon-button class="action-btn" matTooltip="Baixar" [disabled]="loading()" (click)="open()">
        <mat-icon>{{ loading() ? 'hourglass_empty' : 'download' }}</mat-icon>
      </button>
    </div>
  `
})
export class PdfAttachmentCardComponent {
  @Input() attachment!: MessageAttachment;

  private chat = inject(ChatService);
  private snack = inject(MatSnackBar);
  loading = signal(false);

  filename(): string {
    const p = this.attachment.payload as PdfAttachmentPayload | undefined;
    return p?.filename || 'documento.pdf';
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  open() {
    this.loading.set(true);
    this.chat.getAttachmentSignedUrl(this.attachment.id).subscribe({
      next: ({ url }) => {
        this.loading.set(false);
        window.open(url, '_blank', 'noopener');
      },
      error: (err) => {
        this.loading.set(false);
        this.snack.open(err.error?.error || 'Falha ao gerar link.', 'Fechar', { duration: 4000 });
      }
    });
  }
}
