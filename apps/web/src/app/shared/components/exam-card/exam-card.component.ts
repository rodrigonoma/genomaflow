import { Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { ExamStatusComponent } from '../exam-status/exam-status.component';
import { Exam } from '../../models/api.models';

@Component({
  selector: 'app-exam-card',
  standalone: true,
  imports: [RouterModule, DatePipe, MatCardModule, MatButtonModule, ExamStatusComponent],
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
        @if (exam.status === 'done') {
          <a mat-stroked-button [routerLink]="['/doctor/results', exam.id]">Ver resultado</a>
        }
      </mat-card-content>
    </mat-card>
  `
})
export class ExamCardComponent {
  @Input() exam!: Exam;
  get filename(): string {
    return this.exam.file_path?.split('/').pop() ?? 'exame.pdf';
  }
}
