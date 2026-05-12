/**
 * AnalysisResultComponent
 *
 * Orquestrador rico do resultado de análise estética (F1 — Facial).
 * Recebe AestheticAnalysisDetail e renderiza:
 *  - Header com data, tipo, status e botão "Comparar"
 *  - Score geral (computed — média das métricas)
 *  - Photo overlay com app-photo-overlay + app-layer-toolbar
 *  - Métricas individuais com barras horizontais
 *  - Observações qualitativas
 *  - Protocolo de tratamento (treatment_protocol cards)
 *  - Recomendações de estilo de vida (com disclaimer CRN)
 *  - Disclaimer obrigatório no footer (§13 da spec)
 *
 * Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md §13
 * Plan: docs/superpowers/plans/2026-05-11-aesthetic-f1-facial.md Task 21
 */
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { PhotoOverlayComponent } from './photo-overlay.component';
import { LayerToolbarComponent, MetricSummary } from './layer-toolbar.component';
import { TreatmentProtocolCardsComponent } from './treatment-protocol-cards.component';
import {
  AestheticAnalysisDetail,
  AnalysisType,
  MetricData,
} from '../models/analysis.model';
import { PhotoOverlayService } from '../services/photo-overlay.service';
import {
  QuickCreateDialogComponent,
  QuickCreateDialogData,
  QuickCreateDialogResult,
} from '../../agenda/quick-create-dialog.component';
import { PdfPreviewModalComponent } from './pdf-preview-modal.component';

// ---------------------------------------------------------------------------
// Treatment protocol sub-type (parsed from recommendations JSON)
// ---------------------------------------------------------------------------

export interface TreatmentProtocolItem {
  treatment_id?: string | null;
  treatment_name: string;
  indication_text: string;
  sessions_recommended: number;
  interval_days: number;
  urgency: string;
  expected_outcome: string;
  in_catalog?: boolean;
  requires_medico?: boolean;
  cost_estimate_brl_min?: number | null;
  cost_estimate_brl_max?: number | null;
}

// ---------------------------------------------------------------------------
// Lifestyle recommendations sub-type
// ---------------------------------------------------------------------------

export interface MacroRecommendation {
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
}

export interface LifestyleRecommendations {
  calories?: number;
  macros?: MacroRecommendation;
  hydration_ml?: number;
  exercise_minutes?: number;
  foods?: {
    to_emphasize?: string[];
    to_minimize?: string[];
  };
  disclaimer?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-analysis-result',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatIconModule, PhotoOverlayComponent, LayerToolbarComponent, TreatmentProtocolCardsComponent],
  styles: [`
    :host { display: block; }

    .aesthetic-analysis-result {
      font-family: 'Inter', sans-serif;
      color: #dae2fd;
      background: rgba(10, 10, 20, 0.92);
      border-radius: 12px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    /* ---- Header ---- */
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    header h3 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 1.1rem;
      font-weight: 700;
      color: #dae2fd;
      margin: 0;
    }
    .status-badge {
      display: inline-block;
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      margin-left: 0.5rem;
    }
    .status-done    { background: rgba(52, 211, 153, 0.15); color: #34d399; }
    .status-pending { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
    .status-processing { background: rgba(96, 165, 250, 0.15); color: #60a5fa; }
    .status-error   { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .btn-compare {
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      padding: 0.4rem 0.9rem;
      background: rgba(192, 193, 255, 0.08);
      color: #c0c1ff;
      border: 1px solid rgba(192, 193, 255, 0.2);
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-compare:hover { background: rgba(192, 193, 255, 0.16); }
    .download-pdf-btn {
      font-size: 13px;
      color: #94a3b8;
      border-color: rgba(148, 163, 184, 0.3);
      white-space: nowrap;
    }
    .download-pdf-btn:hover { color: #dae2fd; border-color: rgba(218, 226, 253, 0.4); }

    /* ---- Score banner ---- */
    .score-banner {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .score-circle {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100px;
      height: 100px;
      border-radius: 50%;
      border: 4px solid #c0c1ff;
      background: rgba(192, 193, 255, 0.06);
    }
    .score-value {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 2rem;
      font-weight: 700;
      color: #dae2fd;
      line-height: 1;
    }
    .score-label {
      font-size: 11px;
      color: #9b9aad;
      margin-top: 0.15rem;
      text-align: center;
    }

    /* ---- Photo section ---- */
    .photo-section {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .photo-gallery {
      flex: 1;
      min-width: 200px;
    }
    .photo-nav {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
      flex-wrap: wrap;
    }
    .thumb-btn {
      padding: 0.2rem 0.5rem;
      font-size: 11px;
      background: rgba(192, 193, 255, 0.06);
      color: #9b9aad;
      border: 1px solid rgba(192, 193, 255, 0.15);
      border-radius: 4px;
      cursor: pointer;
    }
    .thumb-btn.active {
      background: rgba(192, 193, 255, 0.2);
      color: #dae2fd;
      border-color: rgba(192, 193, 255, 0.4);
    }

    /* ---- Metrics bars ---- */
    .metrics-bars {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .metrics-bars h4 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 14px;
      font-weight: 600;
      color: #dae2fd;
      margin: 0 0 0.5rem;
    }
    .metric-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .metric-name {
      font-size: 12px;
      color: #9b9aad;
      width: 140px;
      flex-shrink: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bar-track {
      flex: 1;
      height: 6px;
      background: rgba(192, 193, 255, 0.08);
      border-radius: 3px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .metric-score {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #9b9aad;
      width: 50px;
      text-align: right;
      flex-shrink: 0;
    }
    .confidence-note {
      font-size: 11px;
      color: #fbbf24;
      margin: 0.25rem 0 0;
    }

    /* ---- Observations ---- */
    .observations h4,
    .treatments h4,
    .lifestyle h4 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 14px;
      font-weight: 600;
      color: #dae2fd;
      margin: 0 0 0.75rem;
    }
    .observations p {
      font-size: 13px;
      color: #9b9aad;
      line-height: 1.6;
      margin: 0;
    }

    /* ---- Treatment cards ---- */
    .treatment-card {
      background: rgba(192, 193, 255, 0.04);
      border: 1px solid rgba(192, 193, 255, 0.1);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.75rem;
    }
    .treatment-card h5 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 13px;
      font-weight: 600;
      color: #dae2fd;
      margin: 0 0 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .treatment-card p {
      font-size: 12px;
      color: #9b9aad;
      margin: 0.25rem 0;
      line-height: 1.5;
    }
    .outcome {
      font-style: italic;
      color: #7c7b8f !important;
      font-size: 11px !important;
    }

    /* ---- Badges ---- */
    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-new      { background: rgba(52, 211, 153, 0.12); color: #34d399; border: 1px solid rgba(52,211,153,0.3); }
    .urgency-high   { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    .urgency-medium { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
    .urgency-low    { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }
    .urgency-elective { background: rgba(148, 163, 184, 0.1); color: #7c7b8f; }

    /* ---- Lifestyle ---- */
    .lifestyle-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }
    .lifestyle-card {
      background: rgba(192, 193, 255, 0.04);
      border: 1px solid rgba(192, 193, 255, 0.08);
      border-radius: 6px;
      padding: 0.75rem;
    }
    .lifestyle-card .label {
      font-size: 11px;
      color: #7c7b8f;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }
    .lifestyle-card .value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      font-weight: 600;
      color: #dae2fd;
    }
    .foods-list {
      margin: 0;
      padding-left: 1.25rem;
      font-size: 12px;
      color: #9b9aad;
      line-height: 1.6;
    }
    .foods-section h5 {
      font-size: 12px;
      font-weight: 600;
      color: #9b9aad;
      margin: 0.5rem 0 0.25rem;
    }
    .disclaimer-crn {
      font-size: 11px;
      color: #7c7b8f;
      font-style: italic;
      margin: 0.5rem 0 0;
      padding: 0.5rem 0.75rem;
      background: rgba(192,193,255,0.03);
      border-left: 2px solid rgba(192,193,255,0.2);
      border-radius: 3px;
    }

    /* ---- Footer disclaimer ---- */
    .disclaimer {
      font-size: 11px;
      color: #7c7b8f;
      line-height: 1.6;
      padding: 0.75rem 1rem;
      background: rgba(192, 193, 255, 0.03);
      border: 1px solid rgba(192, 193, 255, 0.08);
      border-radius: 6px;
      border-left: 3px solid rgba(192, 193, 255, 0.2);
    }
  `],
  template: `
    <section class="aesthetic-analysis-result">

      <!-- ================================================================ -->
      <!-- Header                                                             -->
      <!-- ================================================================ -->
      <header>
        <h3>
          Análise {{ analysisTypeLabel }} · {{ analysis.created_at | date:'dd/MM/yyyy HH:mm' }}
          <span class="status-badge status-{{ analysis.status }}">{{ analysis.status }}</span>
        </h3>
        <div class="header-actions">
          <button mat-stroked-button class="download-pdf-btn" (click)="openPdfPreview()"
                  data-testid="download-pdf-btn">
            <mat-icon>picture_as_pdf</mat-icon> Visualizar PDF
          </button>
          <button class="btn-compare" (click)="compareRequested.emit(analysis.id)">
            Comparar análises
          </button>
        </div>
      </header>

      <!-- ================================================================ -->
      <!-- Score geral                                                        -->
      <!-- ================================================================ -->
      @if (overallScore() !== null) {
        <div class="score-banner">
          <div class="score-circle">
            <span class="score-value">{{ overallScore() }}</span>
            <span class="score-label">Score geral</span>
          </div>
        </div>
      }

      <!-- ================================================================ -->
      <!-- Photo overlay + layer toolbar                                      -->
      <!-- ================================================================ -->
      @if (currentPhotoUrl()) {
        <div class="photo-section">
          <div class="photo-gallery">
            <app-photo-overlay
              [photoUrl]="currentPhotoUrl()!"
              [metrics]="analysis.metrics ?? {}"
              [activeLayers]="activeLayers()"
              [opacity]="overlayOpacity()" />

            @if ((analysis.photo_ids?.length ?? 0) > 1) {
              <div class="photo-nav">
                @for (id of analysis.photo_ids; track id; let i = $index) {
                  <button class="thumb-btn"
                          [class.active]="selectedPhotoIndex() === i"
                          (click)="selectedPhotoIndex.set(i)">
                    Foto {{ i + 1 }}
                  </button>
                }
              </div>
            }
          </div>

          @if (availableLayers().length > 0) {
            <app-layer-toolbar
              [availableMetrics]="availableLayers()"
              [(activeLayers)]="activeLayers"
              [(opacity)]="overlayOpacity" />
          }
        </div>
      }

      <!-- ================================================================ -->
      <!-- Métricas individuais                                               -->
      <!-- ================================================================ -->
      @if (metricsList().length > 0) {
        <section class="metrics-bars">
          <h4>Métricas</h4>
          @for (m of metricsList(); track m[0]) {
            <div class="metric-row">
              <span class="metric-name">
                {{ m[0] }}{{ m[1].confidence === 'low' ? ' *' : '' }}
              </span>
              <div class="bar-track">
                <div class="bar-fill"
                     [style.background]="colorFor(m[0])"
                     [style.width.%]="m[1].score"></div>
              </div>
              <span class="metric-score">{{ m[1].score }}/100</span>
            </div>
          }
          @if (hasLowConfidence()) {
            <p class="confidence-note">* Métricas com confiança baixa exigem avaliação clínica.</p>
          }
        </section>
      }

      <!-- ================================================================ -->
      <!-- Observações qualitativas                                           -->
      <!-- ================================================================ -->
      @if (qualitativeObservation()) {
        <section class="observations">
          <h4>Observações da IA</h4>
          <p>{{ qualitativeObservation() }}</p>
        </section>
      }

      <!-- ================================================================ -->
      <!-- Protocolo de tratamento                                            -->
      <!-- ================================================================ -->
      @if (treatmentProtocol().length > 0) {
        <section class="treatments">
          <h4>Protocolo sugerido</h4>
          <app-treatment-protocol-cards
            [items]="treatmentProtocol()"
            (schedule)="onScheduleTreatment($event)" />
        </section>
      }

      <!-- ================================================================ -->
      <!-- Recomendações de estilo de vida                                    -->
      <!-- ================================================================ -->
      @if (lifestyleRec()) {
        <section class="lifestyle">
          <h4>Recomendações de estilo de vida</h4>
          <div class="lifestyle-grid">
            @if (lifestyleRec()!.calories !== undefined) {
              <div class="lifestyle-card">
                <div class="label">Calorias</div>
                <div class="value">{{ lifestyleRec()!.calories }} kcal</div>
              </div>
            }
            @if (lifestyleRec()!.hydration_ml !== undefined) {
              <div class="lifestyle-card">
                <div class="label">Hidratação</div>
                <div class="value">{{ lifestyleRec()!.hydration_ml }} ml</div>
              </div>
            }
            @if (lifestyleRec()!.exercise_minutes !== undefined) {
              <div class="lifestyle-card">
                <div class="label">Exercício</div>
                <div class="value">{{ lifestyleRec()!.exercise_minutes }} min/dia</div>
              </div>
            }
            @if (lifestyleRec()!.macros) {
              @if (lifestyleRec()!.macros!.protein_g !== undefined) {
                <div class="lifestyle-card">
                  <div class="label">Proteína</div>
                  <div class="value">{{ lifestyleRec()!.macros!.protein_g }}g</div>
                </div>
              }
              @if (lifestyleRec()!.macros!.carbs_g !== undefined) {
                <div class="lifestyle-card">
                  <div class="label">Carboidratos</div>
                  <div class="value">{{ lifestyleRec()!.macros!.carbs_g }}g</div>
                </div>
              }
              @if (lifestyleRec()!.macros!.fat_g !== undefined) {
                <div class="lifestyle-card">
                  <div class="label">Gorduras</div>
                  <div class="value">{{ lifestyleRec()!.macros!.fat_g }}g</div>
                </div>
              }
            }
          </div>

          @if (lifestyleRec()!.foods) {
            <div class="foods-section">
              @if (lifestyleRec()!.foods!.to_emphasize?.length) {
                <h5>Alimentos recomendados</h5>
                <ul class="foods-list">
                  @for (f of lifestyleRec()!.foods!.to_emphasize!; track f) {
                    <li>{{ f }}</li>
                  }
                </ul>
              }
              @if (lifestyleRec()!.foods!.to_minimize?.length) {
                <h5>Alimentos a reduzir</h5>
                <ul class="foods-list">
                  @for (f of lifestyleRec()!.foods!.to_minimize!; track f) {
                    <li>{{ f }}</li>
                  }
                </ul>
              }
            </div>
          }

          @if (lifestyleRec()!.disclaimer) {
            <p class="disclaimer-crn">{{ lifestyleRec()!.disclaimer }}</p>
          }
        </section>
      }

      <!-- ================================================================ -->
      <!-- Disclaimer obrigatório (§13)                                       -->
      <!-- ================================================================ -->
      <footer class="disclaimer" data-testid="mandatory-disclaimer">
        ⚕ Análise gerada por IA com base nas fotos enviadas e perfil informado.
        Sugestões de tratamento são suporte à decisão do(a) profissional habilitado(a),
        não substituem avaliação clínica presencial. Orientações de estilo de vida não
        substituem consulta com nutricionista (CRN).
      </footer>

    </section>
  `,
})
export class AnalysisResultComponent implements OnInit {
  // -------------------------------------------------------------------------
  // Inputs
  // -------------------------------------------------------------------------

  @Input({ required: true }) analysis!: AestheticAnalysisDetail;

  /** Mapa photo_id → signed URL */
  @Input() photoUrls = signal<Record<string, string>>({});

  // -------------------------------------------------------------------------
  // Outputs
  // -------------------------------------------------------------------------

  @Output() compareRequested = new EventEmitter<string>();

  /** Emitido quando o usuário clica em "Agendar agora" em um tratamento.
   *  F6 (agenda) irá consumir este evento para abrir o fluxo de agendamento. */
  readonly scheduleTreatment = output<TreatmentProtocolItem>();

  // -------------------------------------------------------------------------
  // State (signals)
  // -------------------------------------------------------------------------

  readonly activeLayers     = signal<string[]>([]);
  readonly overlayOpacity   = signal<number>(0.4);
  readonly selectedPhotoIndex = signal<number>(0);

  // -------------------------------------------------------------------------
  // Computed
  // -------------------------------------------------------------------------

  /** Média aritmética dos scores das métricas. Retorna null se não houver métricas. */
  readonly overallScore = computed<number | null>(() => {
    const metrics = this.analysis?.metrics;
    if (!metrics) return null;
    const values = Object.values(metrics).map(m => m.score);
    if (values.length === 0) return null;
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.round(avg);
  });

  /** Entradas do mapa de métricas ordenadas por chave. */
  readonly metricsList = computed<[string, MetricData][]>(() => {
    const metrics = this.analysis?.metrics;
    if (!metrics) return [];
    return Object.entries(metrics).sort(([a], [b]) => a.localeCompare(b));
  });

  /** Métricas que possuem regions com pelo menos 1 região (para o toolbar). */
  readonly availableLayers = computed<MetricSummary[]>(() => {
    const metrics = this.analysis?.metrics;
    if (!metrics) return [];
    return Object.entries(metrics)
      .filter(([, m]) => m.regions && m.regions.length > 0)
      .map(([key, m]) => ({ key, count: m.regions.length }));
  });

  /** URL assinada da foto selecionada atualmente. */
  readonly currentPhotoUrl = computed<string | null>(() => {
    const ids = this.analysis?.photo_ids;
    if (!ids || ids.length === 0) return null;
    const id = ids[this.selectedPhotoIndex()];
    return this.photoUrls()[id] ?? null;
  });

  /** Texto qualitativo das observações, se presente. */
  readonly qualitativeObservation = computed<string | null>(() => {
    const obs = this.analysis?.observations as Record<string, unknown> | null;
    if (!obs) return null;
    const q = obs['qualitative'];
    return typeof q === 'string' ? q : null;
  });

  /** Lista de treatment_protocol parsed. */
  readonly treatmentProtocol = computed<TreatmentProtocolItem[]>(() => {
    const rec = this.analysis?.recommendations as Record<string, unknown> | null;
    if (!rec) return [];
    const proto = rec['treatment_protocol'];
    if (!Array.isArray(proto)) return [];
    return proto as TreatmentProtocolItem[];
  });

  /** Lifestyle recommendations, se presente. */
  readonly lifestyleRec = computed<LifestyleRecommendations | null>(() => {
    const rec = this.analysis?.recommendations as Record<string, unknown> | null;
    if (!rec) return null;
    const lr = rec['lifestyle_recommendations'];
    if (!lr || typeof lr !== 'object') return null;
    return lr as LifestyleRecommendations;
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  ngOnInit(): void {
    // Inicializa activeLayers com todas as métricas que têm regions
    const initial = this.availableLayers().map(m => m.key);
    this.activeLayers.set(initial);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Verifica se alguma métrica tem confidence === 'low'. */
  hasLowConfidence(): boolean {
    const metrics = this.analysis?.metrics;
    if (!metrics) return false;
    return Object.values(metrics).some(m => m.confidence === 'low');
  }

  /** Cor hex para uma métrica (delegado ao PhotoOverlayService). */
  colorFor(metricKey: string): string {
    return this.overlayService.colorForMetric(metricKey);
  }

  /** Label legível para o tipo de análise. */
  get analysisTypeLabel(): string {
    const map: Record<AnalysisType, string> = {
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
    return map[this.analysis?.analysis_type] ?? this.analysis?.analysis_type ?? '';
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  /** Opens the quick-create-dialog pre-populated with procedimento_estetico data. */
  onScheduleTreatment(item: TreatmentProtocolItem): void {
    this.scheduleTreatment.emit(item); // keep event for parent listeners

    const analysisId = this.analysis?.id;
    const notesText =
      `Procedimento sugerido: ${item.treatment_name}` +
      (item.treatment_id ? ` (id: ${item.treatment_id})` : '') +
      (analysisId ? ` · Análise: ${analysisId}` : '');

    const dialogData: QuickCreateDialogData = {
      start_at: new Date().toISOString(),
      default_duration_minutes: 60,
      preset_appointment_type: 'procedimento_estetico',
      preset_subject_id: this.analysis?.subject_id ?? undefined,
      preset_notes: notesText,
      preset_series: (item.sessions_recommended != null && item.sessions_recommended > 1 && item.interval_days != null && item.interval_days >= 1)
        ? { count: item.sessions_recommended, interval_days: item.interval_days }
        : undefined,
    };

    this.dialog.open<QuickCreateDialogComponent, QuickCreateDialogData, QuickCreateDialogResult>(
      QuickCreateDialogComponent,
      { panelClass: 'dark-dialog', autoFocus: false, data: dialogData, width: '560px' },
    );
  }

  /** Opens a modal preview of the analysis PDF (TODO#6).
   *  The modal handles the HTTP fetch, iframe display and local download. */
  openPdfPreview(): void {
    const id = this.analysis?.id;
    if (!id) return;
    this.dialog.open(PdfPreviewModalComponent, {
      data: { analysisId: id },
      width: '900px',
      maxWidth: '95vw',
    });
  }

  // -------------------------------------------------------------------------
  // DI
  // -------------------------------------------------------------------------

  private readonly overlayService = new PhotoOverlayService();
  private readonly dialog = inject(MatDialog);
}
