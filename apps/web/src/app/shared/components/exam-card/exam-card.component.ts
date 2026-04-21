import { Component, Input, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';
import { ExamStatusComponent } from '../exam-status/exam-status.component';
import { Exam } from '../../models/api.models';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-exam-card',
  standalone: true,
  imports: [RouterModule, DatePipe, MatButtonModule, MatIconModule, ExamStatusComponent],
  styles: [`
    .exam-card {
      background: #111929;
      border: 1px solid rgba(70,69,84,0.2);
      border-left: 3px solid transparent;
      border-radius: 8px;
      padding: 0.875rem 1.125rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.5rem;
      transition: border-color 150ms ease, background 150ms ease;
    }
    .exam-card:hover { background: #131b2e; }
    .exam-card.status-done  { border-left-color: #4ad6a0; }
    .exam-card.status-error { border-left-color: #ffb4ab; background: rgba(255,180,171,0.04); }

    .exam-info { display: flex; align-items: center; gap: 0.875rem; flex: 1; min-width: 0; }
    .exam-filename {
      font-size: 13px; font-weight: 500; color: #dae2fd;
      word-break: break-all;
    }
    .exam-date {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; color: #7c7b8f; margin-top: 3px;
    }
    .error-msg {
      font-size: 12px; color: #ffb4ab; margin-top: 5px;
      display: flex; align-items: center; gap: 5px;
    }
    .error-msg mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .status-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
      padding: 2px 6px; border-radius: 3px;
      margin-top: 5px; display: inline-block;
    }
    .label-processing { background: rgba(192,193,255,0.1); color: #c0c1ff; }
    .label-pending    { background: rgba(160,159,178,0.1); color: #a09fb2; }

    .card-actions { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }

    .view-btn {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 12px; font-weight: 600;
      color: #c0c1ff;
      border: 1px solid rgba(192,193,255,0.25);
      border-radius: 4px;
      padding: 0.3125rem 0.875rem;
      background: rgba(192,193,255,0.05);
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
      transition: all 150ms ease;
    }
    .view-btn:hover {
      background: rgba(192,193,255,0.12);
      border-color: rgba(192,193,255,0.4);
      color: #dae2fd;
    }
    .retry-btn {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 12px; font-weight: 600;
      color: #ffb4ab;
      border: 1px solid rgba(255,180,171,0.3);
      border-radius: 4px;
      padding: 0.3125rem 0.875rem;
      background: rgba(255,180,171,0.07);
      white-space: nowrap;
      cursor: pointer;
      transition: all 150ms ease;
      display: flex; align-items: center; gap: 5px;
    }
    .retry-btn:hover {
      background: rgba(255,180,171,0.14);
      border-color: rgba(255,180,171,0.5);
    }
    .retry-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .retry-btn mat-icon { font-size: 14px; width: 14px; height: 14px; }
  `],
  template: `
    <div class="exam-card" [class]="'status-' + exam.status">
      <div class="exam-info">
        <app-exam-status [status]="exam.status" />
        <div>
          <div class="exam-filename">{{ filename }}</div>
          <div class="exam-date">{{ exam.created_at | date:'dd/MM/yyyy HH:mm' }}</div>
          @if (exam.status === 'error') {
            <div class="error-msg">
              <mat-icon>warning</mat-icon>
              Falha ao processar o laudo. Verifique se o PDF é legível e tente novamente.
            </div>
          }
          @if (exam.status === 'processing') {
            <span class="status-label label-processing">PROCESSANDO...</span>
          }
          @if (exam.status === 'pending') {
            <span class="status-label label-pending">NA FILA</span>
          }
        </div>
      </div>
      <div class="card-actions">
        @if (exam.status === 'done') {
          <a class="view-btn" [routerLink]="['/doctor/results', exam.id]">Ver resultado</a>
        }
        @if (exam.status === 'error') {
          <button class="retry-btn" [disabled]="retrying" (click)="retry()">
            <mat-icon>refresh</mat-icon>
            {{ retrying ? 'Reenviando...' : 'Tentar novamente' }}
          </button>
        }
      </div>
    </div>
  `
})
export class ExamCardComponent {
  @Input() exam!: Exam;

  private http = inject(HttpClient);
  private snack = inject(MatSnackBar);
  retrying = false;

  get filename(): string {
    return this.exam.file_path?.split('/').pop() ?? 'exame.pdf';
  }

  retry(): void {
    this.retrying = true;
    this.http.post(`${environment.apiUrl}/exams/${this.exam.id}/retry`, {}).subscribe({
      next: () => {
        this.exam = { ...this.exam, status: 'pending' };
        this.retrying = false;
        this.snack.open('Laudo reenviado para processamento.', '', { duration: 3000 });
      },
      error: () => {
        this.retrying = false;
        this.snack.open('Erro ao reenviar. Tente novamente.', '', { duration: 3000 });
      }
    });
  }
}
