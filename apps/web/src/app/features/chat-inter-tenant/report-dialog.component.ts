import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ChatService } from './chat.service';

export interface ReportDialogData {
  reported_tenant_id: string;
  reported_tenant_name: string;
}

@Component({
  selector: 'app-report-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatSnackBarModule],
  styles: [`
    :host { display: block; background: #0b1326; color: #dae2fd; }
    .wrap { padding: 1.5rem; max-width: 500px; }
    h2 {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.125rem; color: #ffb4ab; margin: 0 0 0.5rem;
    }
    .target {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #7c7b8f; margin-bottom: 1rem;
    }
    .warning {
      background: rgba(255,203,107,0.06); border-left: 3px solid #ffcb6b;
      padding: 0.625rem 0.875rem; font-size: 0.8125rem; line-height: 1.5;
      margin-bottom: 1rem;
    }
    textarea {
      width: 100%; min-height: 120px; resize: vertical;
      padding: 0.625rem 0.875rem; font-size: 0.8125rem; font-family: inherit;
      background: #171f33; color: #dae2fd;
      border: 1px solid rgba(70,69,84,0.25); border-radius: 4px; outline: none;
      box-sizing: border-box;
    }
    textarea:focus { border-color: #c0c1ff; }
    .count {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #7c7b8f; margin-top: 0.25rem; text-align: right;
    }
    .actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
  `],
  template: `
    <div class="wrap">
      <h2>⚠ Reportar clínica</h2>
      <div class="target">Denunciando: <strong style="color:#dae2fd">{{ data.reported_tenant_name }}</strong></div>

      <div class="warning">
        Denúncias falsas ou frívolas podem resultar em suspensão da sua própria conta no chat.
        Use apenas para comportamento abusivo, spam ou violação das normas de uso.
      </div>

      <textarea [(ngModel)]="reason" placeholder="Descreva detalhadamente o motivo da denúncia (mín 10 caracteres)…" maxlength="2000"></textarea>
      <div class="count">{{ reason.length }}/2000</div>

      <div class="actions">
        <button mat-button (click)="ref.close(false)">Cancelar</button>
        <button mat-flat-button style="background:#ffb4ab;color:#0b1326;font-weight:700"
                [disabled]="reason.trim().length < 10 || sending()"
                (click)="submit()">
          {{ sending() ? 'Enviando…' : 'Enviar denúncia' }}
        </button>
      </div>
    </div>
  `
})
export class ReportDialogComponent {
  data: ReportDialogData = inject(MAT_DIALOG_DATA);
  ref = inject(MatDialogRef<ReportDialogComponent, boolean>);
  private chat = inject(ChatService);
  private snack = inject(MatSnackBar);

  reason = '';
  sending = signal(false);

  submit() {
    if (this.reason.trim().length < 10) return;
    this.sending.set(true);
    this.chat.reportTenant(this.data.reported_tenant_id, this.reason.trim()).subscribe({
      next: () => {
        this.snack.open('Denúncia registrada. Agradecemos a ajuda.', '', { duration: 4000 });
        this.ref.close(true);
      },
      error: (err) => {
        this.sending.set(false);
        this.snack.open(err.error?.error || 'Erro ao enviar.', 'Fechar', { duration: 5000 });
      }
    });
  }
}
