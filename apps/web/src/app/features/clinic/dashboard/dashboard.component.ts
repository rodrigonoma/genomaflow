import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe, KeyValuePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatIconModule } from '@angular/material/icon';
import { AlertBadgeComponent } from '../../../shared/components/alert-badge/alert-badge.component';
import { environment } from '../../../../environments/environment';
import { Exam } from '../../../shared/models/api.models';

interface AlertItem { marker: string; value: string; severity: any; exam_id: string; }
interface DayBar { key: string; label: string; count: number; }

interface InsightAlert {
  marker: string; value: string; severity: string; agent_type: string;
  exam_id: string; exam_date: string; subject_id: string; subject_name: string;
}
interface InsightReviewPending {
  exam_id: string; exam_date: string; review_status: string;
  subject_id: string; subject_name: string; file_type?: string;
}
interface InsightMarker { marker: string; count: number; pct: number; }
interface InsightPayload {
  critical_alerts_recent: InsightAlert[];
  review_pending: InsightReviewPending[];
  top_markers_altered: InsightMarker[];
  risk_distribution: { critical: number; high: number; medium: number; low: number; none: number };
  patients_with_latest_exam: number;
  total_patients: number;
}

const AGENT_LABELS: Record<string, string> = {
  metabolic: 'Metabólico', cardiovascular: 'Cardiovascular', hematology: 'Hematologia',
  small_animals: 'Pequenos Animais', equine: 'Equinos', bovine: 'Bovinos',
  therapeutic: 'Terapêutico', nutrition: 'Nutrição', clinical_correlation: 'Correlação Clínica'
};

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DatePipe, KeyValuePipe, RouterModule, MatProgressBarModule, MatIconModule, AlertBadgeComponent],
  template: `
    <div class="dashboard-page">
      <div class="page-header">
        <h1 class="page-title">Dashboard</h1>
        <span class="page-subtitle">VISÃO GERAL DA CLÍNICA</span>
      </div>

      <!-- KPI Cards -->
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

      <!-- Charts row -->
      <div class="charts-row">

        <!-- Bar chart: exams last 14 days -->
        <div class="chart-card chart-card--wide">
          <h2 class="chart-title">Exames — Últimos 14 dias</h2>
          @if (timeline.length) {
            <div class="bar-chart-wrap">
              <svg class="bar-svg" viewBox="0 0 588 140" preserveAspectRatio="none">
                <!-- grid lines -->
                @for (line of gridLines; track line.y) {
                  <line [attr.x1]="0" [attr.y1]="line.y" [attr.x2]="588" [attr.y2]="line.y"
                        stroke="rgba(70,69,84,0.25)" stroke-width="1"/>
                  <text [attr.x]="0" [attr.y]="line.y - 3"
                        font-family="'JetBrains Mono',monospace" font-size="9" fill="#464554">{{ line.val }}</text>
                }
                <!-- bars -->
                @for (bar of timeline; track bar.key; let i = $index) {
                  @let bw = 30;
                  @let gap = 12;
                  @let x = 18 + i * (bw + gap);
                  @let bh = barHeight(bar.count);
                  @let y = 120 - bh;
                  <rect [attr.x]="x" [attr.y]="y" [attr.width]="bw" [attr.height]="bh"
                        rx="3" fill="#494bd6" opacity="0.85"/>
                  @if (bar.count > 0) {
                    <text [attr.x]="x + bw/2" [attr.y]="y - 4"
                          text-anchor="middle"
                          font-family="'JetBrains Mono',monospace" font-size="9" fill="#c0c1ff">{{ bar.count }}</text>
                  }
                  <text [attr.x]="x + bw/2" [attr.y]="136"
                        text-anchor="middle"
                        font-family="'JetBrains Mono',monospace" font-size="9" fill="#464554">{{ bar.label }}</text>
                }
              </svg>
            </div>
          } @else {
            <p class="empty-chart">Carregando...</p>
          }
        </div>

        <!-- Donut: status distribution -->
        <div class="chart-card">
          <h2 class="chart-title">Distribuição por Status</h2>
          <div class="donut-wrap">
            <svg viewBox="0 0 120 120" width="120" height="120">
              <circle cx="60" cy="60" r="48" fill="none" stroke="#131b2e" stroke-width="20"/>
              @for (seg of donutSegments; track seg.status) {
                <circle cx="60" cy="60" r="48" fill="none"
                        [attr.stroke]="seg.color"
                        stroke-width="20"
                        [attr.stroke-dasharray]="seg.dash"
                        [attr.stroke-dashoffset]="seg.offset"
                        stroke-linecap="butt"
                        transform="rotate(-90 60 60)"/>
              }
              <text x="60" y="56" text-anchor="middle"
                    font-family="'JetBrains Mono',monospace" font-size="18" font-weight="700" fill="#c0c1ff">
                {{ counts.total }}
              </text>
              <text x="60" y="70" text-anchor="middle"
                    font-family="'JetBrains Mono',monospace" font-size="8" fill="#908fa0">TOTAL</text>
            </svg>
            <div class="donut-legend">
              @for (seg of donutSegments; track seg.status) {
                @if (seg.count > 0) {
                  <div class="legend-item">
                    <span class="legend-dot" [style.background]="seg.color"></span>
                    <span class="legend-label">{{ seg.label }}</span>
                    <span class="legend-val">{{ seg.count }}</span>
                  </div>
                }
              }
            </div>
          </div>
        </div>
      </div>

      @if (insights) {
        <!-- Insights: risk distribution + top markers -->
        <div class="charts-row">
          <div class="chart-card">
            <h2 class="chart-title">Risco clínico da carteira</h2>
            @if (insights.patients_with_latest_exam === 0) {
              <p class="empty-chart" style="padding:1.5rem 0">Nenhum paciente analisado ainda.</p>
            } @else {
              <div class="donut-wrap">
                <svg viewBox="0 0 120 120" width="120" height="120">
                  <circle cx="60" cy="60" r="48" fill="none" stroke="#131b2e" stroke-width="20"/>
                  @for (seg of riskDonutSegments; track seg.key) {
                    <circle cx="60" cy="60" r="48" fill="none"
                            [attr.stroke]="seg.color" stroke-width="20"
                            [attr.stroke-dasharray]="seg.dash"
                            [attr.stroke-dashoffset]="seg.offset"
                            stroke-linecap="butt"
                            transform="rotate(-90 60 60)"/>
                  }
                  <text x="60" y="56" text-anchor="middle"
                        font-family="'JetBrains Mono',monospace" font-size="18" font-weight="700" fill="#c0c1ff">
                    {{ insights.patients_with_latest_exam }}
                  </text>
                  <text x="60" y="70" text-anchor="middle"
                        font-family="'JetBrains Mono',monospace" font-size="8" fill="#908fa0">PACIENTES</text>
                </svg>
                <div class="donut-legend">
                  @for (seg of riskDonutSegments; track seg.key) {
                    @if (seg.count > 0) {
                      <div class="legend-item">
                        <span class="legend-dot" [style.background]="seg.color"></span>
                        <span class="legend-label">{{ seg.label }}</span>
                        <span class="legend-val">{{ seg.count }}</span>
                      </div>
                    }
                  }
                </div>
              </div>
            }
          </div>

          <div class="chart-card chart-card--wide">
            <h2 class="chart-title">Top 5 Marcadores Alterados na Carteira</h2>
            @if (insights.top_markers_altered.length === 0) {
              <p class="empty-chart" style="padding:1.5rem 0">Nenhum marcador alterado registrado.</p>
            } @else {
              @for (m of insights.top_markers_altered; track m.marker) {
                <div class="agent-row">
                  <div class="agent-info">
                    <span class="agent-name">{{ m.marker }}</span>
                    <span class="agent-count">{{ m.count }} ({{ m.pct }}%)</span>
                  </div>
                  <div class="agent-bar-track">
                    <div class="agent-bar-fill" style="background:#ffcb6b" [style.width.%]="m.pct"></div>
                  </div>
                </div>
              }
              <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#6e6d80;margin:0.75rem 0 0 0">
                Baseado no último exame de cada paciente analisado ({{ insights.patients_with_latest_exam }} paciente{{ insights.patients_with_latest_exam === 1 ? '' : 's' }}).
              </p>
            }
          </div>
        </div>
      }

      <!-- Bottom panels -->
      <div class="panels-grid">
        <div class="panel-card">
          <h2 class="panel-title">Alertas Críticos Recentes</h2>
          @if (insights && insights.critical_alerts_recent.length > 0) {
            @for (a of insights.critical_alerts_recent; track a.exam_id + a.marker) {
              <a class="alert-row alert-row-link" [routerLink]="['/doctor/results', a.exam_id]">
                <span class="alert-dot" [style.background]="severityColor(a.severity)"></span>
                <div class="alert-info">
                  <div class="alert-marker">{{ a.marker }} <span class="alert-value">· {{ a.value }}</span></div>
                  <div class="alert-meta">{{ a.subject_name }} · {{ a.exam_date | date:'dd/MM/yyyy' }}</div>
                </div>
              </a>
            }
          } @else {
            <p class="empty-panel">Nenhum alerta crítico nos últimos 30 dias.</p>
          }
        </div>

        <div class="panel-card">
          <h2 class="panel-title">Exames Aguardando Revisão</h2>
          @if (insights && insights.review_pending.length > 0) {
            @for (r of insights.review_pending; track r.exam_id) {
              <a class="alert-row alert-row-link" [routerLink]="['/doctor/results', r.exam_id]">
                <mat-icon style="font-size:18px;width:18px;height:18px;color:#c0c1ff">inbox</mat-icon>
                <div class="alert-info">
                  <div class="alert-marker">{{ r.subject_name }}</div>
                  <div class="alert-meta">
                    {{ r.exam_date | date:'dd/MM/yyyy HH:mm' }}
                    @if (r.review_status === 'viewed') { · Visto, não revisado }
                    @else { · Pendente de visualização }
                  </div>
                </div>
              </a>
            }
          } @else {
            <p class="empty-panel">Tudo revisado. Nenhum exame pendente.</p>
          }
        </div>

        <div class="panel-card">
          <h2 class="panel-title">Agentes Mais Utilizados</h2>
          @for (entry of agentEntries; track entry.key) {
            <div class="agent-row">
              <div class="agent-info">
                <span class="agent-name">{{ agentLabel(entry.key) }}</span>
                <span class="agent-count">{{ entry.value }}</span>
              </div>
              <div class="agent-bar-track">
                <div class="agent-bar-fill"
                     [style.width.%]="maxAgentCount > 0 ? (entry.value / maxAgentCount) * 100 : 0">
                </div>
              </div>
            </div>
          }
          @if (!agentEntries.length) {
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

    .page-header { margin-bottom: 2rem; }

    .page-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 1.5rem; color: #dae2fd; margin: 0 0 0.25rem 0;
    }

    .page-subtitle {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; text-transform: uppercase; color: #464554; letter-spacing: 0.08em;
    }

    /* KPI Cards */
    .metrics-grid {
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 1rem; margin-bottom: 1.5rem;
    }

    .metric-card {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.15);
      border-radius: 8px; padding: 1.5rem;
      display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
    }

    .metric-value {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700; font-size: 1.875rem; color: #c0c1ff;
    }
    .metric-value.metric-done { color: #10b981; }
    .metric-value.metric-processing { color: #c0c1ff; }
    .metric-value.metric-error { color: #ffb4ab; }

    .metric-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; text-transform: uppercase; color: #908fa0;
      letter-spacing: 0.06em; text-align: center;
    }

    /* Charts row */
    .charts-row {
      display: grid; grid-template-columns: 1fr 300px;
      gap: 1.5rem; margin-bottom: 1.5rem;
    }

    .chart-card {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.15);
      border-radius: 8px; padding: 1.25rem;
    }

    .chart-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 0.9rem; color: #dae2fd; margin: 0 0 1rem 0;
    }

    .bar-chart-wrap { width: 100%; overflow: hidden; }
    .bar-svg { width: 100%; height: 150px; display: block; }

    .empty-chart {
      font-family: 'Inter', sans-serif; font-size: 13px; color: #908fa0; margin: 0;
    }

    /* Donut */
    .donut-wrap { display: flex; align-items: center; gap: 1.25rem; }

    .donut-legend { display: flex; flex-direction: column; gap: 0.5rem; }

    .legend-item { display: flex; align-items: center; gap: 0.5rem; }

    .legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

    .legend-label {
      font-family: 'Inter', sans-serif; font-size: 12px; color: #908fa0; flex: 1;
    }

    .legend-val {
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #c0c1ff; font-weight: 700;
    }

    /* Bottom panels */
    .panels-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.5rem;
    }

    .panel-card {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.15);
      border-radius: 8px; padding: 1.5rem;
    }

    .panel-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 1rem; color: #dae2fd; margin: 0 0 1rem 0;
    }

    .alert-row {
      display: flex; align-items: center; gap: 0.625rem;
      padding: 0.5rem 0.625rem; margin-bottom: 0.375rem;
      border-radius: 4px;
    }
    .alert-row-link {
      text-decoration: none; cursor: pointer;
      transition: background 150ms ease;
    }
    .alert-row-link:hover { background: rgba(192,193,255,0.06); }
    .alert-row:last-child { margin-bottom: 0; }

    .alert-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }

    .alert-info { flex: 1; min-width: 0; }
    .alert-marker {
      font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600;
      color: #dae2fd;
    }
    .alert-value {
      font-family: 'JetBrains Mono', monospace; font-size: 12px;
      color: #a09fb2; font-weight: 400;
    }
    .alert-meta {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #7c7b8f; margin-top: 2px;
    }

    .alert-text { font-family: 'Inter', sans-serif; font-size: 14px; color: #c7c4d7; }

    .agent-row { margin-bottom: 0.75rem; }

    .agent-info {
      display: flex; justify-content: space-between; margin-bottom: 0.375rem;
    }

    .agent-name { font-family: 'Inter', sans-serif; font-size: 13px; color: #c7c4d7; }

    .agent-count { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #908fa0; }

    .agent-bar-track {
      height: 4px; background: rgba(70,69,84,0.3); border-radius: 2px; overflow: hidden;
    }

    .agent-bar-fill {
      height: 100%; background: #494bd6;
      border-radius: 2px; transition: width 600ms cubic-bezier(0.4,0,0.2,1);
    }

    .empty-panel { font-family: 'Inter', sans-serif; font-size: 13px; color: #908fa0; margin: 0; }
  `]
})
export class DashboardComponent implements OnInit {
  private http = inject(HttpClient);

  counts = { total: 0, done: 0, processing: 0, error: 0, pending: 0 };
  criticalAlerts: AlertItem[] = [];
  agentCounts: Record<string, number> = {};
  agentEntries: { key: string; value: number }[] = [];
  maxAgentCount = 0;

  timeline: DayBar[] = [];
  gridLines: { y: number; val: number }[] = [];

  donutSegments: { status: string; label: string; color: string; count: number; dash: string; offset: string }[] = [];

  insights: InsightPayload | null = null;
  riskDonutSegments: { key: string; label: string; color: string; count: number; dash: string; offset: string }[] = [];

  private readonly CIRC = 2 * Math.PI * 48; // circumference for r=48

  ngOnInit(): void {
    this.timeline = this.buildTimeline([]);

    this.http.get<InsightPayload>(`${environment.apiUrl}/dashboard/insights`).subscribe({
      next: p => {
        this.insights = p;
        this.riskDonutSegments = this.buildRiskDonut(p.risk_distribution);
      },
      error: () => {}
    });

    this.http.get<any[]>(`${environment.apiUrl}/alerts?severity=critical`)
      .subscribe(alerts => {
        this.criticalAlerts = alerts.slice(0, 10).map(a => ({
          marker: a.marker, value: a.value, severity: a.severity, exam_id: a.exam_id
        }));
      });

    this.http.get<Exam[]>(`${environment.apiUrl}/exams`)
      .subscribe(exams => {
        this.counts.total    = exams.length;
        this.counts.done     = exams.filter(e => e.status === 'done').length;
        this.counts.processing = exams.filter(e => e.status === 'processing').length;
        this.counts.error    = exams.filter(e => e.status === 'error').length;
        this.counts.pending  = exams.filter(e => e.status === 'pending').length;

        const ac: Record<string, number> = {};
        for (const exam of exams) {
          for (const r of exam.results ?? []) {
            ac[r.agent_type] = (ac[r.agent_type] ?? 0) + 1;
          }
        }
        this.agentCounts = ac;
        this.agentEntries = Object.entries(ac)
          .map(([key, value]) => ({ key, value }))
          .sort((a, b) => b.value - a.value);
        this.maxAgentCount = this.agentEntries[0]?.value ?? 0;

        this.timeline = this.buildTimeline(exams);
        this.gridLines = this.buildGridLines();
        this.donutSegments = this.buildDonut();
      });
  }

  barHeight(count: number): number {
    const maxCount = Math.max(...this.timeline.map(d => d.count), 1);
    return Math.round((count / maxCount) * 100);
  }

  agentLabel(type: string): string {
    return AGENT_LABELS[type] ?? type;
  }

  private buildTimeline(exams: Exam[]): DayBar[] {
    const days: DayBar[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      days.push({ key, label, count: 0 });
    }
    for (const exam of exams) {
      const key = exam.created_at.slice(0, 10);
      const day = days.find(d => d.key === key);
      if (day) day.count++;
    }
    return days;
  }

  private buildGridLines(): { y: number; val: number }[] {
    const maxCount = Math.max(...this.timeline.map(d => d.count), 1);
    const step = maxCount <= 5 ? 1 : Math.ceil(maxCount / 4);
    const lines = [];
    for (let v = step; v <= maxCount; v += step) {
      const y = 120 - Math.round((v / maxCount) * 100);
      lines.push({ y, val: v });
    }
    return lines;
  }

  private buildDonut(): typeof this.donutSegments {
    const segs = [
      { status: 'done',       label: 'Concluídos',  color: '#10b981', count: this.counts.done },
      { status: 'processing', label: 'Processando', color: '#c0c1ff', count: this.counts.processing },
      { status: 'error',      label: 'Com Erro',    color: '#ffb4ab', count: this.counts.error },
      { status: 'pending',    label: 'Pendentes',   color: '#464554', count: this.counts.pending },
    ];
    const total = this.counts.total || 1;
    let offsetAcc = 0;
    return segs.map(s => {
      const frac = s.count / total;
      const dash = `${frac * this.CIRC} ${this.CIRC}`;
      const offset = `${-offsetAcc * this.CIRC}`;
      offsetAcc += frac;
      return { ...s, dash, offset };
    });
  }

  private buildRiskDonut(dist: InsightPayload['risk_distribution']): typeof this.riskDonutSegments {
    const segs = [
      { key: 'critical', label: 'Crítico', color: '#ff6450', count: dist.critical },
      { key: 'high',     label: 'Alto',    color: '#ffcb6b', count: dist.high },
      { key: 'medium',   label: 'Médio',   color: '#c0c1ff', count: dist.medium },
      { key: 'low',      label: 'Baixo',   color: '#4ad6a0', count: dist.low },
      { key: 'none',     label: 'Sem alerta', color: '#464554', count: dist.none },
    ];
    const total = segs.reduce((s, x) => s + x.count, 0) || 1;
    let offsetAcc = 0;
    return segs.map(s => {
      const frac = s.count / total;
      const dash = `${frac * this.CIRC} ${this.CIRC}`;
      const offset = `${-offsetAcc * this.CIRC}`;
      offsetAcc += frac;
      return { ...s, dash, offset };
    });
  }

  severityColor(sev: string): string {
    return { critical: '#ff6450', high: '#ffcb6b', medium: '#c0c1ff', low: '#4ad6a0', none: '#7c7b8f' }[sev?.toLowerCase()] ?? '#7c7b8f';
  }
}
