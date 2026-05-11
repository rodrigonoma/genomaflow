/**
 * ComparisonViewComponent
 *
 * Compara 2 análises estéticas lado a lado.
 * Exibe dropdown de baseline, tabela de deltas por métrica (coloridos)
 * e destaque do overall_change.
 *
 * Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md
 * Plan: docs/superpowers/plans/2026-05-11-aesthetic-f1-facial.md Task 23
 */
import {
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { AestheticFacialService } from '../services/aesthetic-facial.service';
import {
  AestheticAnalysisListItem,
  AnalysisType,
  CompareResult,
} from '../models/analysis.model';

// ---------------------------------------------------------------------------
// Label map
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<AnalysisType, string> = {
  facial:    'Facial',
  eyelids:   'Pálpebras',
  neck:      'Pescoço',
  breast:    'Mamas',
  arms:      'Braços',
  abdomen:   'Abdômen',
  legs:      'Pernas',
  glutes:    'Glúteos',
  full_body: 'Corpo Inteiro',
  other:     'Outro',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-comparison-view',
  standalone: true,
  imports: [DatePipe],
  styles: [`
    :host { display: block; }

    .comparison-wrap {
      font-family: 'Inter', sans-serif;
      color: #dae2fd;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    /* ---- Header ---- */
    .comparison-header h3 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 1rem;
      font-weight: 700;
      color: #dae2fd;
      margin: 0 0 0.75rem;
    }

    /* ---- Dropdown ---- */
    .baseline-select-wrap {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .baseline-label {
      font-size: 12px;
      color: #9b9aad;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .baseline-select {
      background: rgba(192, 193, 255, 0.06);
      color: #dae2fd;
      border: 1px solid rgba(192, 193, 255, 0.18);
      border-radius: 6px;
      padding: 0.35rem 0.75rem;
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      cursor: pointer;
      outline: none;
    }
    .baseline-select option {
      background: #1a1a2e;
      color: #dae2fd;
    }
    .baseline-select:focus {
      border-color: rgba(192, 193, 255, 0.4);
    }

    /* ---- Loading spinner ---- */
    .loading-state {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem 0;
      color: #9b9aad;
      font-size: 13px;
    }
    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(192, 193, 255, 0.15);
      border-top-color: #c0c1ff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ---- Error state ---- */
    .error-state {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .error-message {
      font-size: 13px;
      color: #ef4444;
    }
    .btn-retry {
      font-family: 'Inter', sans-serif;
      font-size: 12px;
      padding: 0.3rem 0.7rem;
      background: rgba(239, 68, 68, 0.1);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.25);
      border-radius: 5px;
      cursor: pointer;
      width: fit-content;
    }

    /* ---- Overall banner ---- */
    .overall-banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 15px;
      font-weight: 700;
    }
    .overall-positive {
      background: rgba(52, 211, 153, 0.1);
      border: 1px solid rgba(52, 211, 153, 0.25);
      color: #34d399;
    }
    .overall-negative {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.25);
      color: #ef4444;
    }
    .overall-neutral {
      background: rgba(192, 193, 255, 0.06);
      border: 1px solid rgba(192, 193, 255, 0.15);
      color: #9b9aad;
    }

    /* ---- Delta table ---- */
    .delta-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .delta-table th {
      text-align: left;
      padding: 0.45rem 0.75rem;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #7c7b8f;
      border-bottom: 1px solid rgba(192, 193, 255, 0.1);
    }
    .delta-table td {
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid rgba(192, 193, 255, 0.06);
      vertical-align: middle;
    }
    .metric-name-cell {
      color: #9b9aad;
      font-size: 12px;
    }
    .delta-cell {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 600;
    }
    .delta-positive { color: #34d399; }
    .delta-negative { color: #ef4444; }
    .delta-neutral  { color: #9b9aad; }

    /* ---- Placeholder ---- */
    .placeholder {
      padding: 1.5rem 0;
      color: #7c7b8f;
      font-size: 13px;
      text-align: center;
    }
  `],
  template: `
    <div class="comparison-wrap">

      <!-- ================================================================ -->
      <!-- Header + Dropdown                                                  -->
      <!-- ================================================================ -->
      <div class="comparison-header">
        <h3>Comparar análises</h3>
        <div class="baseline-select-wrap">
          <span class="baseline-label">Baseline:</span>
          <select
            class="baseline-select"
            data-testid="baseline-select"
            [value]="selectedBaselineId() ?? ''"
            (change)="onBaselineChange(getSelectValue($event))"
          >
            <option value="">— selecione —</option>
            @for (b of availableBaselines(); track b.id) {
              <option [value]="b.id">
                {{ b.created_at | date:'dd/MM/yyyy' }} · {{ typeLabel(b.analysis_type) }}
              </option>
            }
          </select>
        </div>
      </div>

      <!-- ================================================================ -->
      <!-- Loading                                                            -->
      <!-- ================================================================ -->
      @if (loading()) {
        <div class="loading-state" data-testid="loading-state">
          <div class="spinner"></div>
          <span>Comparando...</span>
        </div>
      }

      <!-- ================================================================ -->
      <!-- Error                                                              -->
      <!-- ================================================================ -->
      @if (error() && !loading()) {
        <div class="error-state" data-testid="error-state">
          <span class="error-message">{{ error() }}</span>
          <button class="btn-retry" (click)="retryCompare()">Tentar novamente</button>
        </div>
      }

      <!-- ================================================================ -->
      <!-- Resultado                                                          -->
      <!-- ================================================================ -->
      @if (comparison() && !loading() && !error()) {

        <!-- Overall change banner -->
        <div
          class="overall-banner"
          [class.overall-positive]="comparison()!.overall_change > 0"
          [class.overall-negative]="comparison()!.overall_change < 0"
          [class.overall-neutral]="comparison()!.overall_change === 0"
          data-testid="overall-banner"
        >
          @if (comparison()!.overall_change > 0) {
            Melhora geral: +{{ comparison()!.overall_change }} pontos
          } @else if (comparison()!.overall_change < 0) {
            Variação geral: {{ comparison()!.overall_change }} pontos
          } @else {
            Sem variação geral
          }
        </div>

        <!-- Deltas table -->
        <table class="delta-table" data-testid="delta-table">
          <thead>
            <tr>
              <th>Métrica</th>
              <th>Δ (Delta)</th>
            </tr>
          </thead>
          <tbody>
            @for (entry of deltaEntries(); track entry[0]) {
              <tr data-testid="delta-row" [attr.data-metric]="entry[0]">
                <td class="metric-name-cell">{{ entry[0] }}</td>
                <td
                  class="delta-cell"
                  [class.delta-positive]="entry[1] > 0"
                  [class.delta-negative]="entry[1] < 0"
                  [class.delta-neutral]="entry[1] === 0"
                >
                  {{ entry[1] > 0 ? '+' : '' }}{{ entry[1] }}
                </td>
              </tr>
            }
          </tbody>
        </table>

      }

      <!-- ================================================================ -->
      <!-- Placeholder quando nenhum baseline selecionado                    -->
      <!-- ================================================================ -->
      @if (!comparison() && !loading() && !error() && !selectedBaselineId()) {
        <div class="placeholder" data-testid="placeholder">
          Selecione uma baseline acima para visualizar a comparação.
        </div>
      }

    </div>
  `,
})
export class ComparisonViewComponent {
  // -------------------------------------------------------------------------
  // Inputs (signal-based)
  // -------------------------------------------------------------------------

  readonly currentAnalysisId    = input<string>();
  readonly availableBaselines   = input<AestheticAnalysisListItem[]>([]);

  // -------------------------------------------------------------------------
  // State signals
  // -------------------------------------------------------------------------

  readonly selectedBaselineId = signal<string | null>(null);
  readonly comparison         = signal<CompareResult | null>(null);
  readonly loading            = signal(false);
  readonly error              = signal<string | null>(null);

  // -------------------------------------------------------------------------
  // DI
  // -------------------------------------------------------------------------

  private readonly svc = inject(AestheticFacialService);

  // -------------------------------------------------------------------------
  // Computed helpers
  // -------------------------------------------------------------------------

  /** Entradas do mapa de deltas ordenadas por chave. */
  deltaEntries(): [string, number][] {
    const cmp = this.comparison();
    if (!cmp) return [];
    return Object.entries(cmp.deltas).sort(([a], [b]) => a.localeCompare(b));
  }

  // -------------------------------------------------------------------------
  // Public methods
  // -------------------------------------------------------------------------

  onBaselineChange(baselineId: string): void {
    if (!baselineId) {
      this.selectedBaselineId.set(null);
      this.comparison.set(null);
      return;
    }

    const currentId = this.currentAnalysisId();
    if (!currentId) return;

    this.selectedBaselineId.set(baselineId);
    this.loading.set(true);
    this.error.set(null);
    this.comparison.set(null);

    this.svc.compareAnalyses(currentId, baselineId).subscribe({
      next: (result) => {
        this.comparison.set(result);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Erro ao comparar análises.';
        this.error.set(msg);
        this.loading.set(false);
      },
    });
  }

  retryCompare(): void {
    const baseline = this.selectedBaselineId();
    if (baseline) this.onBaselineChange(baseline);
  }

  // -------------------------------------------------------------------------
  // Template helpers
  // -------------------------------------------------------------------------

  getSelectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  typeLabel(type: AnalysisType): string {
    return TYPE_LABELS[type] ?? type;
  }
}
