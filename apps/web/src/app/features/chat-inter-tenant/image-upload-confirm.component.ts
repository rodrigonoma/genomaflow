import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';

export interface ImageUploadDialogData {
  filename: string;
  mime_type: string;
  data_url: string;  // data URL incluindo prefixo data:image/...
  size_bytes: number;
}

@Component({
  selector: 'app-image-upload-confirm',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatIconModule, MatButtonModule, MatCheckboxModule],
  styles: [`
    :host { display: block; background: #0b1326; color: #dae2fd; }
    .wrap { padding: 1.25rem; max-width: 520px; }
    h2 {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.125rem; color: #c0c1ff; margin: 0 0 0.75rem;
    }
    .preview {
      background: #060d20; border-radius: 6px; padding: 0.5rem;
      margin-bottom: 1rem; max-height: 320px; overflow: hidden;
      display: flex; align-items: center; justify-content: center;
    }
    .preview img { max-width: 100%; max-height: 300px; display: block; object-fit: contain; }
    .filename {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #7c7b8f; margin-bottom: 1rem;
    }
    .warning {
      background: rgba(255,180,171,0.06);
      border-left: 3px solid #ffb4ab;
      padding: 0.75rem 1rem; margin-bottom: 1rem;
      color: #dae2fd; font-size: 0.8125rem; line-height: 1.5;
    }
    .warning strong { color: #ffb4ab; }
    .confirm-row {
      display: flex; align-items: flex-start; gap: 0.5rem;
      padding: 0.75rem; background: rgba(192,193,255,0.06);
      border-radius: 4px; margin-bottom: 1rem;
    }
    .actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
  `],
  template: `
    <div class="wrap">
      <h2>Confirmar envio da imagem</h2>

      <div class="preview">
        <img [src]="data.data_url" [alt]="data.filename"/>
      </div>
      <div class="filename">{{ data.filename }} · {{ formatSize(data.size_bytes) }}</div>

      <div class="warning">
        <strong>⚠ Sua responsabilidade:</strong> verifique a imagem e garanta que ela
        <strong>não contém nome, CPF, RG, endereço, foto identificável ou outros dados pessoais</strong>
        do paciente antes de enviar. O filtro automático de PII ainda não cobre imagens nesta versão.
      </div>

      <div class="confirm-row">
        <mat-checkbox [(ngModel)]="confirmed" color="primary"></mat-checkbox>
        <label style="font-size: 0.8125rem; line-height: 1.5; cursor: pointer" (click)="confirmed.set(!confirmed())">
          Confirmo que revisei a imagem e <strong>removi ou cobri</strong> todos os dados
          pessoais identificáveis do paciente. Assumo responsabilidade por este envio.
        </label>
      </div>

      <div class="actions">
        <button mat-button (click)="ref.close(false)">Cancelar</button>
        <button mat-flat-button style="background:#c0c1ff;color:#1000a9;font-weight:700"
                [disabled]="!confirmed()"
                (click)="ref.close(true)">
          Enviar imagem
        </button>
      </div>
    </div>
  `
})
export class ImageUploadConfirmComponent {
  data: ImageUploadDialogData = inject(MAT_DIALOG_DATA);
  ref = inject(MatDialogRef<ImageUploadConfirmComponent, boolean>);
  confirmed = signal(false);

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
