import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription, filter } from 'rxjs';
import { WsService } from '../../../core/ws/ws.service';
import { ExamCardComponent } from '../../../shared/components/exam-card/exam-card.component';
import { environment } from '../../../../environments/environment';
import { Exam } from '../../../shared/models/api.models';

@Component({
  selector: 'app-exam-upload',
  standalone: true,
  imports: [RouterModule, MatIconModule, MatSnackBarModule, ExamCardComponent],
  styles: [`
    :host { display: block; background: #0b1326; min-height: 100vh; padding: 2rem; }

    .page { max-width: 720px; margin: 0 auto; }

    .page-header { margin-bottom: 2rem; }
    .page-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 1.5rem; color: #dae2fd; margin: 0 0 0.25rem 0;
    }
    .page-sub {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; color: #6e6d80; letter-spacing: 0.08em; text-transform: uppercase;
    }

    /* ── Credits ── */
    .credit-bar {
      display: flex; align-items: center; gap: 0.625rem;
      background: #111929; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 8px; padding: 0.75rem 1.125rem;
      margin-bottom: 1.75rem;
    }
    .credit-icon { font-size: 18px; width: 18px; height: 18px; color: #c0c1ff; }
    .credit-label {
      font-family: 'Inter', sans-serif; font-size: 13px; color: #a09fb2; flex: 1;
    }
    .credit-value {
      font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 700;
      color: #dae2fd;
    }
    .credit-value.low { color: #ffb783; }
    .credit-value.empty { color: #ffb4ab; }
    .credit-unit { font-family: 'Inter', sans-serif; font-size: 11px; color: #6e6d80; margin-left: 4px; }

    /* ── Drop zone ── */
    .drop-zone {
      border: 1px dashed rgba(70,69,84,0.4); border-radius: 10px;
      padding: 3rem 2rem; text-align: center;
      display: flex; flex-direction: column; align-items: center; gap: 0.875rem;
      cursor: pointer; transition: border-color 150ms ease, background 150ms ease;
      background: #0d1629;
    }
    .drop-zone:hover, .drop-zone.drag-over {
      border-color: rgba(192,193,255,0.5); background: rgba(192,193,255,0.04);
    }
    .drop-zone.has-file {
      border-color: rgba(74,214,160,0.5); background: rgba(74,214,160,0.04);
    }
    .drop-icon { font-size: 2.5rem; width: 2.5rem; height: 2.5rem; color: #6e6d80; }
    .drop-zone.has-file .drop-icon { color: #4ad6a0; }
    .drop-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 1rem; color: #c7c4d7; margin: 0;
    }
    .drop-sub {
      font-family: 'Inter', sans-serif; font-size: 13px; color: #6e6d80; margin: 0;
    }
    .file-chosen {
      font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #4ad6a0;
      margin: 0; display: flex; align-items: center; gap: 6px;
    }
    .file-chosen mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .browse-hint {
      font-family: 'Inter', sans-serif; font-size: 12px; color: #a09fb2;
      border: 1px solid rgba(70,69,84,0.35); border-radius: 4px;
      padding: 4px 12px; margin-top: 0.25rem;
    }
    .hidden-input { display: none; }

    /* ── Actions ── */
    .actions { margin-top: 1.25rem; display: flex; gap: 0.75rem; align-items: center; }
    .submit-btn {
      flex: 1; padding: 0.8125rem 1.5rem;
      background: #494bd6; color: #fff;
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 0.9375rem; letter-spacing: 0.04em;
      border: none; border-radius: 6px; cursor: pointer;
      transition: opacity 150ms ease, background 150ms ease;
    }
    .submit-btn:hover:not(:disabled) { background: #5a5ce8; }
    .submit-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .clear-btn {
      padding: 0.8125rem 1rem;
      background: transparent; color: #a09fb2;
      border: 1px solid rgba(70,69,84,0.35); border-radius: 6px;
      font-family: 'Space Grotesk', sans-serif; font-size: 13px;
      cursor: pointer; transition: all 150ms ease; white-space: nowrap;
    }
    .clear-btn:hover { border-color: rgba(70,69,84,0.6); color: #c7c4d7; }

    /* ── Exams list ── */
    .exams-section { margin-top: 2.5rem; }
    .section-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 0.9375rem; color: #dae2fd;
      margin: 0 0 1rem 0; padding-bottom: 0.75rem;
      border-bottom: 1px solid rgba(70,69,84,0.15);
      display: flex; align-items: center; gap: 0.5rem;
    }
    .section-count {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      background: rgba(73,75,214,0.15); color: #c0c1ff;
      border: 1px solid rgba(73,75,214,0.3);
      padding: 2px 8px; border-radius: 20px;
    }
  `],
  template: `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">Enviar exame</h1>
        <span class="page-sub">Upload de laudo laboratorial · PDF</span>
      </div>

      <!-- Credit balance -->
      <div class="credit-bar">
        <mat-icon class="credit-icon">toll</mat-icon>
        <span class="credit-label">Créditos disponíveis</span>
        @if (balanceLoaded) {
          <span class="credit-value" [class.low]="balance <= 5" [class.empty]="balance === 0">
            {{ balance }}
          </span>
          <span class="credit-unit">crédito{{ balance !== 1 ? 's' : '' }}</span>
        } @else {
          <span class="credit-value">—</span>
        }
      </div>

      <!-- Drop zone -->
      <input #fileInput type="file" accept=".pdf" class="hidden-input" (change)="onFileSelected($event)" />
      <div class="drop-zone" [class.has-file]="!!selectedFile" [class.drag-over]="dragging"
           (click)="fileInput.click()"
           (dragover)="$event.preventDefault(); dragging = true"
           (dragleave)="dragging = false"
           (drop)="onDrop($event)">
        <mat-icon class="drop-icon">{{ selectedFile ? 'check_circle' : 'upload_file' }}</mat-icon>
        @if (!selectedFile) {
          <p class="drop-title">Arraste o PDF aqui</p>
          <p class="drop-sub">ou clique para selecionar o arquivo</p>
          <span class="browse-hint">Selecionar PDF</span>
        } @else {
          <p class="file-chosen">
            <mat-icon>description</mat-icon>
            {{ selectedFile.name }}
          </p>
          <p class="drop-sub">Clique para trocar o arquivo</p>
        }
      </div>

      <div class="actions">
        <button class="submit-btn" [disabled]="!selectedFile || uploading || balance === 0" (click)="upload()">
          {{ uploading ? 'Enviando...' : 'Enviar para análise' }}
        </button>
        @if (selectedFile) {
          <button class="clear-btn" (click)="clearFile($event)">Cancelar</button>
        }
      </div>

      @if (exams.length > 0) {
        <div class="exams-section">
          <h2 class="section-title">
            Exames enviados
            <span class="section-count">{{ exams.length }}</span>
          </h2>
          @for (exam of exams; track exam.id) {
            <app-exam-card [exam]="exam" />
          }
        </div>
      }
    </div>
  `
})
export class ExamUploadComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private ws = inject(WsService);
  private snackBar = inject(MatSnackBar);

  patientId = '';
  selectedFile: File | null = null;
  uploading = false;
  dragging = false;
  exams: Exam[] = [];
  balance = 0;
  balanceLoaded = false;
  private wsSub?: Subscription;

  ngOnInit(): void {
    this.patientId = this.route.snapshot.paramMap.get('id')!;
    this.loadBalance();
    this.wsSub = this.ws.examUpdates$
      .pipe(filter(({ exam_id }) => this.exams.some(e => e.id === exam_id)))
      .subscribe(({ exam_id }) => {
        this.refreshExam(exam_id);
        this.loadBalance();
        this.snackBar.open('Resultado disponível!', 'Ver', { duration: 5000 })
          .onAction().subscribe(() =>
            window.location.href = `/doctor/results/${exam_id}`
          );
      });
  }

  ngOnDestroy(): void { this.wsSub?.unsubscribe(); }

  private loadBalance(): void {
    this.http.get<{ balance: number }>(`${environment.apiUrl}/billing/balance`)
      .subscribe({ next: r => { this.balance = r.balance; this.balanceLoaded = true; }, error: () => { this.balanceLoaded = true; } });
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    if (file && file.type !== 'application/pdf') {
      this.snackBar.open('Apenas arquivos PDF são aceitos.', '', { duration: 3000 });
      return;
    }
    this.selectedFile = file;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (file && file.type !== 'application/pdf') {
      this.snackBar.open('Apenas arquivos PDF são aceitos.', '', { duration: 3000 });
      return;
    }
    this.selectedFile = file;
  }

  clearFile(event: Event): void {
    event.stopPropagation();
    this.selectedFile = null;
  }

  upload(): void {
    if (!this.selectedFile) return;
    this.uploading = true;
    const form = new FormData();
    form.append('patient_id', this.patientId);
    form.append('file', this.selectedFile);

    this.http.post<{ exam_id: string; status: string }>(`${environment.apiUrl}/exams`, form).subscribe({
      next: ({ exam_id, status }) => {
        this.exams.unshift({
          id: exam_id, status: status as Exam['status'],
          file_path: this.selectedFile!.name,
          created_at: new Date().toISOString(), updated_at: '',
          source: 'upload', results: null
        });
        this.selectedFile = null;
        this.uploading = false;
        this.loadBalance();
      },
      error: (err) => {
        this.uploading = false;
        const msg = err.error?.error ?? 'Erro ao enviar o exame.';
        this.snackBar.open(msg, '', { duration: 4000 });
      }
    });
  }

  private refreshExam(examId: string): void {
    this.http.get<Exam>(`${environment.apiUrl}/exams/${examId}`).subscribe(exam => {
      const idx = this.exams.findIndex(e => e.id === examId);
      if (idx !== -1) this.exams[idx] = exam;
    });
  }
}
