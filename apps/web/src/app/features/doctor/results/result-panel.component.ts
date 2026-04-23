import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterModule } from '@angular/router';
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
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { Exam, Subject, Prescription, ClinicalResult, ClinicProfile } from '../../../shared/models/api.models';
import { ImagingResultComponent } from './imaging-result.component';
import { ReviewQueueService } from '../review-queue/review-queue.service';
import { PrescriptionModalComponent, PrescriptionModalData } from '../../clinic/prescription/prescription-modal.component';
import { exportAnalysisPdf } from '../../../shared/utils/analysis-pdf';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

@Component({
  selector: 'app-result-panel',
  standalone: true,
  imports: [
    DatePipe, FormsModule, NgTemplateOutlet, UpperCasePipe,
    MatCardModule, MatSelectModule, MatDividerModule, MatButtonModule, MatIconModule, MatDialogModule,
    MatSnackBarModule,
    AlertBadgeComponent, RiskMeterComponent, DisclaimerComponent, PrescriptionModalComponent,
    ImagingResultComponent, RouterModule
  ],
  template: `
    <div class="result-page">
      @if (!exam) {
        <div class="loading-state">
          <span class="loading-text">Carregando análise...</span>
        </div>
      }

      @if (exam) {
        <button class="back-link" [routerLink]="['/doctor/patients', exam.subject_id || exam.patient_id]">
          <mat-icon>arrow_back</mat-icon>
          {{ subject ? subject.name : 'Paciente' }}
        </button>

        <div class="result-header">
          <div class="header-left">
            <h1 class="patient-title">Resultado do Exame</h1>
            <span class="exam-date">{{ exam.created_at | date:'dd/MM/yyyy HH:mm' }}</span>
          </div>
          <div class="header-right">
            @if (exam.status === 'done' && (exam.results?.length ?? 0) > 0) {
              <button mat-stroked-button class="export-btn"
                      [disabled]="exporting()"
                      (click)="exportAnalysisAsPdf()">
                <mat-icon>picture_as_pdf</mat-icon>
                {{ exporting() ? 'Gerando...' : 'Exportar análise' }}
              </button>
            }
            <span class="exam-status-badge" [class]="'status-' + exam.status">{{ exam.status | uppercase }}</span>
          </div>
        </div>

        @if (subject) {
          <div class="subject-identity">
            <a class="identity-chip identity-chip-link"
               [routerLink]="['/doctor/patients', exam.subject_id || exam.patient_id]">
              @if (subject.subject_type === 'animal') {
                <mat-icon style="font-size:14px;width:14px;height:14px">pets</mat-icon>
                {{ subject.name }} · {{ speciesLabel(subject.species!) }}
              } @else {
                <mat-icon style="font-size:14px;width:14px;height:14px">person</mat-icon>
                {{ subject.name }}
              }
              <mat-icon style="font-size:12px;width:12px;height:12px;margin-left:2px;opacity:0.5">open_in_new</mat-icon>
            </a>
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
                <span class="compare-label">Comparando: {{ exam.created_at | date:'dd/MM/yyyy' }} vs {{ compareExam.created_at | date:'dd/MM/yyyy' }}</span>
              </div>
              <!-- Comparison charts per agent -->
              @for (agentType of sharedAgents(); track agentType) {
                <div class="compare-chart-block">
                  <div class="compare-chart-agent">{{ agentLabel(agentType) }} — Scores comparados</div>
                  <div class="compare-chart-wrap">
                    <canvas [id]="'cmp-chart-' + agentType"></canvas>
                  </div>
                </div>
              }
              <ng-container [ngTemplateOutlet]="resultTpl" [ngTemplateOutletContext]="{ $implicit: compareExam }" />
            }
          </main>
        </div>

        <ng-template #resultTpl let-e>
          @for (result of e.results ?? []; track result.agent_type) {
            <div class="agent-card" [class]="'severity-' + getTopSeverity(result.alerts)">
              <div class="agent-header">
                <span class="agent-badge">
                @if (isImagingAgent(result.agent_type)) {
                  <mat-icon style="font-size:14px;width:14px;height:14px;vertical-align:middle;margin-right:4px;">camera_alt</mat-icon>
                }
                {{ agentLabel(result.agent_type) }}
              </span>
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

              @if (isImagingAgent(result.agent_type) && result.metadata?.original_image_url && e === exam) {
                <div style="margin: 1rem 0;">
                  <app-imaging-result [result]="result" [examId]="e.id" />
                </div>
              }

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

              @if (getStandardRecs(result.recommendations).length > 0) {
                <div class="recommendations-section">
                  <h4 class="rec-title">Recomendações</h4>
                  @for (rec of getStandardRecs(result.recommendations); track rec.description) {
                    <div class="rec-item" [class]="'priority-' + rec.priority">
                      <span class="rec-type">{{ rec.type | uppercase }}</span>
                      <div class="rec-body">
                        @if (rec.type === 'medication' && rec.name) {
                          <div style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:#dae2fd;margin-bottom:2px;">
                            {{ rec.name }}
                            @if (rec.dose) { <span style="font-weight:400;color:#c0c1ff"> · {{ rec.dose }}</span> }
                            @if (rec.frequency) { <span style="font-weight:400;color:#a09fb2"> · {{ rec.frequency }}</span> }
                            @if (rec.duration) { <span style="font-weight:400;color:#7c7b8f"> · {{ rec.duration }}</span> }
                          </div>
                        }
                        <span class="rec-desc">{{ rec.description }}</span>
                      </div>
                    </div>
                  }
                </div>
              }

              @if (getSuggestedExams(result.recommendations).length > 0) {
                <div class="recommendations-section">
                  <h4 class="rec-title">Exames Sugeridos</h4>
                  @for (rec of getSuggestedExams(result.recommendations); track rec.description) {
                    <div class="rec-item priority-medium">
                      <span class="rec-type">EXAME</span>
                      <div class="rec-body">
                        <span class="rec-desc">{{ rec._exam }}</span>
                        @if (rec._rationale) {
                          <p class="rec-rationale">{{ rec._rationale }}</p>
                        }
                      </div>
                    </div>
                  }
                </div>
              }

              @if (getContextualFactors(result.recommendations).length > 0) {
                <div class="recommendations-section">
                  <h4 class="rec-title">Fatores Contextuais</h4>
                  @for (rec of getContextualFactors(result.recommendations); track rec.description) {
                    <div class="rec-item priority-low">
                      <span class="rec-type">CONTEXTO</span>
                      <span class="rec-desc">{{ rec.description }}</span>
                    </div>
                  }
                </div>
              }

              <app-disclaimer />

              @if (e === exam && (result.agent_type === 'therapeutic' || result.agent_type === 'nutrition')) {
                <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid rgba(70,69,84,0.15);">
                  <button mat-stroked-button style="font-size:12px;" (click)="openPrescription(result)">
                    <mat-icon>description</mat-icon>
                    {{ result.agent_type === 'therapeutic' ? 'Gerar Receita Médica' : 'Gerar Prescrição Nutricional' }}
                  </button>

                  @if ((prescriptionsByAgent()[result.agent_type] ?? []).length > 0) {
                    <div style="margin-top:0.75rem;">
                      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6e6d80;margin-bottom:0.5rem;">
                        Receitas geradas
                      </div>
                      @for (p of prescriptionsByAgent()[result.agent_type]; track p.id) {
                        <div style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.75rem;background:#0b1326;border-radius:4px;margin-bottom:0.25rem;">
                          <mat-icon style="font-size:16px;width:16px;height:16px;color:#c0c1ff;">description</mat-icon>
                          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#a09fb2;flex:1;">
                            {{ p.created_at | date:'dd/MM/yyyy HH:mm' }} — {{ p.created_by_email }}
                          </span>
                          <button mat-icon-button style="width:28px;height:28px;" (click)="openPrescription(result, p)">
                            <mat-icon style="font-size:16px;">open_in_new</mat-icon>
                          </button>
                        </div>
                      }
                    </div>
                  }
                </div>
              }
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
      display: flex; justify-content: center; align-items: center;
      min-height: 50vh; flex-direction: column; gap: 1rem;
    }
    .loading-text {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px; color: #7c7b8f;
    }

    .back-link {
      display: inline-flex; align-items: center; gap: 6px;
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.1em;
      color: #a09fb2; cursor: pointer; background: none; border: none;
      padding: 0; margin-bottom: 1.5rem;
      transition: color 150ms ease;
    }
    .back-link:hover { color: #c0c1ff; }
    .back-link mat-icon { font-size: 15px; width: 15px; height: 15px; }

    .result-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      margin-bottom: 1.75rem; flex-wrap: wrap; gap: 1rem;
    }
    .header-right {
      display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
    }
    .export-btn {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 12px; letter-spacing: 0.03em;
      color: #c0c1ff !important; border-color: rgba(192,193,255,0.3) !important;
    }
    .export-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .patient-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.5rem; color: #dae2fd; margin: 0 0 0.25rem 0;
    }
    .exam-date {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; color: #7c7b8f;
    }
    .exam-status-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; padding: 4px 10px;
      border-radius: 4px; letter-spacing: 0.05em;
    }
    .status-done { background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.2); }
    .status-processing { background: rgba(192,193,255,0.1); color: #c0c1ff; border: 1px solid rgba(192,193,255,0.2); }
    .status-error { background: rgba(255,180,171,0.1); color: #ffb4ab; border: 1px solid rgba(255,180,171,0.2); }
    .status-pending { background: rgba(70,69,84,0.15); color: #a09fb2; border: 1px solid rgba(70,69,84,0.25); }

    .content-layout {
      display: grid; grid-template-columns: 220px 1fr;
      gap: 1.5rem; align-items: start;
    }
    .sidebar-card {
      background: #111929; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 8px; padding: 1.25rem;
      position: sticky; top: 1rem;
    }
    .sidebar-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 0.875rem; color: #dae2fd; margin: 0 0 1rem 0;
      padding-bottom: 0.75rem; border-bottom: 1px solid rgba(70,69,84,0.15);
    }
    .sidebar-meta {
      display: flex; flex-direction: column; gap: 2px; margin-bottom: 0.875rem;
    }
    .meta-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; color: #6e6d80; letter-spacing: 0.1em;
    }
    .meta-value {
      font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #c8c7d9;
    }
    .review-btn {
      width: 100%; margin-top: 1rem;
      background: #16a34a !important; color: #fff !important;
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 13px; border-radius: 6px;
      display: flex; align-items: center; justify-content: center; gap: 4px;
    }
    .reviewed-badge {
      display: flex; align-items: center; gap: 6px; margin-top: 1rem;
      padding: 6px 10px;
      background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.25);
      border-radius: 6px; font-family: 'JetBrains Mono', monospace;
      font-size: 11px; color: #10b981;
    }
    .reviewed-badge mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .compare-section { margin-top: 1rem; }
    .compare-field { width: 100%; margin-top: 0.25rem; padding-top: 0.75rem; }
    .full-width { width: 100%; }

    .ai-section-header {
      margin-bottom: 1.25rem; padding-left: 0.75rem;
      border-left: 3px solid #494bd6;
    }
    .ai-section-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1rem; color: #dae2fd; margin: 0;
    }
    .compare-header {
      margin: 1.5rem 0 1rem 0; padding-bottom: 0.5rem;
      border-bottom: 1px solid rgba(70,69,84,0.2);
    }
    .compare-label {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #7c7b8f; text-transform: uppercase;
    }

    .agent-card {
      background: #111929; border: 1px solid rgba(70,69,84,0.2);
      border-left: 3px solid rgba(70,69,84,0.3);
      border-radius: 8px; padding: 1.5rem;
      margin-bottom: 1rem;
      transition: border-color 150ms ease;
      animation: fadeInUp 200ms cubic-bezier(0.4,0,0.2,1) both;
    }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .agent-card.severity-CRITICAL { border-left-color: #ffb4ab; }
    .agent-card.severity-HIGH { border-left-color: #ffb783; }
    .agent-card.severity-MEDIUM { border-left-color: #c0c1ff; }
    .agent-card.severity-LOW { border-left-color: #10b981; }
    .agent-card.severity-none { border-left-color: rgba(70,69,84,0.25); }

    .agent-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem;
    }
    .agent-badge {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.08em; color: #a09fb2;
      border: 1px solid rgba(70,69,84,0.25); padding: 3px 8px; border-radius: 4px;
      background: rgba(70,69,84,0.1);
    }
    .risk-scores { display: flex; gap: 1.25rem; flex-wrap: wrap; }
    .risk-score-item { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
    .risk-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; color: #6e6d80; letter-spacing: 0.08em;
    }
    .risk-value { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 1.25rem; }

    .alerts-row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
    .alert-pill {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      padding: 3px 9px; border-radius: 4px; border: 1px solid transparent;
    }
    .alert-pill.alert-critical { background: rgba(255,180,171,0.1); color: #ffb4ab; border-color: rgba(255,180,171,0.2); }
    .alert-pill.alert-high { background: rgba(255,183,131,0.1); color: #ffb783; border-color: rgba(255,183,131,0.2); }
    .alert-pill.alert-medium { background: rgba(192,193,255,0.1); color: #c0c1ff; border-color: rgba(192,193,255,0.2); }
    .alert-pill.alert-low { background: rgba(16,185,129,0.1); color: #10b981; border-color: rgba(16,185,129,0.2); }

    .interpretation-block {
      padding: 0.875rem 1rem; background: rgba(73,75,214,0.06);
      border-left: 2px solid #494bd6; border-radius: 0 4px 4px 0;
      margin-bottom: 1rem;
    }
    .ai-marker-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; color: rgba(192,193,255,0.6);
      letter-spacing: 0.1em; display: block; margin-bottom: 0.625rem;
    }
    .interpretation-text {
      font-family: 'Inter', sans-serif; font-size: 14px;
      color: #c8c7d9; line-height: 1.7; white-space: pre-wrap; margin: 0;
    }

    .disclaimer-footer {
      font-family: 'Inter', sans-serif; font-size: 12px; font-style: italic;
      color: #6e6d80; margin-top: 2rem; padding-top: 1rem;
      border-top: 1px solid rgba(70,69,84,0.15);
    }

    .subject-identity { margin-bottom: 1rem; display: flex; gap: 0.5rem; }
    .identity-chip {
      display: flex; align-items: center; gap: 4px;
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #c0c1ff; background: rgba(73,75,214,0.1);
      border: 1px solid rgba(73,75,214,0.25); padding: 4px 10px; border-radius: 4px;
    }
    .identity-chip-link {
      text-decoration: none; cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease;
    }
    .identity-chip-link:hover {
      background: rgba(73,75,214,0.2); border-color: rgba(73,75,214,0.45);
    }
    .recommendations-section { margin-top: 1.25rem; }
    .rec-title {
      font-family: 'Space Grotesk', sans-serif; font-size: 0.8125rem;
      font-weight: 600; color: #a09fb2; margin: 0 0 0.625rem 0;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .rec-item {
      display: flex; gap: 0.625rem; align-items: flex-start;
      padding: 0.5rem 0.75rem; border-radius: 4px; margin-bottom: 0.375rem;
      background: rgba(70,69,84,0.08); border: 1px solid rgba(70,69,84,0.12);
    }
    .rec-item.priority-high { background: rgba(255,183,131,0.06); border-color: rgba(255,183,131,0.15); }
    .rec-item.priority-medium { background: rgba(192,193,255,0.06); border-color: rgba(192,193,255,0.12); }
    .rec-type {
      font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700;
      letter-spacing: 0.08em; color: #7c7b8f; flex-shrink: 0; padding-top: 2px;
    }
    .rec-desc { font-family: 'Inter', sans-serif; font-size: 13px; color: #c8c7d9; line-height: 1.5; }
    .rec-body { display: flex; flex-direction: column; gap: 4px; }
    .rec-rationale {
      font-family: 'Inter', sans-serif; font-size: 11px; color: #7c7b8f;
      line-height: 1.4; margin: 0; font-style: italic;
    }
    .compare-chart-block {
      background: #0f1928; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem;
    }
    .compare-chart-agent {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      letter-spacing: 0.1em; text-transform: uppercase; color: #c0c1ff;
      margin-bottom: 0.75rem;
    }
    .compare-chart-wrap { height: 180px; position: relative; }
    .compare-chart-wrap canvas { height: 100% !important; }

    /* ══════════════ MOBILE (< 640px) ══════════════ */
    @media (max-width: 639px) {
      .result-page { padding: 1rem; }
      .result-header { flex-direction: column; align-items: flex-start; }
      .patient-title { font-size: 1.25rem; }
      .header-right { width: 100%; justify-content: space-between; }
      .export-btn { flex: 1; font-size: 11px; }

      /* Layout 2col → 1col: sidebar vira card no topo (não sticky) */
      .content-layout {
        grid-template-columns: 1fr !important;
        gap: 1rem;
      }
      .sidebar-card {
        position: static !important;
        padding: 1rem;
      }
      .compare-field { width: 100% !important; }

      /* Agent cards */
      .agent-card { padding: 1rem; }
      .agent-header { flex-wrap: wrap; gap: 0.5rem; }
      .risk-scores { gap: 0.5rem; flex-wrap: wrap; }
      .risk-score-item { min-width: 0; }

      /* Compare charts */
      .compare-chart-wrap { height: 160px; }
      .compare-chart-block { padding: 0.875rem; }

      /* Subject identity chip wrap */
      .subject-identity { flex-wrap: wrap; }
    }
  `]
})
export class ResultPanelComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private reviewService = inject(ReviewQueueService);
  private dialog = inject(MatDialog);

  private snack = inject(MatSnackBar);

  exam: Exam | null = null;
  compareExam: Exam | null = null;
  compareExamId: string | null = null;
  allExams: Exam[] = [];
  subject: Subject | null = null;
  prescriptionsByAgent = signal<Record<string, Prescription[]>>({});
  exporting = signal(false);
  private cmpCharts: Chart[] = [];

  objectKeys = Object.keys;

  sharedAgents(): string[] {
    if (!this.exam || !this.compareExam) return [];
    const aTypes = new Set((this.exam.results ?? []).map(r => r.agent_type));
    return (this.compareExam.results ?? []).map(r => r.agent_type).filter(t => aTypes.has(t));
  }

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
      this.loadPrescriptions(e.id);
    });
  }

  private loadPrescriptions(examId: string): void {
    this.http.get<Prescription[]>(`${environment.apiUrl}/prescriptions/exams/${examId}`).subscribe({
      next: (list) => {
        const map: Record<string, Prescription[]> = {};
        list.forEach(p => {
          if (!map[p.agent_type]) map[p.agent_type] = [];
          map[p.agent_type].push(p);
        });
        this.prescriptionsByAgent.set(map);
      },
      error: () => {}
    });
  }

  openPrescription(result: ClinicalResult, existing?: Prescription): void {
    if (!this.exam || !this.subject) return;
    const subjectId = this.exam.subject_id ?? this.exam.patient_id ?? '';
    const module: 'human' | 'veterinary' = this.subject.subject_type === 'animal' ? 'veterinary' : 'human';
    const data: PrescriptionModalData = {
      examId: this.exam.id,
      subjectId,
      subject: this.subject,
      result,
      module,
      existingPrescription: existing
    };
    const ref = this.dialog.open(PrescriptionModalComponent, { width: '680px', panelClass: 'dark-dialog', data });
    ref.afterClosed().subscribe(saved => { if (saved && this.exam) this.loadPrescriptions(this.exam.id); });
  }

  markAsReviewed(): void {
    if (!this.exam || this.exam.review_status === 'reviewed') return;
    this.reviewService.markReviewed(this.exam.id).subscribe({
      next: () => { if (this.exam) this.exam.review_status = 'reviewed'; },
      error: () => {}
    });
  }

  exportAnalysisAsPdf(): void {
    if (!this.exam || !this.subject || this.exporting()) return;
    this.exporting.set(true);

    // Busca perfil da clínica pra cabeçalho; se falhar, gera sem
    this.http.get<ClinicProfile>(`${environment.apiUrl}/clinic/profile`).subscribe({
      next: (clinic) => {
        exportAnalysisPdf({ exam: this.exam!, subject: this.subject!, clinic })
          .then(() => this.exporting.set(false))
          .catch(() => {
            this.exporting.set(false);
            this.snack.open('Erro ao gerar PDF.', '', { duration: 3000 });
          });
      },
      error: () => {
        exportAnalysisPdf({ exam: this.exam!, subject: this.subject! })
          .then(() => this.exporting.set(false))
          .catch(() => {
            this.exporting.set(false);
            this.snack.open('Erro ao gerar PDF.', '', { duration: 3000 });
          });
      }
    });
  }

  loadCompare(): void {
    this.cmpCharts.forEach(c => c.destroy());
    this.cmpCharts = [];
    if (!this.compareExamId) { this.compareExam = null; return; }
    this.http.get<Exam>(`${environment.apiUrl}/exams/${this.compareExamId}`)
      .subscribe(e => {
        this.compareExam = e;
        setTimeout(() => this.renderCompareCharts(), 0);
      });
  }

  ngOnDestroy(): void {
    this.cmpCharts.forEach(c => c.destroy());
  }

  private renderCompareCharts(): void {
    if (!this.exam || !this.compareExam) return;
    const GRID = 'rgba(70,69,84,0.18)';
    const TICK = '#7c7b8f';
    const baseDate = new Date(this.exam.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const cmpDate  = new Date(this.compareExam.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

    for (const agentType of this.sharedAgents()) {
      const canvas = document.getElementById(`cmp-chart-${agentType}`) as HTMLCanvasElement | null;
      if (!canvas) continue;

      const baseResult = (this.exam.results ?? []).find(r => r.agent_type === agentType);
      const cmpResult  = (this.compareExam.results ?? []).find(r => r.agent_type === agentType);

      // Collect numeric keys present in at least one exam
      const allKeys = new Set([
        ...Object.keys(baseResult?.risk_scores ?? {}),
        ...Object.keys(cmpResult?.risk_scores ?? {}),
      ].filter(k => {
        const bv = parseFloat(baseResult?.risk_scores?.[k] ?? '');
        const cv = parseFloat(cmpResult?.risk_scores?.[k] ?? '');
        return !isNaN(bv) || !isNaN(cv);
      }));

      if (!allKeys.size) continue;

      const labels = [...allKeys];
      const chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: baseDate,
              data: labels.map(k => parseFloat(baseResult?.risk_scores?.[k] ?? 'NaN') || 0),
              backgroundColor: '#c0c1ff88',
              borderColor: '#c0c1ff',
              borderWidth: 1,
              borderRadius: 4,
            },
            {
              label: cmpDate,
              data: labels.map(k => parseFloat(cmpResult?.risk_scores?.[k] ?? 'NaN') || 0),
              backgroundColor: '#10b98188',
              borderColor: '#10b981',
              borderWidth: 1,
              borderRadius: 4,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {
                color: '#c8c7d9',
                font: { family: "'JetBrains Mono', monospace", size: 10 },
                boxWidth: 10, padding: 12,
              }
            },
            tooltip: {
              backgroundColor: '#1a2440',
              borderColor: 'rgba(70,69,84,0.4)',
              borderWidth: 1,
              titleColor: '#dae2fd',
              bodyColor: '#a09fb2',
              titleFont: { family: "'Space Grotesk'" },
              bodyFont: { family: "'JetBrains Mono'", size: 11 },
            }
          },
          scales: {
            x: {
              ticks: { color: '#c8c7d9', font: { family: "'JetBrains Mono'", size: 10 } },
              grid: { color: GRID },
              border: { color: GRID },
            },
            y: {
              ticks: { color: TICK, font: { family: "'JetBrains Mono'", size: 10 } },
              grid: { color: GRID },
              border: { color: GRID },
            }
          }
        }
      });
      this.cmpCharts.push(chart);
    }
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

  isImagingAgent(agentType: string): boolean {
    return agentType.startsWith('imaging_');
  }

  agentLabel(type: string): string {
    const labels: Record<string, string> = {
      metabolic:            'METABÓLICO',
      cardiovascular:       'CARDIOVASCULAR',
      hematology:           'HEMATOLOGIA',
      therapeutic:          'TERAPÊUTICO',
      nutrition:            'NUTRIÇÃO',
      clinical_correlation: 'CORRELAÇÃO CLÍNICA',
      small_animals:        'PEQUENOS ANIMAIS',
      equine:               'EQUINO',
      bovine:               'BOVINO',
      imaging_rx:           'RADIOGRAFIA (IA)',
      imaging_ecg:          'ECG (IA)',
      imaging_ultrasound:   'ULTRASSOM (IA)',
      imaging_mri:          'RESSONÂNCIA (IA)',
    };
    return labels[type] || type.toUpperCase();
  }

  getStandardRecs(recs: any[]): any[] {
    return (recs || []).filter(r => r.type !== 'suggested_exam' && r.type !== 'contextual_factor');
  }

  getSuggestedExams(recs: any[]): any[] {
    return (recs || []).filter(r => r.type === 'suggested_exam');
  }

  getContextualFactors(recs: any[]): any[] {
    return (recs || []).filter(r => r.type === 'contextual_factor');
  }
}
