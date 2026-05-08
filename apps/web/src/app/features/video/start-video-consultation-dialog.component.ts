import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { VideoService } from './video.service';

export interface StartVideoDialogData {
  appointment_id: string;
  subject_name: string;
  date_label: string;
}

@Component({
  selector: 'app-start-video-consultation-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatRadioModule, MatProgressSpinnerModule],
  styles: [`
    :host { color:#dae2fd; }
    .header { padding:1rem 1.25rem .5rem; display:flex; justify-content:space-between; align-items:center; }
    h2 { font-family:'Space Grotesk',sans-serif; font-size:1rem; font-weight:700; color:#c0c1ff; margin:0; }
    .meta { padding:0 1.25rem .75rem; font-family:'JetBrains Mono',monospace; font-size:11px; color:#908fa0; }
    .body { padding:0 1.25rem 1rem; display:flex; flex-direction:column; gap:1rem; }
    .modality-card {
      background:#171f33; border:1px solid rgba(70,69,84,0.3);
      border-radius:8px; padding:.875rem 1rem; cursor:pointer;
      transition:border-color 150ms;
    }
    .modality-card:hover { border-color:rgba(192,193,255,0.4); }
    .modality-card.selected { border-color:#c0c1ff; background:rgba(192,193,255,0.06); }
    .modality-title { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:.875rem; color:#dae2fd; }
    .modality-credits { font-family:'JetBrains Mono',monospace; font-size:.7rem; color:#c0c1ff; margin:.25rem 0; }
    .modality-desc { font-size:.7rem; color:#908fa0; line-height:1.4; }
    .ai-value { margin-top:.5rem; font-size:.7rem; color:#a09fb2; }
    .ai-value li { margin:.2rem 0; }
    .footer { display:flex; justify-content:flex-end; gap:.75rem; padding:.75rem 1.25rem; border-top:1px solid rgba(70,69,84,0.2); }
    .submit-btn {
      background:#c0c1ff; color:#1000a9; border:none; border-radius:6px;
      padding:.5rem 1.25rem; font-size:.75rem; font-weight:700;
      letter-spacing:.06em; text-transform:uppercase; cursor:pointer;
    }
    .submit-btn:disabled { opacity:.4; cursor:not-allowed; }
    .cancel-btn { background:transparent; color:#a09fb2; border:1px solid rgba(70,69,84,0.3); border-radius:6px; padding:.5rem 1rem; cursor:pointer; font-size:.75rem; }
    .error { color:#ef4444; font-size:.75rem; font-family:'JetBrains Mono',monospace; padding:.5rem 1.25rem; }
    .info-note { font-size:.7rem; color:#6e6d80; background:rgba(70,69,84,0.1); border-radius:5px; padding:.5rem .75rem; }
  `],
  template: `
    <div class="header">
      <h2>📹 Iniciar consulta por vídeo</h2>
      <button mat-icon-button (click)="cancel()"><mat-icon>close</mat-icon></button>
    </div>
    <div class="meta">{{ data.subject_name }} · {{ data.date_label }}</div>

    <div class="body">
      <div class="modality-card" [class.selected]="modality==='simple'" (click)="modality='simple'">
        <div class="modality-title">Consulta Simples</div>
        <div class="modality-credits">2 créditos</div>
        <div class="modality-desc">Vídeo e áudio de alta qualidade via Amazon Chime SDK. Sem transcrição automática.</div>
      </div>

      <div class="modality-card" [class.selected]="modality==='complete'" (click)="modality='complete'">
        <div class="modality-title">✨ Consulta Completa</div>
        <div class="modality-credits">6 créditos · Recomendado</div>
        <div class="modality-desc">Tudo da simples + transcrição automática + análise por IA:</div>
        <ul class="ai-value">
          <li>Prontuário pré-preenchido (SOAP)</li>
          <li>Hipóteses diagnósticas com nível de confiança</li>
          <li>Sugestões de exames e alertas clínicos</li>
          <li>Resumo de 3 linhas na timeline do paciente</li>
        </ul>
      </div>

      <div class="info-note">
        Um link de acesso será enviado automaticamente por <strong>email</strong> e <strong>WhatsApp</strong> para o paciente.
        Ele não precisa criar conta — acessa direto pelo navegador.
      </div>
    </div>

    @if (error()) {
      <div class="error">{{ error() }}</div>
    }

    <div class="footer">
      <button class="cancel-btn" (click)="cancel()">Cancelar</button>
      <button class="submit-btn" [disabled]="!modality || submitting()" (click)="submit()">
        @if (submitting()) { <mat-spinner diameter="14" style="display:inline-block;vertical-align:middle;margin-right:6px;"></mat-spinner> }
        Criar sala e enviar link
      </button>
    </div>
  `
})
export class StartVideoConsultationDialogComponent {
  data: StartVideoDialogData = inject(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<StartVideoConsultationDialogComponent>);
  private router = inject(Router);
  private videoSvc = inject(VideoService);

  modality: 'simple' | 'complete' = 'complete';
  submitting = signal(false);
  error = signal('');

  cancel() { this.ref.close(null); }

  submit() {
    this.submitting.set(true);
    this.error.set('');
    this.videoSvc.create({ appointment_id: this.data.appointment_id, modality: this.modality }).subscribe({
      next: (res) => {
        this.ref.close({ consultation_id: res.consultation_id });
        this.router.navigate(['/clinic/video', res.consultation_id]);
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err.error?.error || 'Erro ao criar sala de vídeo. Tente novamente.');
      },
    });
  }
}
