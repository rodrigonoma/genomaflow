import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ExamStatusComponent } from '../exam-status/exam-status.component';
import { Exam } from '../../models/api.models';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-exam-card',
  standalone: true,
  imports: [RouterModule, DatePipe, MatCardModule, MatButtonModule, MatProgressSpinnerModule, ExamStatusComponent],
  template: `
    <mat-card class="mb-2">
      <mat-card-content class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3">
          <app-exam-status [status]="exam.status" />
          <div>
            <div class="font-medium text-sm">{{ filename }}</div>
            <div class="text-xs text-gray-500">{{ exam.created_at | date:'dd/MM/yyyy HH:mm' }}</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          @if (exam.status === 'done') {
            <a mat-stroked-button [routerLink]="['/doctor/results', exam.id]">Ver resultado</a>
          }
          @if (exam.status === 'error') {
            <span class="text-xs" style="color:#ffb4ab">Falha na análise</span>
            <button mat-stroked-button color="warn" [disabled]="reprocessing()" (click)="reprocess()">
              @if (reprocessing()) { <mat-spinner diameter="16" style="display:inline-block"/> }
              @else { Reprocessar }
            </button>
          }
        </div>
      </mat-card-content>
    </mat-card>
  `
})
export class ExamCardComponent implements OnChanges {
  @Input() exam!: Exam;
  @Output() reprocessed = new EventEmitter<string>();

  reprocessing = signal(false);

  constructor(private http: HttpClient) {}

  ngOnChanges(changes: SimpleChanges): void {
    // Reset spinner when parent updates exam status (WS event resolved)
    const exam = changes['exam'];
    if (exam && !exam.firstChange) {
      const prev: Exam = exam.previousValue;
      const curr: Exam = exam.currentValue;
      if (prev?.status !== curr?.status && curr?.status !== 'pending' && curr?.status !== 'processing') {
        this.reprocessing.set(false);
      }
    }
  }

  get filename(): string {
    return this.exam.file_path?.split('/').pop() ?? 'exame.pdf';
  }

  reprocess(): void {
    this.reprocessing.set(true);
    this.http.post(`${environment.apiUrl}/exams/${this.exam.id}/reprocess`, {}).subscribe({
      next: () => this.reprocessed.emit(this.exam.id),
      error: () => this.reprocessing.set(false)
    });
  }
}
