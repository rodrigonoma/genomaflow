import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ExamStatusComponent } from '../exam-status/exam-status.component';
import { WsService } from '../../../core/ws/ws.service';
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
export class ExamCardComponent implements OnInit, OnDestroy {
  @Input() exam!: Exam;
  @Output() reprocessed = new EventEmitter<string>();

  reprocessing = signal(false);
  private sub = new Subscription();

  constructor(private http: HttpClient, private ws: WsService) {}

  ngOnInit(): void {
    this.sub.add(
      this.ws.examError$.subscribe(({ exam_id }) => {
        if (exam_id === this.exam.id) {
          this.exam = { ...this.exam, status: 'error' };
          this.reprocessing.set(false);
        }
      })
    );
    this.sub.add(
      this.ws.examUpdates$.subscribe((msg) => {
        if ((msg as any).exam_id === this.exam.id) {
          this.exam = { ...this.exam, status: 'done' };
          this.reprocessing.set(false);
        }
      })
    );
  }

  ngOnDestroy(): void { this.sub.unsubscribe(); }

  get filename(): string {
    return this.exam.file_path?.split('/').pop() ?? 'exame.pdf';
  }

  reprocess(): void {
    this.reprocessing.set(true);
    this.http.post(`${environment.apiUrl}/exams/${this.exam.id}/reprocess`, {}).subscribe({
      next: () => {
        this.exam = { ...this.exam, status: 'pending' };
        this.reprocessed.emit(this.exam.id);
      },
      error: () => this.reprocessing.set(false)
    });
  }
}
