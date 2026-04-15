import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { AlertBadgeComponent } from '../../../shared/components/alert-badge/alert-badge.component';
import { RiskMeterComponent } from '../../../shared/components/risk-meter/risk-meter.component';
import { DisclaimerComponent } from '../../../shared/components/disclaimer/disclaimer.component';
import { environment } from '../../../../environments/environment';
import { Exam } from '../../../shared/models/api.models';

@Component({
  selector: 'app-result-panel',
  standalone: true,
  imports: [
    DatePipe, FormsModule, NgTemplateOutlet,
    MatCardModule, MatSelectModule, MatDividerModule,
    AlertBadgeComponent, RiskMeterComponent, DisclaimerComponent
  ],
  template: `
    <div class="page-container">
      @if (exam) {
        <h1 class="text-2xl font-semibold mb-6">Resultado do Exame</h1>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <!-- Left column -->
          <div class="md:col-span-1">
            <mat-card class="p-4">
              <h3 class="font-medium mb-2">Dados do exame</h3>
              <p class="text-sm text-gray-600">Data: {{ exam.created_at | date:'dd/MM/yyyy HH:mm' }}</p>
              <p class="text-sm text-gray-600">Status: {{ exam.status }}</p>

              @if (allExams.length > 1) {
                <mat-divider class="my-3" />
                <mat-form-field class="w-full">
                  <mat-label>Comparar com</mat-label>
                  <mat-select [(ngModel)]="compareExamId" (ngModelChange)="loadCompare()">
                    @for (e of allExams; track e.id) {
                      @if (e.id !== exam.id) {
                        <mat-option [value]="e.id">{{ e.created_at | date:'dd/MM/yy' }}</mat-option>
                      }
                    }
                  </mat-select>
                </mat-form-field>
              }
            </mat-card>
          </div>

          <!-- Right column(s) -->
          <div [class]="compareExam ? 'md:col-span-1' : 'md:col-span-2'">
            <ng-container [ngTemplateOutlet]="resultTpl" [ngTemplateOutletContext]="{ $implicit: exam }" />
          </div>

          @if (compareExam) {
            <div class="md:col-span-1">
              <p class="text-xs text-gray-500 mb-2">Comparando: {{ compareExam.created_at | date:'dd/MM/yyyy' }}</p>
              <ng-container [ngTemplateOutlet]="resultTpl" [ngTemplateOutletContext]="{ $implicit: compareExam }" />
            </div>
          }
        </div>

        <ng-template #resultTpl let-e>
          @for (result of e.results ?? []; track result.agent_type) {
            <mat-card class="p-4 mb-4">
              <h3 class="font-medium mb-3 capitalize">{{ result.agent_type }}</h3>

              @if (result.alerts?.length) {
                <div class="mb-3">
                  <p class="text-sm font-medium mb-1">Alertas</p>
                  @for (alert of result.alerts; track alert.marker) {
                    <div class="flex items-center gap-2 mb-1">
                      <app-alert-badge [severity]="alert.severity" />
                      <span class="text-sm">{{ alert.marker }}: {{ alert.value }}</span>
                    </div>
                  }
                </div>
              }

              @if (result.risk_scores && objectKeys(result.risk_scores).length) {
                <div class="mb-3">
                  <p class="text-sm font-medium mb-2">Scores de risco</p>
                  @for (key of objectKeys(result.risk_scores); track key) {
                    <app-risk-meter [label]="key" [value]="result.risk_scores[key]" />
                  }
                </div>
              }

              <mat-divider class="my-3" />
              <p class="text-sm text-gray-700 whitespace-pre-wrap">{{ result.interpretation }}</p>
              <app-disclaimer />
            </mat-card>
          }
        </ng-template>
      }
    </div>
  `
})
export class ResultPanelComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  exam: Exam | null = null;
  compareExam: Exam | null = null;
  compareExamId: string | null = null;
  allExams: Exam[] = [];

  objectKeys = Object.keys;

  ngOnInit(): void {
    const examId = this.route.snapshot.paramMap.get('examId')!;
    this.http.get<Exam>(`${environment.apiUrl}/exams/${examId}`).subscribe(e => {
      this.exam = e;
    });
  }

  loadCompare(): void {
    if (!this.compareExamId) { this.compareExam = null; return; }
    this.http.get<Exam>(`${environment.apiUrl}/exams/${this.compareExamId}`)
      .subscribe(e => this.compareExam = e);
  }
}
