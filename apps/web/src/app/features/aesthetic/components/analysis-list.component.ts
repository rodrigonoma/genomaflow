/**
 * AnalysisListComponent
 *
 * Lista paginada de análises estéticas do paciente com signals reativos.
 * Carrega ao init via AestheticFacialService.listAnalyses, expõe eventos
 * de seleção de linha, empty-state e loading/error states.
 *
 * Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md
 * Plan: docs/superpowers/plans/2026-05-11-aesthetic-f1-facial.md Task 22
 */
import {
  Component,
  EventEmitter,
  OnInit,
  Output,
  inject,
  input,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { AestheticFacialService } from '../services/aesthetic-facial.service';
import {
  AestheticAnalysisListItem,
  AnalysisStatus,
  AnalysisType,
} from '../models/analysis.model';

// ---------------------------------------------------------------------------
// Label maps
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<AnalysisStatus, string> = {
  pending:    'Aguardando',
  processing: 'Processando',
  done:       'Concluída',
  error:      'Erro',
};

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
  selector: 'app-analysis-list',
  standalone: true,
  imports: [DatePipe],
  styles: [`
    :host { display: block; }

    .analysis-list-wrap {
      font-family: 'Inter', sans-serif;
      color: #dae2fd;
    }

    /* ---- Table ---- */
    .analysis-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .analysis-table th {
      text-align: left;
      padding: 0.5rem 0.75rem;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #7c7b8f;
      border-bottom: 1px solid rgba(192, 193, 255, 0.1);
    }
    .analysis-table td {
      padding: 0.65rem 0.75rem;
      border-bottom: 1px solid rgba(192, 193, 255, 0.06);
      vertical-align: middle;
    }
    .analysis-table tr.analysis-row {
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .analysis-table tr.analysis-row:hover {
      background: rgba(192, 193, 255, 0.05);
    }

    /* ---- Status badge ---- */
    .status-badge {
      display: inline-block;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .status-done       { background: rgba(52, 211, 153, 0.14); color: #34d399; }
    .status-pending    { background: rgba(251, 191, 36, 0.14);  color: #fbbf24; }
    .status-processing { background: rgba(96, 165, 250, 0.14);  color: #60a5fa; }
    .status-error      { background: rgba(239, 68, 68, 0.14);   color: #ef4444; }

    /* ---- Credits chip ---- */
    .credits-chip {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #9b9aad;
    }

    /* ---- Action link ---- */
    .btn-action {
      font-family: 'Inter', sans-serif;
      font-size: 12px;
      padding: 0.25rem 0.6rem;
      background: rgba(192, 193, 255, 0.07);
      color: #c0c1ff;
      border: 1px solid rgba(192, 193, 255, 0.18);
      border-radius: 5px;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-action:hover { background: rgba(192, 193, 255, 0.14); }

    /* ---- Loading spinner ---- */
    .loading-state {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1.5rem 0;
      color: #9b9aad;
      font-size: 13px;
    }
    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid rgba(192, 193, 255, 0.15);
      border-top-color: #c0c1ff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ---- Error state ---- */
    .error-state {
      padding: 1.5rem 0;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      align-items: flex-start;
    }
    .error-message {
      font-size: 13px;
      color: #ef4444;
    }
    .btn-retry {
      font-family: 'Inter', sans-serif;
      font-size: 12px;
      padding: 0.35rem 0.8rem;
      background: rgba(239, 68, 68, 0.1);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.25);
      border-radius: 5px;
      cursor: pointer;
    }
    .btn-retry:hover { background: rgba(239, 68, 68, 0.18); }

    /* ---- Empty state ---- */
    .empty-state {
      padding: 2rem 0;
      text-align: center;
      color: #7c7b8f;
      font-size: 13px;
    }
    .empty-icon {
      font-size: 2rem;
      margin-bottom: 0.5rem;
      display: block;
    }
  `],
  template: `
    <div class="analysis-list-wrap">

      <!-- ================================================================ -->
      <!-- Loading                                                            -->
      <!-- ================================================================ -->
      @if (loading()) {
        <div class="loading-state" data-testid="loading-state">
          <div class="spinner"></div>
          <span>Carregando análises...</span>
        </div>
      }

      <!-- ================================================================ -->
      <!-- Error                                                              -->
      <!-- ================================================================ -->
      @if (error() && !loading()) {
        <div class="error-state" data-testid="error-state">
          <span class="error-message">{{ error() }}</span>
          <button class="btn-retry" (click)="load()">Tentar novamente</button>
        </div>
      }

      <!-- ================================================================ -->
      <!-- Tabela                                                             -->
      <!-- ================================================================ -->
      @if (!loading() && !error()) {

        @if (analyses().length === 0) {
          <!-- Empty state -->
          <div class="empty-state" data-testid="empty-state">
            <span class="empty-icon">📋</span>
            <p>Nenhuma análise encontrada para este paciente.</p>
          </div>
        } @else {
          <table class="analysis-table" data-testid="analysis-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Créditos</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              @for (item of analyses(); track item.id) {
                <tr
                  class="analysis-row"
                  data-testid="analysis-row"
                  (click)="analysisSelected.emit(item.id)"
                  [attr.data-id]="item.id"
                >
                  <td>{{ item.created_at | date:'dd/MM/yyyy HH:mm' }}</td>
                  <td>{{ typeLabel(item.analysis_type) }}</td>
                  <td>
                    <span class="status-badge status-{{ item.status }}">
                      {{ statusLabel(item.status) }}
                    </span>
                  </td>
                  <td>
                    <span class="credits-chip">{{ item.credits_charged }}</span>
                  </td>
                  <td>
                    <button
                      class="btn-action"
                      (click)="$event.stopPropagation(); analysisSelected.emit(item.id)"
                    >
                      Ver
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      }

    </div>
  `,
})
export class AnalysisListComponent implements OnInit {
  // -------------------------------------------------------------------------
  // Inputs (signal-based)
  // -------------------------------------------------------------------------

  readonly subjectId    = input<string>();
  readonly analysisType = input<string | undefined>();

  // -------------------------------------------------------------------------
  // Outputs
  // -------------------------------------------------------------------------

  @Output() analysisSelected = new EventEmitter<string>();

  // -------------------------------------------------------------------------
  // State signals
  // -------------------------------------------------------------------------

  readonly analyses = signal<AestheticAnalysisListItem[]>([]);
  readonly loading  = signal(false);
  readonly error    = signal<string | null>(null);

  // -------------------------------------------------------------------------
  // DI
  // -------------------------------------------------------------------------

  private readonly svc = inject(AestheticFacialService);

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  ngOnInit(): void {
    this.load();
  }

  // -------------------------------------------------------------------------
  // Public methods
  // -------------------------------------------------------------------------

  load(): void {
    const subjectId = this.subjectId();
    if (!subjectId) return;

    this.loading.set(true);
    this.error.set(null);

    const type = this.analysisType() as Parameters<typeof this.svc.listAnalyses>[1];

    this.svc.listAnalyses(subjectId, type).subscribe({
      next: (resp) => {
        this.analyses.set(resp.items);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Erro ao carregar análises.';
        this.error.set(msg);
        this.loading.set(false);
      },
    });
  }

  // -------------------------------------------------------------------------
  // Label helpers
  // -------------------------------------------------------------------------

  typeLabel(type: AnalysisType): string {
    return TYPE_LABELS[type] ?? type;
  }

  statusLabel(status: AnalysisStatus): string {
    return STATUS_LABELS[status] ?? status;
  }
}
