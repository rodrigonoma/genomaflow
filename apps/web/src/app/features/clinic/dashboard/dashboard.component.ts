import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe, KeyValuePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AlertBadgeComponent } from '../../../shared/components/alert-badge/alert-badge.component';
import { environment } from '../../../../environments/environment';
import { Exam } from '../../../shared/models/api.models';

interface AlertItem { marker: string; value: string; severity: any; exam_id: string; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DatePipe, KeyValuePipe, RouterModule, MatCardModule, MatListModule, MatProgressBarModule, AlertBadgeComponent],
  template: `
    <div class="dashboard-page">
      <div class="page-header">
        <h1 class="page-title">Dashboard</h1>
        <span class="page-subtitle">VISÃO GERAL DA CLÍNICA</span>
      </div>

      <div class="metrics-grid">
        <div class="metric-card">
          <span class="metric-value">{{ counts.total }}</span>
          <span class="metric-label">TOTAL DE EXAMES</span>
        </div>
        <div class="metric-card">
          <span class="metric-value metric-done">{{ counts.done }}</span>
          <span class="metric-label">CONCLUÍDOS</span>
        </div>
        <div class="metric-card">
          <span class="metric-value metric-processing">{{ counts.processing }}</span>
          <span class="metric-label">PROCESSANDO</span>
        </div>
        <div class="metric-card">
          <span class="metric-value metric-error">{{ counts.error }}</span>
          <span class="metric-label">COM ERRO</span>
        </div>
      </div>

      <div class="panels-grid">
        <div class="panel-card">
          <h2 class="panel-title">Alertas Críticos Recentes</h2>
          @for (a of criticalAlerts; track a.marker) {
            <div class="alert-row">
              <app-alert-badge [severity]="a.severity" />
              <span class="alert-text">{{ a.marker }}: {{ a.value }}</span>
            </div>
          }
          @if (!criticalAlerts.length) {
            <p class="empty-panel">Nenhum alerta crítico.</p>
          }
        </div>

        <div class="panel-card">
          <h2 class="panel-title">Agentes Mais Utilizados</h2>
          @for (entry of agentCounts | keyvalue; track entry.key) {
            <div class="agent-row">
              <div class="agent-info">
                <span class="agent-name">{{ entry.key }}</span>
                <span class="agent-count">{{ entry.value }}</span>
              </div>
              <mat-progress-bar [value]="counts.done > 0 ? (entry.value / counts.done) * 100 : 0" />
            </div>
          }
          @if (!(agentCounts | keyvalue).length) {
            <p class="empty-panel">Nenhum dado disponível.</p>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      background: #0b1326;
      min-height: 100vh;
      padding: 2rem;
    }

    .page-header {
      margin-bottom: 2rem;
    }

    .page-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 1.5rem;
      color: #dae2fd;
      margin: 0 0 0.25rem 0;
    }

    .page-subtitle {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      text-transform: uppercase;
      color: #464554;
      letter-spacing: 0.08em;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .metric-card {
      background: #131b2e;
      border: 1px solid rgba(70, 69, 84, 0.15);
      border-radius: 8px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .metric-value {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700;
      font-size: 1.875rem;
      color: #c0c1ff;
    }

    .metric-value.metric-done { color: #10b981; }
    .metric-value.metric-processing { color: #c0c1ff; }
    .metric-value.metric-error { color: #ffb4ab; }

    .metric-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      text-transform: uppercase;
      color: #908fa0;
      letter-spacing: 0.06em;
      text-align: center;
    }

    .panels-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1.5rem;
    }

    .panel-card {
      background: #131b2e;
      border: 1px solid rgba(70, 69, 84, 0.15);
      border-radius: 8px;
      padding: 1.5rem;
    }

    .panel-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 1rem;
      color: #dae2fd;
      margin: 0 0 1rem 0;
    }

    .alert-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }

    .alert-text {
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      color: #c7c4d7;
    }

    .agent-row {
      margin-bottom: 0.75rem;
    }

    .agent-info {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.25rem;
    }

    .agent-name {
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      color: #c7c4d7;
      text-transform: capitalize;
    }

    .agent-count {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #908fa0;
    }

    .empty-panel {
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      color: #908fa0;
      margin: 0;
    }
  `]
})
export class DashboardComponent implements OnInit {
  private http = inject(HttpClient);

  counts = { total: 0, done: 0, processing: 0, error: 0, pending: 0 };
  criticalAlerts: AlertItem[] = [];
  agentCounts: Record<string, number> = {};

  ngOnInit(): void {
    this.http.get<any[]>(`${environment.apiUrl}/alerts?severity=critical`)
      .subscribe(alerts => {
        this.criticalAlerts = alerts.slice(0, 10).map(a => ({
          marker: a.marker, value: a.value, severity: a.severity, exam_id: a.exam_id
        }));
      });

    this.http.get<Exam[]>(`${environment.apiUrl}/exams`)
      .subscribe(exams => {
        this.counts.total = exams.length;
        this.counts.done = exams.filter(e => e.status === 'done').length;
        this.counts.processing = exams.filter(e => e.status === 'processing').length;
        this.counts.error = exams.filter(e => e.status === 'error').length;
        this.counts.pending = exams.filter(e => e.status === 'pending').length;

        const counts: Record<string, number> = {};
        for (const exam of exams) {
          for (const r of exam.results ?? []) {
            counts[r.agent_type] = (counts[r.agent_type] ?? 0) + 1;
          }
        }
        this.agentCounts = counts;
      });
  }
}
