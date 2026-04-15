import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
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
  imports: [RouterModule, MatButtonModule, MatIconModule, MatSnackBarModule, ExamCardComponent],
  template: `
    <div class="page-container">
      <h1 class="text-2xl font-semibold mb-6">Enviar exame</h1>

      <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-6">
        <mat-icon class="text-4xl text-gray-400 mb-2">upload_file</mat-icon>
        <p class="text-gray-600 mb-4">Selecione um arquivo PDF</p>
        <input #fileInput type="file" accept=".pdf" class="hidden" (change)="onFileSelected($event)" />
        <button mat-stroked-button (click)="fileInput.click()">Selecionar PDF</button>
        @if (selectedFile) {
          <p class="mt-2 text-sm text-green-700">{{ selectedFile.name }}</p>
        }
      </div>

      <button mat-flat-button color="primary" [disabled]="!selectedFile || uploading" (click)="upload()">
        {{ uploading ? 'Enviando...' : 'Enviar exame' }}
      </button>

      @if (exams.length > 0) {
        <h2 class="text-lg font-medium mt-8 mb-3">Exames enviados</h2>
        @for (exam of exams; track exam.id) {
          <app-exam-card [exam]="exam" />
        }
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
  exams: Exam[] = [];
  private wsSub?: Subscription;

  ngOnInit(): void {
    this.patientId = this.route.snapshot.paramMap.get('id')!;
    this.wsSub = this.ws.examUpdates$
      .pipe(filter(({ exam_id }) => this.exams.some(e => e.id === exam_id)))
      .subscribe(({ exam_id }) => {
        this.refreshExam(exam_id);
        this.snackBar.open('Resultado disponível!', 'Ver', { duration: 5000 })
          .onAction().subscribe(() =>
            window.location.href = `/doctor/results/${exam_id}`
          );
      });
  }

  ngOnDestroy(): void { this.wsSub?.unsubscribe(); }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  upload(): void {
    if (!this.selectedFile) return;
    this.uploading = true;
    const form = new FormData();
    form.append('patient_id', this.patientId);
    form.append('file', this.selectedFile);

    this.http.post<{ exam_id: string; status: string }>(
      `${environment.apiUrl}/exams`, form
    ).subscribe({
      next: ({ exam_id, status }) => {
        this.exams.unshift({
          id: exam_id,
          status: status as Exam['status'],
          file_path: this.selectedFile!.name,
          created_at: new Date().toISOString(),
          updated_at: '',
          source: 'upload',
          results: null
        });
        this.selectedFile = null;
        this.uploading = false;
      },
      error: () => { this.uploading = false; }
    });
  }

  private refreshExam(examId: string): void {
    this.http.get<Exam>(`${environment.apiUrl}/exams/${examId}`).subscribe(exam => {
      const idx = this.exams.findIndex(e => e.id === examId);
      if (idx !== -1) this.exams[idx] = exam;
    });
  }
}
