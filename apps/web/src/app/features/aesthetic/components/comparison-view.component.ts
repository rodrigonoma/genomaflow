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
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { forkJoin } from 'rxjs';
import { AestheticFacialService } from '../services/aesthetic-facial.service';
import { PhotoOverlayComponent } from './photo-overlay.component';
import {
  AestheticAnalysisDetail,
  AestheticAnalysisListItem,
  AnalysisType,
  CompareResult,
  Metrics,
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
  imports: [DatePipe, PhotoOverlayComponent],
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

    /* ---- Comparison photos ---- */
    .comparison-photos {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      margin-top: 1.5rem;
    }
    @media (max-width: 768px) {
      .comparison-photos { grid-template-columns: 1fr; }
    }
    .photo-side h4 {
      margin: 0 0 .5rem;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 13px;
      font-weight: 600;
      opacity: .8;
    }
    .overlay-toggle {
      display: flex;
      align-items: center;
      gap: .5rem;
      margin-top: .5rem;
      font-size: 12px;
      color: #9b9aad;
      cursor: pointer;
    }
    .overlay-toggle input[type="checkbox"] {
      cursor: pointer;
      accent-color: #c0c1ff;
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

        <!-- Comparison photos with overlay -->
        @if (baselineAnalysis() && currentAnalysis()) {
          <div class="comparison-photos">
            <div class="photo-side">
              <h4>Antes ({{ baselineAnalysis()?.created_at | date:'shortDate' }})</h4>
              <app-photo-overlay
                [photoUrl]="firstPhotoUrl(baselineAnalysis())"
                [metrics]="baselineAnalysis()?.metrics ?? {}"
                [activeLayers]="metricKeys(baselineAnalysis())"
                [opacity]="0.4" />
            </div>
            <div class="photo-side">
              <h4>Depois ({{ currentAnalysis()?.created_at | date:'shortDate' }})</h4>
              <app-photo-overlay
                [photoUrl]="firstPhotoUrl(currentAnalysis())"
                [metrics]="overlayMetrics()"
                [activeLayers]="metricKeys(currentAnalysis())"
                [opacity]="0.4" />
              <label class="overlay-toggle">
                <input type="checkbox" [checked]="showBaselineOverlay()" (change)="toggleBaselineOverlay()" />
                Mostrar contorno do antes sobreposto
              </label>
            </div>
          </div>
        }

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

  readonly currentAnalysisId    = input<string | null | undefined>();
  readonly availableBaselines   = input<AestheticAnalysisListItem[]>([]);

  // -------------------------------------------------------------------------
  // State signals
  // -------------------------------------------------------------------------

  readonly selectedBaselineId = signal<string | null>(null);
  readonly comparison         = signal<CompareResult | null>(null);
  readonly loading            = signal(false);
  readonly error              = signal<string | null>(null);

  // Photo overlay signals
  readonly baselineAnalysis   = signal<AestheticAnalysisDetail | null>(null);
  readonly currentAnalysis    = signal<AestheticAnalysisDetail | null>(null);
  readonly photoUrls          = signal<Record<string, string>>({});
  readonly showBaselineOverlay = signal(true);

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

  /**
   * Combina métricas do current com métricas do baseline (prefixadas com _baseline)
   * quando showBaselineOverlay está ativo.
   */
  readonly overlayMetrics = computed<Metrics>(() => {
    const cur: Metrics = this.currentAnalysis()?.metrics ?? {};
    if (!this.showBaselineOverlay()) return cur;
    const base: Metrics = this.baselineAnalysis()?.metrics ?? {};
    const merged: Metrics = { ...cur };
    for (const [k, v] of Object.entries(base)) {
      merged[`${k}_baseline`] = v;
    }
    return merged;
  });

  // -------------------------------------------------------------------------
  // Public methods
  // -------------------------------------------------------------------------

  onBaselineChange(baselineId: string): void {
    if (!baselineId) {
      this.selectedBaselineId.set(null);
      this.comparison.set(null);
      this.baselineAnalysis.set(null);
      this.currentAnalysis.set(null);
      return;
    }

    const currentId = this.currentAnalysisId();
    if (!currentId) return;

    this.selectedBaselineId.set(baselineId);
    this.loading.set(true);
    this.error.set(null);
    this.comparison.set(null);
    this.baselineAnalysis.set(null);
    this.currentAnalysis.set(null);

    // Fetch compare result + both analysis details in parallel
    forkJoin({
      compare:  this.svc.compareAnalyses(currentId, baselineId),
      baseline: this.svc.getAnalysis(baselineId),
      current:  this.svc.getAnalysis(currentId),
    }).subscribe({
      next: ({ compare, baseline, current }) => {
        this.comparison.set(compare);
        this.baselineAnalysis.set(baseline);
        this.currentAnalysis.set(current);
        this.loading.set(false);

        // Fetch photo URLs for first photo of each analysis
        this._fetchPhotoUrls(baseline, current);
      },
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Erro ao comparar análises.';
        this.error.set(msg);
        this.loading.set(false);
      },
    });
  }

  /** Fetch presigned URLs for the first photo of each analysis. */
  private _fetchPhotoUrls(
    baseline: AestheticAnalysisDetail,
    current: AestheticAnalysisDetail,
  ): void {
    const ids = new Set<string>();
    if (baseline.photo_ids?.length) ids.add(baseline.photo_ids[0]);
    if (current.photo_ids?.length) ids.add(current.photo_ids[0]);
    if (!ids.size) return;

    const requests: Record<string, ReturnType<typeof this.svc.getPhotoUrl>> = {};
    for (const id of ids) {
      requests[id] = this.svc.getPhotoUrl(id);
    }

    forkJoin(requests).subscribe({
      next: (urlMap) => {
        const resolved: Record<string, string> = {};
        for (const [id, resp] of Object.entries(urlMap)) {
          resolved[id] = resp.url;
        }
        this.photoUrls.set(resolved);
      },
      error: () => { /* photo URLs are best-effort; silently ignore */ },
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

  // -------------------------------------------------------------------------
  // Photo overlay helpers
  // -------------------------------------------------------------------------

  firstPhotoUrl(a: AestheticAnalysisDetail | null): string {
    if (!a || !a.photo_ids?.length) return '';
    return this.photoUrls()[a.photo_ids[0]] ?? '';
  }

  metricKeys(a: AestheticAnalysisDetail | null): string[] {
    return a?.metrics ? Object.keys(a.metrics) : [];
  }

  toggleBaselineOverlay(): void {
    this.showBaselineOverlay.update(v => !v);
  }
}
