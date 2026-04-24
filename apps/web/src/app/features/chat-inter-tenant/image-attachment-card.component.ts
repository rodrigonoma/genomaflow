import { Component, Input, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ChatService } from './chat.service';
import { MessageAttachment, ImageAttachmentPayload } from '../../shared/models/chat.models';

@Component({
  selector: 'app-image-attachment-card',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatSnackBarModule],
  styles: [`
    :host { display: block; margin-top: 0.5rem; }
    .card {
      background: #111929; border: 1px solid rgba(192,193,255,0.25);
      border-radius: 8px; overflow: hidden; max-width: 440px;
    }
    .thumb-wrap {
      position: relative; cursor: pointer;
      background: #060d20;
      display: flex; align-items: center; justify-content: center;
      min-height: 80px; max-height: 320px;
    }
    .thumb-wrap img {
      max-width: 100%; max-height: 320px; display: block;
      object-fit: contain;
    }
    .placeholder {
      color: #7c7b8f; font-family: 'JetBrains Mono', monospace; font-size: 11px;
      padding: 2rem;
    }
    .loading {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(11,19,38,0.8); color: #c0c1ff; font-size: 0.875rem;
    }
    .meta {
      padding: 0.5rem 0.75rem;
      display: flex; align-items: center; gap: 0.5rem;
      font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #7c7b8f;
      border-top: 1px solid rgba(70,69,84,0.15);
    }
    .filename {
      flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      color: #dae2fd; font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 11px;
    }
    .pii-badge {
      font-size: 9px; padding: 1px 5px; border-radius: 2px;
      background: rgba(74,214,160,0.1); color: #4ad6a0;
      border: 1px solid rgba(74,214,160,0.2);
    }
  `],
  template: `
    <div class="card">
      <div class="thumb-wrap" (click)="openFull()">
        @if (imgUrl()) {
          <img [src]="imgUrl()" [alt]="filename()"/>
        } @else if (loadError()) {
          <div class="placeholder">Imagem não disponível</div>
        } @else {
          <div class="placeholder">Carregando…</div>
        }
        @if (loadingFull()) {
          <div class="loading">Abrindo…</div>
        }
      </div>
      <div class="meta">
        <span class="filename">{{ filename() }}</span>
        @if (attachment.original_size_bytes) {
          <span>{{ formatSize(attachment.original_size_bytes) }}</span>
        }
        <span class="pii-badge">🛡 Confirmado pelo usuário</span>
      </div>
    </div>
  `
})
export class ImageAttachmentCardComponent {
  @Input() attachment!: MessageAttachment;

  private chat = inject(ChatService);
  private snack = inject(MatSnackBar);
  imgUrl = signal<string | null>(null);
  loadingFull = signal(false);
  loadError = signal(false);

  ngOnInit() {
    // Busca signed URL na inicialização (expira 1h — suficiente pra renderizar thumb)
    this.chat.getAttachmentSignedUrl(this.attachment.id).subscribe({
      next: ({ url }) => this.imgUrl.set(url),
      error: () => this.loadError.set(true)
    });
  }

  filename(): string {
    const p = this.attachment.payload as ImageAttachmentPayload | undefined;
    return p?.filename || 'imagem';
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  openFull() {
    if (!this.imgUrl()) return;
    this.loadingFull.set(true);
    window.open(this.imgUrl()!, '_blank', 'noopener');
    setTimeout(() => this.loadingFull.set(false), 500);
  }
}
