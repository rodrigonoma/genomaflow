import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { NpsService, NpsResponseRow, NpsStats } from './nps.service';

interface DayBucket {
  key: string;
  label: string;
  promoters: number;
  passives: number;
  detractors: number;
  responded: number;
  score: number | null;
}

@Component({
  selector: 'app-nps',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe, RouterModule,
    MatButtonModule, MatIconModule, MatFormFieldModule,
    MatSelectModule, MatProgressBarModule, MatSnackBarModule,
  ],
  template: `
    <div class="nps-page">
      <div class="page-header">
        <div>
          <h1 class="page-title">NPS — Pesquisa de satisfação</h1>
          <span class="page-subtitle">SCORE NET PROMOTER · ÚLTIMOS {{ period() }} DIAS</span>
        </div>
        <div class="header-actions">
          <mat-form-field appearance="outline" class="period-field">
            <mat-label>Período</mat-label>
            <mat-select [(ngModel)]="periodSel" (ngModelChange)="onPeriodChange()">
              <mat-option [value]="30">Últimos 30 dias</mat-option>
              <mat-option [value]="60">Últimos 60 dias</mat-option>
              <mat-option [value]="90">Últimos 90 dias</mat-option>
              <mat-option [value]="180">Últimos 6 meses</mat-option>
              <mat-option [value]="365">Último ano</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
      </div>

      @if (loading()) {
        <p class="muted center">Carregando dados...</p>
      } @else {
        <!-- KPIs ───────────────────────────────────────────────── -->
        <div class="metrics-grid">
          <div class="metric-card">
            <span class="metric-value" [class.score-high]="(stats()?.nps_score ?? 0) >= 50"
                                       [class.score-mid]="(stats()?.nps_score ?? 0) >= 0 && (stats()?.nps_score ?? 0) < 50"
                                       [class.score-low]="(stats()?.nps_score ?? 0) < 0">
              {{ stats()?.nps_score ?? '—' }}
            </span>
            <span class="metric-label">NPS SCORE</span>
            <span class="metric-hint">{{ npsScoreHint() }}</span>
          </div>
          <div class="metric-card">
            <span class="metric-value">{{ stats()?.total_sent ?? 0 }}</span>
            <span class="metric-label">PESQUISAS ENVIADAS</span>
          </div>
          <div class="metric-card">
            <span class="metric-value">{{ stats()?.total_responded ?? 0 }}</span>
            <span class="metric-label">RESPONDIDAS</span>
            <span class="metric-hint">{{ responseRate() }}% de resposta</span>
          </div>
          <div class="metric-card">
            <span class="metric-value score-high">{{ stats()?.promoters ?? 0 }}</span>
            <span class="metric-label">PROMOTORES</span>
            <span class="metric-hint">Score 9–10</span>
          </div>
          <div class="metric-card">
            <span class="metric-value score-mid">{{ stats()?.passives ?? 0 }}</span>
            <span class="metric-label">NEUTROS</span>
            <span class="metric-hint">Score 7–8</span>
          </div>
          <div class="metric-card">
            <span class="metric-value score-low">{{ stats()?.detractors ?? 0 }}</span>
            <span class="metric-label">DETRATORES</span>
            <span class="metric-hint">Score 0–6</span>
          </div>
        </div>

        <!-- Distribuição (barra horizontal) ───────────────────── -->
        @if ((stats()?.total_responded ?? 0) > 0) {
          <div class="chart-card">
            <h2 class="chart-title">Distribuição de respostas</h2>
            <div class="bar-stack">
              @if (promoterPct() > 0) {
                <div class="bar-segment seg-promoter" [style.width.%]="promoterPct()" [title]="(stats()?.promoters ?? 0) + ' promotores'">
                  <span>{{ promoterPct() }}%</span>
                </div>
              }
              @if (passivePct() > 0) {
                <div class="bar-segment seg-passive" [style.width.%]="passivePct()" [title]="(stats()?.passives ?? 0) + ' neutros'">
                  <span>{{ passivePct() }}%</span>
                </div>
              }
              @if (detractorPct() > 0) {
                <div class="bar-segment seg-detractor" [style.width.%]="detractorPct()" [title]="(stats()?.detractors ?? 0) + ' detratores'">
                  <span>{{ detractorPct() }}%</span>
                </div>
              }
            </div>
            <div class="bar-legend">
              <span class="legend-item"><span class="dot dot-promoter"></span> Promotores</span>
              <span class="legend-item"><span class="dot dot-passive"></span> Neutros</span>
              <span class="legend-item"><span class="dot dot-detractor"></span> Detratores</span>
            </div>
          </div>
        }

        <!-- Score ao longo do tempo (sparkline SVG simples) ───── -->
        @if (timelinePoints().length >= 2) {
          <div class="chart-card">
            <h2 class="chart-title">Score por semana</h2>
            <svg class="trend-svg" viewBox="0 0 600 180" preserveAspectRatio="xMidYMid meet">
              <!-- grid -->
              @for (g of gridLines; track g.y) {
                <line [attr.x1]="40" [attr.y1]="g.y" [attr.x2]="590" [attr.y2]="g.y"
                      stroke="rgba(70,69,84,0.25)" stroke-width="1"/>
                <text [attr.x]="36" [attr.y]="g.y + 3" text-anchor="end"
                      font-family="'JetBrains Mono', monospace" font-size="9" fill="#7c7b8f">{{ g.val }}</text>
              }
              <!-- linha 0 destacada -->
              <line x1="40" [attr.y1]="yFor(0)" x2="590" [attr.y2]="yFor(0)"
                    stroke="rgba(192,193,255,0.4)" stroke-dasharray="3,3" stroke-width="1"/>

              <!-- linha de score -->
              <polyline [attr.points]="trendPoints()"
                        fill="none" stroke="#c0c1ff" stroke-width="2"/>

              <!-- pontos -->
              @for (pt of trendDots(); track pt.x) {
                <circle [attr.cx]="pt.x" [attr.cy]="pt.y" r="3" fill="#c0c1ff"/>
              }
            </svg>
          </div>
        }

        <!-- Tabela de respostas ─────────────────────────────────── -->
        <div class="table-card">
          <h2 class="chart-title">Respostas recentes</h2>
          @if (responded().length === 0) {
            <p class="muted center">Nenhuma resposta registrada no período.</p>
          } @else {
            <table class="responses-table">
              <thead>
                <tr>
                  <th>Paciente</th>
                  <th>Score</th>
                  <th>Categoria</th>
                  <th>Comentário</th>
                  <th>Respondida em</th>
                  <th>Canal</th>
                </tr>
              </thead>
              <tbody>
                @for (r of responded(); track r.id) {
                  <tr>
                    <td>{{ r.subject_name ?? '—' }}</td>
                    <td>
                      <span class="score-badge"
                            [class.score-high]="r.score! >= 9"
                            [class.score-mid]="r.score! >= 7 && r.score! <= 8"
                            [class.score-low]="r.score! <= 6">
                        {{ r.score }}
                      </span>
                    </td>
                    <td>{{ categoryLabel(r.score!) }}</td>
                    <td class="feedback-cell">{{ r.feedback || '—' }}</td>
                    <td>{{ r.responded_at | date:'dd/MM/yyyy HH:mm' }}</td>
                    <td>{{ channelLabel(r.sent_via) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>

        <!-- Pesquisas pendentes (sem resposta) ──────────────────── -->
        @if (pending().length > 0) {
          <div class="table-card">
            <h2 class="chart-title">Pendentes ({{ pending().length }})</h2>
            <p class="muted small">Pesquisas enviadas que ainda não foram respondidas.</p>
            <table class="responses-table">
              <thead>
                <tr>
                  <th>Paciente</th>
                  <th>Enviada em</th>
                  <th>Canal</th>
                </tr>
              </thead>
              <tbody>
                @for (r of pending(); track r.id) {
                  <tr>
                    <td>{{ r.subject_name ?? '—' }}</td>
                    <td>{{ r.sent_at | date:'dd/MM/yyyy HH:mm' }}</td>
                    <td>{{ channelLabel(r.sent_via) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; background: #0b1326; min-height: 100vh; }
    .nps-page { padding: 2rem; max-width: 1280px; margin: 0 auto; color: #dae2fd; }

    .page-header {
      display: flex; align-items: flex-end; justify-content: space-between;
      gap: 1rem; flex-wrap: wrap; margin-bottom: 2rem;
    }
    .page-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.75rem; color: #dae2fd; margin: 0;
      letter-spacing: -0.02em;
    }
    .page-subtitle {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #7c7b8f; text-transform: uppercase; letter-spacing: 0.1em;
    }
    .header-actions { display: flex; align-items: center; gap: 12px; }
    .period-field { width: 220px; }

    .muted { color: #7c7b8f; font-size: 0.875rem; }
    .center { text-align: center; padding: 2rem; }
    .small { font-size: 12px; padding: 4px 1rem 12px; margin: 0; }

    .metrics-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem; margin-bottom: 1.5rem;
    }
    .metric-card {
      background: #111929; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 6px; padding: 1.25rem 1rem;
      display: flex; flex-direction: column; gap: 4px;
    }
    .metric-value {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 2.25rem; line-height: 1; color: #dae2fd;
    }
    .metric-label {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #7c7b8f; text-transform: uppercase; letter-spacing: 0.1em;
    }
    .metric-hint { font-size: 11px; color: #a09fb2; margin-top: 2px; }

    .score-high { color: #4ad6a0; }
    .score-mid  { color: #f7c873; }
    .score-low  { color: #ff6b6b; }

    .chart-card, .table-card {
      background: #111929; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 6px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem;
    }
    .chart-title {
      font-family: 'Space Grotesk', sans-serif; font-size: 1rem; font-weight: 600;
      color: #dae2fd; margin: 0 0 1rem;
    }

    .bar-stack {
      display: flex; height: 36px; border-radius: 4px;
      overflow: hidden; background: #0b1326;
    }
    .bar-segment {
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 600; font-size: 0.875rem;
      transition: width 0.3s;
    }
    .seg-promoter  { background: #4ad6a0; }
    .seg-passive   { background: #f7c873; color: #0b1326; }
    .seg-detractor { background: #ff6b6b; }
    .bar-legend {
      display: flex; gap: 16px; margin-top: 12px;
      font-size: 12px; color: #a09fb2;
    }
    .legend-item { display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .dot-promoter  { background: #4ad6a0; }
    .dot-passive   { background: #f7c873; }
    .dot-detractor { background: #ff6b6b; }

    .trend-svg { width: 100%; height: 200px; }

    .responses-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .responses-table th, .responses-table td {
      padding: 10px 12px; text-align: left;
      border-bottom: 1px solid rgba(70,69,84,0.2);
    }
    .responses-table th {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #7c7b8f; text-transform: uppercase; letter-spacing: 0.05em;
      font-weight: 600;
    }
    .responses-table td { color: #dae2fd; }
    .responses-table tbody tr:hover { background: rgba(192,193,255,0.04); }
    .feedback-cell { max-width: 320px; color: #a09fb2; font-size: 0.8125rem; }

    .score-badge {
      display: inline-block; padding: 2px 10px; border-radius: 12px;
      font-weight: 700; font-size: 0.875rem;
      background: rgba(255,255,255,0.05);
    }
    .score-badge.score-high { background: rgba(74,214,160,0.15); color: #4ad6a0; }
    .score-badge.score-mid  { background: rgba(247,200,115,0.15); color: #f7c873; }
    .score-badge.score-low  { background: rgba(255,107,107,0.15); color: #ff6b6b; }
  `],
})
export class NpsComponent implements OnInit {
  private service = inject(NpsService);
  private snack = inject(MatSnackBar);

  loading = signal(true);
  items = signal<NpsResponseRow[]>([]);
  stats = signal<NpsStats | null>(null);
  period = signal(90);
  periodSel = 90;

  // Y-axis grid for trend chart
  gridLines = [
    { y: 20,  val: '100' },
    { y: 60,  val: '50'  },
    { y: 100, val: '0'   },
    { y: 140, val: '-50' },
    { y: 170, val: '-100' },
  ];

  responded = computed(() =>
    this.items().filter(i => i.score !== null && i.responded_at)
  );

  pending = computed(() =>
    this.items().filter(i => i.score === null && !i.responded_at)
  );

  responseRate = computed(() => {
    const s = this.stats();
    if (!s || s.total_sent === 0) return 0;
    return Math.round((s.total_responded / s.total_sent) * 100);
  });

  promoterPct = computed(() => {
    const s = this.stats();
    if (!s || s.total_responded === 0) return 0;
    return Math.round((s.promoters / s.total_responded) * 100);
  });
  passivePct = computed(() => {
    const s = this.stats();
    if (!s || s.total_responded === 0) return 0;
    return Math.round((s.passives / s.total_responded) * 100);
  });
  detractorPct = computed(() => {
    const s = this.stats();
    if (!s || s.total_responded === 0) return 0;
    return Math.round((s.detractors / s.total_responded) * 100);
  });

  // ── Trend chart ──────────────────────────────────────────────
  timelinePoints = computed<DayBucket[]>(() => {
    const responded = this.responded();
    if (responded.length === 0) return [];
    // bucketing semanal
    const buckets = new Map<string, DayBucket>();
    for (const r of responded) {
      const date = new Date(r.responded_at!);
      const week = startOfWeekKey(date);
      const label = formatWeekLabel(date);
      const b = buckets.get(week) ?? {
        key: week, label,
        promoters: 0, passives: 0, detractors: 0, responded: 0, score: null,
      };
      b.responded++;
      if (r.score! >= 9) b.promoters++;
      else if (r.score! >= 7) b.passives++;
      else b.detractors++;
      buckets.set(week, b);
    }
    const list = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
    for (const b of list) {
      b.score = b.responded > 0
        ? Math.round(((b.promoters - b.detractors) / b.responded) * 100)
        : null;
    }
    return list;
  });

  trendPoints = computed(() => {
    const pts = this.timelinePoints();
    if (pts.length < 2) return '';
    return pts.map((b, i) => `${this.xFor(i, pts.length)},${this.yFor(b.score!)}`).join(' ');
  });

  trendDots = computed(() =>
    this.timelinePoints().map((b, i) => ({
      x: this.xFor(i, this.timelinePoints().length),
      y: this.yFor(b.score!),
    }))
  );

  ngOnInit() { this.refresh(); }

  onPeriodChange() {
    this.period.set(this.periodSel);
    this.refresh();
  }

  refresh() {
    this.loading.set(true);
    this.service.list(this.period()).subscribe({
      next: r => {
        this.items.set(r.items);
        this.stats.set(r.stats);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err?.error?.error ?? 'Erro ao carregar respostas NPS';
        this.snack.open(msg, 'Fechar', { duration: 4000 });
      },
    });
  }

  npsScoreHint(): string {
    const s = this.stats()?.nps_score;
    if (s === null || s === undefined) return 'Sem dados ainda';
    if (s >= 75) return 'Excelente';
    if (s >= 50) return 'Ótimo';
    if (s >= 0) return 'Razoável';
    return 'Atenção: negativo';
  }

  categoryLabel(score: number): string {
    if (score >= 9) return 'Promotor';
    if (score >= 7) return 'Neutro';
    return 'Detrator';
  }

  channelLabel(via: string): string {
    return via === 'email' ? 'Email' : via === 'whatsapp' ? 'WhatsApp' : 'Manual';
  }

  // ── helpers ──────────────────────────────────────────────────
  xFor(i: number, total: number): number {
    if (total <= 1) return 320;
    return 40 + (i / (total - 1)) * 550;
  }
  yFor(score: number): number {
    // Score range: -100 a 100. Map: 100 → y=20, -100 → y=170 (linear)
    const clamped = Math.max(-100, Math.min(100, score));
    return 20 + ((100 - clamped) / 200) * 150;
  }
}

function startOfWeekKey(d: Date): string {
  const dt = new Date(d);
  const day = dt.getDay(); // 0=Sun
  const diff = dt.getDate() - day;
  dt.setDate(diff);
  dt.setHours(0, 0, 0, 0);
  return dt.toISOString().slice(0, 10);
}

function formatWeekLabel(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
