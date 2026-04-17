import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { DatePipe, NgTemplateOutlet, UpperCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AlertBadgeComponent } from '../../../shared/components/alert-badge/alert-badge.component';
import { RiskMeterComponent } from '../../../shared/components/risk-meter/risk-meter.component';
import { DisclaimerComponent } from '../../../shared/components/disclaimer/disclaimer.component';
import { environment } from '../../../../environments/environment';
import { Exam, Subject } from '../../../shared/models/api.models';
import { ReviewQueueService } from '../review-queue/review-queue.service';

@Component({
  selector: 'app-result-panel',
  standalone: true,
  imports: [
    DatePipe, FormsModule, NgTemplateOutlet, UpperCasePipe,
    MatCardModule, MatSelectModule, MatDividerModule, MatButtonModule, MatIconModule,
    AlertBadgeComponent, RiskMeterComponent, DisclaimerComponent
  ],
  template: `
    <div class="result-page">
      @if (!exam) {
        <div class="loading-state">
          <span class="loading-text">Carregando análise...</span>
        </div>
      }

      @if (exam) {
        <div class="result-header">
          <div class="header-left">
            <h1 class="patient-title">Resultado do Exame</h1>
            <span class="exam-date">{{ exam.created_at | date:'dd/MM/yyyy HH:mm' }}</span>
          </div>
          <span class="exam-status-badge" [class]="'status-' + exam.status">{{ exam.status | uppercase }}</span>
        </div>

        @if (subject) {
          <div class="subject-identity">
            @if (subject.subject_type === 'animal') {
              <span class="identity-chip">
                <mat-icon style="font-size:14px;width:14px;height:14px">pets</mat-icon>
                {{ subject.name }} · {{ speciesLabel(subject.species!) }}
              </span>
            } @else {
              <span class="identity-chip">
                <mat-icon style="font-size:14px;width:14px;height:14px">person</mat-icon>
                {{ subject.name }}
              </span>
            }
          </div>
        }

        <div class="content-layout">
          <aside class="sidebar">
            <div class="sidebar-card">
              <h3 class="sidebar-title">Dados do exame</h3>
              <p class="sidebar-meta">
                <span class="meta-label">DATA</span>
                <span class="meta-value">{{ exam.created_at | date:'dd/MM/yyyy HH:mm' }}</span>
              </p>
              <p class="sidebar-meta">
                <span class="meta-label">STATUS</span>
                <span class="meta-value">{{ exam.status }}</span>
              </p>

              @if (exam.review_status && exam.review_status !== 'reviewed') {
                <button mat-flat-button class="review-btn" (click)="markAsReviewed()">
                  <mat-icon>check_circle</mat-icon>
                  Marcar como Revisado
                </button>
              }
              @if (exam.review_status === 'reviewed') {
                <div class="reviewed-badge">
                  <mat-icon>verified</mat-icon>
                  Revisado
                </div>
              }

              @if (allExams.length > 1) {
                <div class="compare-section">
                  <mat-divider />
                  <mat-form-field appearance="outline" class="full-width compare-field">
                    <mat-label>Comparar com</mat-label>
                    <mat-select [(ngModel)]="compareExamId" (ngModelChange)="loadCompare()">
                      @for (e of allExams; track e.id) {
                        @if (e.id !== exam.id) {
                          <mat-option [value]="e.id">{{ e.created_at | date:'dd/MM/yy' }}</mat-option>
                        }
                      }
                    </mat-select>
                  </mat-form-field>
                </div>
              }
            </div>
          </aside>

          <main class="main-content">
            <div class="ai-section-header">
              <h2 class="ai-section-title">Análise Clínica por IA</h2>
            </div>

            <ng-container [ngTemplateOutlet]="resultTpl" [ngTemplateOutletContext]="{ $implicit: exam }" />

            @if (compareExam) {
              <div class="compare-header">
                <span class="compare-label">Comparando: {{ compareExam.created_at | date:'dd/MM/yyyy' }}</span>
              </div>
              <ng-container [ngTemplateOutlet]="resultTpl" [ngTemplateOutletContext]="{ $implicit: compareExam }" />
            }
          </main>
        </div>

        <ng-template #resultTpl let-e>
          @for (result of e.results ?? []; track result.agent_type) {
            <div class="agent-card" [class]="'severity-' + getTopSeverity(result.alerts)">
              <div class="agent-header">
                <span class="agent-badge">{{ result.agent_type | uppercase }}</span>
                @if (result.risk_scores && objectKeys(result.risk_scores).length) {
                  <div class="risk-scores">
                    @for (key of objectKeys(result.risk_scores); track key) {
                      <div class="risk-score-item">
                        <span class="risk-label">{{ key }}</span>
                        <span class="risk-value" [style.color]="getRiskColor(result.risk_scores[key])">
                          {{ result.risk_scores[key] }}
                        </span>
                      </div>
                    }
                  </div>
                }
              </div>

              @if (result.alerts?.length) {
                <div class="alerts-row">
                  @for (alert of result.alerts; track alert.marker) {
                    <span class="alert-pill" [class]="'alert-' + alert.severity">
                      {{ alert.marker }}: {{ alert.value }}
                    </span>
                  }
                </div>
              }

              <div class="interpretation-block">
                <span class="ai-marker-label">AI · CLAUDE SONNET</span>
                <p class="interpretation-text">{{ result.interpretation }}</p>
              </div>

              @if (result.recommendations && result.recommendations.length > 0) {
                <div class="recommendations-section">
                  <h4 class="rec-title">Recomendações</h4>
                  @for (rec of result.recommendations; track rec.description) {
                    <div class="rec-item" [class]="'priority-' + rec.priority">
                      <span class="rec-type">{{ rec.type | uppercase }}</span>
                      <span class="rec-desc">{{ rec.description }}</span>
                    </div>
                  }
                </div>
              }

              <app-disclaimer />
            </div>
          }
        </ng-template>

        <p class="disclaimer-footer">
          As análises geradas por IA são auxiliares ao diagnóstico clínico e não substituem a avaliação médica especializada.
          Sempre valide os resultados com profissional habilitado.
        </p>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      background: #0b1326;
      min-height: 100vh;
      padding: 2rem;
      max-width: 1200px;
      margin: 0 auto;
    }

    .loading-state {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 50vh;
    }

    .loading-text {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      color: #c0c1ff;
    }

    .result-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 2rem;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .patient-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 1.5rem;
      color: #dae2fd;
      margin: 0 0 0.25rem 0;
    }

    .exam-date {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #908fa0;
    }

    .exam-status-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      padding: 4px 10px;
      border-radius: 4px;
    }

    .status-done { background: rgba(16,185,129,0.1); color: #10b981; }
    .status-processing { background: rgba(192,193,255,0.1); color: #c0c1ff; }
    .status-error { background: rgba(255,180,171,0.1); color: #ffb4ab; }
    .status-pending { background: #2d3449; color: #908fa0; }

    .content-layout {
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: 1.5rem;
      align-items: start;
    }

    .sidebar-card {
      background: #131b2e;
      border: 1px solid rgba(70, 69, 84, 0.15);
      border-radius: 8px;
      padding: 1.25rem;
      position: sticky;
      top: 1rem;
    }

    .sidebar-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 600;
      font-size: 0.875rem;
      color: #dae2fd;
      margin: 0 0 1rem 0;
    }

    .sidebar-meta {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-bottom: 0.75rem;
    }

    .meta-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      text-transform: uppercase;
      color: #464554;
      letter-spacing: 0.08em;
    }

    .meta-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #c7c4d7;
    }

    .review-btn {
      width: 100%;
      margin-top: 1rem;
      background: #16a34a !important;
      color: #fff !important;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 600;
      font-size: 13px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }

    .reviewed-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 1rem;
      padding: 6px 10px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #10b981;
    }

    .reviewed-badge mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }

    .compare-section {
      margin-top: 1rem;
    }

    .compare-field {
      width: 100%;
      margin-top: 1rem;
    }

    .full-width { width: 100%; }

    .ai-section-header {
      margin-bottom: 1.25rem;
      padding-left: 0.75rem;
      border-left: 2px solid #494bd6;
    }

    .ai-section-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 1rem;
      color: #dae2fd;
      margin: 0;
    }

    .compare-header {
      margin: 1.5rem 0 1rem 0;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid rgba(70,69,84,0.2);
    }

    .compare-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: #908fa0;
      text-transform: uppercase;
    }

    .agent-card {
      background: #131b2e;
      border: 1px solid rgba(70, 69, 84, 0.15);
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 1rem;
      transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .agent-card.severity-CRITICAL { border-left: 4px solid #ffb4ab; }
    .agent-card.severity-HIGH { border-left: 4px solid #ffb783; }
    .agent-card.severity-MEDIUM { border-left: 4px solid #c0c1ff; }
    .agent-card.severity-LOW { border-left: 4px solid #10b981; }
    .agent-card.severity-none { border-left: 4px solid rgba(70,69,84,0.3); }

    .agent-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    .agent-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #c7c4d7;
      border: 1px solid rgba(70, 69, 84, 0.15);
      padding: 2px 6px;
      border-radius: 3px;
    }

    .risk-scores {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .risk-score-item {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
    }

    .risk-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      text-transform: uppercase;
      color: #464554;
    }

    .risk-value {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700;
      font-size: 1.25rem;
    }

    .alerts-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .alert-pill {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
    }

    .alert-pill.alert-critical { background: rgba(255,180,171,0.1); color: #ffb4ab; }
    .alert-pill.alert-high { background: rgba(255,183,131,0.1); color: #ffb783; }
    .alert-pill.alert-medium { background: rgba(192,193,255,0.1); color: #c0c1ff; }
    .alert-pill.alert-low { background: rgba(16,185,129,0.1); color: #10b981; }

    .interpretation-block {
      padding: 0.75rem 1rem;
      border-left: 2px solid #494bd6;
      margin-bottom: 1rem;
    }

    .ai-marker-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      text-transform: uppercase;
      color: #494bd6;
      letter-spacing: 0.1em;
      display: block;
      margin-bottom: 0.5rem;
    }

    .interpretation-text {
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      color: #c7c4d7;
      line-height: 1.6;
      white-space: pre-wrap;
      margin: 0;
    }

    .disclaimer-footer {
      font-family: 'Inter', sans-serif;
      font-size: 12px;
      font-style: italic;
      color: #464554;
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(70,69,84,0.15);
    }

    .subject-identity { margin-bottom: 1rem; display: flex; gap: 0.5rem; }
    .identity-chip { display: flex; align-items: center; gap: 4px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #c0c1ff; background: rgba(73,75,214,0.1); border: 1px solid rgba(73,75,214,0.25); padding: 3px 8px; border-radius: 4px; }
    .recommendations-section { margin-top: 1rem; }
    .rec-title { font-family: 'Space Grotesk', sans-serif; font-size: 0.875rem; font-weight: 600; color: #c0c1ff; margin: 0 0 0.5rem 0; }
    .rec-item { display: flex; gap: 0.5rem; align-items: flex-start; padding: 0.5rem; border-radius: 4px; margin-bottom: 0.375rem; background: rgba(70,69,84,0.08); }
    .rec-item.priority-high { background: rgba(255,183,131,0.08); }
    .rec-item.priority-medium { background: rgba(192,193,255,0.08); }
    .rec-type { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: 0.08em; color: #908fa0; flex-shrink: 0; padding-top: 2px; }
    .rec-desc { font-family: 'Inter', sans-serif; font-size: 13px; color: #c7c4d7; line-height: 1.4; }
  `]
})
export class ResultPanelComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private reviewService = inject(ReviewQueueService);

  exam: Exam | null = null;
  compareExam: Exam | null = null;
  compareExamId: string | null = null;
  allExams: Exam[] = [];
  subject: Subject | null = null;

  objectKeys = Object.keys;

  ngOnInit(): void {
    const examId = this.route.snapshot.paramMap.get('examId')!;
    this.http.get<Exam>(`${environment.apiUrl}/exams/${examId}`).subscribe(e => {
      this.exam = e;
      if (e.review_status === 'pending') {
        this.reviewService.markViewed(e.id).subscribe({ error: () => {} });
      }
      if (e.subject_id || e.patient_id) {
        const subjectId = e.subject_id || e.patient_id;
        this.http.get<Subject>(`${environment.apiUrl}/patients/${subjectId}`)
          .subscribe(s => { this.subject = s; });
      }
    });
  }

  markAsReviewed(): void {
    if (!this.exam || this.exam.review_status === 'reviewed') return;
    this.reviewService.markReviewed(this.exam.id).subscribe({
      next: () => { if (this.exam) this.exam.review_status = 'reviewed'; },
      error: () => {}
    });
  }

  loadCompare(): void {
    if (!this.compareExamId) { this.compareExam = null; return; }
    this.http.get<Exam>(`${environment.apiUrl}/exams/${this.compareExamId}`)
      .subscribe(e => this.compareExam = e);
  }

  getTopSeverity(alerts: any[]): string {
    if (!alerts?.length) return 'none';
    const order = ['critical', 'high', 'medium', 'low'];
    for (const sev of order) {
      if (alerts.some(a => (a.severity ?? '').toLowerCase() === sev)) return sev.toUpperCase();
    }
    return 'none';
  }

  speciesLabel(species: string): string {
    const labels: Record<string, string> = { dog: 'Cão', cat: 'Gato', equine: 'Equino', bovine: 'Bovino' };
    return labels[species] ?? species;
  }

  getRiskColor(value: string): string {
    const num = parseFloat(value);
    if (isNaN(num)) return '#c0c1ff';
    if (num >= 0.75) return '#ffb4ab';
    if (num >= 0.5) return '#ffb783';
    if (num >= 0.25) return '#c0c1ff';
    return '#10b981';
  }
}
