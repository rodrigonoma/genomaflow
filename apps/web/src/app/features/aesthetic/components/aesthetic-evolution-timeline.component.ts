/**
 * AestheticEvolutionTimelineComponent (V2 Fase 4)
 *
 * Gráfico de linhas (Chart.js via ng2-charts) com 6 séries dos aggregate
 * scores ao longo do tempo. Pontos null geram gap visível.
 *
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase4-design.md §7
 */
import {
  Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartConfiguration, ChartData, Point } from 'chart.js';
import { Chart, registerables } from 'chart.js';

import { EvolutionPoint } from '../services/aesthetic-facial.service';

// Registra componentes Chart.js (line, scale, etc) — chamada idempotente
Chart.register(...registerables);

const SCORE_CATEGORIES = [
  { key: 'skin_texture',   label: 'Textura',   color: '#22d3ee' },
  { key: 'spots',          label: 'Manchas',   color: '#fb923c' },
  { key: 'symmetry',       label: 'Simetria',  color: '#34d399' },
  { key: 'wrinkles',       label: 'Rugas',     color: '#a78bfa' },
  { key: 'dark_circles',   label: 'Olheiras',  color: '#94a3b8' },
  { key: 'acne',           label: 'Acne',      color: '#ef4444' },
] as const;

@Component({
  selector: 'app-aesthetic-evolution-timeline',
  standalone: true,
  imports: [CommonModule, BaseChartDirective, DatePipe],
  styles: [`
    :host { display: block; }
    .timeline-wrap {
      padding: 1rem;
      background: rgba(192, 193, 255, 0.04);
      border-radius: 10px;
      border: 1px solid rgba(192, 193, 255, 0.12);
    }
    h4 {
      margin: 0 0 0.5rem;
      color: #c0c1ff;
      font-size: 14px;
      display: flex; align-items: center; gap: 0.4rem;
    }
    .subtitle {
      font-size: 12px;
      color: #9b9aad;
      margin: 0 0 0.75rem;
    }
    .chart-container {
      position: relative;
      width: 100%;
      height: 320px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 0.5rem;
    }
    .empty {
      padding: 1.5rem;
      text-align: center;
      color: #9b9aad;
      font-size: 13px;
    }
    .summary {
      display: flex; gap: 0.75rem; margin-top: 0.5rem;
      font-size: 11px; color: #9b9aad;
      flex-wrap: wrap;
    }
  `],
  template: `
    <div class="timeline-wrap" data-testid="evolution-timeline">
      <h4><span>📈</span> Evolução estética</h4>
      <p class="subtitle">
        Acompanhe a evolução dos scores ao longo das análises do paciente.
      </p>

      @if (points.length === 0) {
        <div class="empty" data-testid="evolution-empty">
          Ainda não há análises concluídas para este paciente.
        </div>
      } @else {
        <div class="chart-container" data-testid="evolution-chart">
          <canvas baseChart
                  [data]="chartData()"
                  [options]="chartOptions"
                  type="line">
          </canvas>
        </div>
        <div class="summary">
          <span>{{ points.length }} análise{{ points.length > 1 ? 's' : '' }}</span>
          <span>·</span>
          <span>De {{ points[0].completed_at | date:'dd/MM/yyyy' }}</span>
          <span>até {{ points[points.length-1].completed_at | date:'dd/MM/yyyy' }}</span>
        </div>
      }
    </div>
  `,
})
export class AestheticEvolutionTimelineComponent implements OnChanges {
  @Input() points: EvolutionPoint[] = [];
  @Output() analysisClick = new EventEmitter<string>();

  readonly chartData = signal<ChartData<'line', (number | null)[], string>>({
    labels: [],
    datasets: [],
  });

  readonly chartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    spanGaps: false, // null vira gap (esperado pra análises sem aggregate)
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      y: {
        min: 0, max: 100,
        ticks: { color: '#9b9aad', stepSize: 20 },
        grid: { color: 'rgba(192,193,255,0.08)' },
      },
      x: {
        ticks: { color: '#9b9aad', maxRotation: 0, autoSkip: true },
        grid: { color: 'rgba(192,193,255,0.05)' },
      },
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: '#dae2fd', boxWidth: 12, font: { size: 11 } },
      },
      tooltip: {
        callbacks: {
          title: (items) => items[0].label || '',
          label: (item) => {
            const v = item.parsed.y;
            return `${item.dataset.label}: ${v == null ? '—' : v + '/100'}`;
          },
        },
      },
    },
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['points']) this._rebuildChart();
  }

  private _rebuildChart(): void {
    if (!this.points || this.points.length === 0) {
      this.chartData.set({ labels: [], datasets: [] });
      return;
    }
    // Labels = data formatada
    const labels = this.points.map(p =>
      new Date(p.completed_at).toLocaleDateString('pt-BR'));

    const datasets = SCORE_CATEGORIES.map(cat => ({
      label: cat.label,
      data: this.points.map(p => p.aggregate_scores[cat.key as keyof EvolutionPoint['aggregate_scores']]),
      borderColor: cat.color,
      backgroundColor: cat.color + '33',  // 20% alpha
      tension: 0.3,
      pointRadius: 4,
      pointHoverRadius: 6,
      spanGaps: false,
    }));

    this.chartData.set({ labels, datasets });
  }
}
