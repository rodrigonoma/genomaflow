/**
 * FacialAnalysisTabComponent
 *
 * Orquestrador signal-based do fluxo de análise facial dentro do patient-detail.
 *
 * States (signal-based state machine):
 *   idle → consent_check → consent_ask | guide → upload → processing → result
 *   idle → list
 *   result → compare
 *
 * Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md
 * Plan: docs/superpowers/plans/2026-05-11-aesthetic-f1-facial.md Task 24
 */
import {
  Component,
  DestroyRef,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
  ViewChild,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';

import { AestheticFacialService } from '../services/aesthetic-facial.service';
import { AestheticWsService, AestheticEvent } from '../services/aesthetic-ws.service';
import {
  AestheticAnalysisDetail,
  AestheticAnalysisListItem,
  AestheticConsent,
  AnalysisType,
} from '../models/analysis.model';

import { ConsentModalComponent, ConsentModalData } from './consent-modal.component';
import { RegionPickerComponent } from './region-picker.component';
import { PhotoQualityGuideComponent } from './photo-quality-guide.component';
import { PhotoUploaderComponent } from './photo-uploader.component';
import { AnalysisResultComponent } from './analysis-result.component';
import { AnalysisListComponent } from './analysis-list.component';
import { ComparisonViewComponent } from './comparison-view.component';
import { TierSelectorComponent, AnalysisTier } from './tier-selector.component';
import { CaptureGuideFacialComponent } from './capture-guide-facial.component';

// ---------------------------------------------------------------------------
// Step type
// ---------------------------------------------------------------------------

export type Step =
  | 'idle'
  | 'tier_choice'   // V2: escolha standard vs advanced antes de region_pick
  | 'region_pick'
  | 'consent_check'
  | 'consent_ask'
  | 'guide'
  | 'capture'       // V2: captura guiada (tier=advanced)
  | 'upload'
  | 'processing'
  | 'result'
  | 'list'
  | 'compare';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-facial-analysis-tab',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    RegionPickerComponent,
    PhotoQualityGuideComponent,
    PhotoUploaderComponent,
    AnalysisResultComponent,
    AnalysisListComponent,
    ComparisonViewComponent,
    TierSelectorComponent,
    CaptureGuideFacialComponent,
  ],
  styles: [`
    :host { display: block; }

    .tab-container {
      font-family: 'Inter', sans-serif;
      color: #dae2fd;
      padding: 1.5rem;
      min-height: 200px;
    }

    /* ---- Idle state ---- */
    .idle-actions {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      align-items: center;
    }

    /* ---- Processing state ---- */
    .processing-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      padding: 2rem;
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(192, 193, 255, 0.15);
      border-top-color: #c0c1ff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .processing-text {
      font-size: 14px;
      color: #9b9aad;
      text-align: center;
    }

    /* ---- Error banner ---- */
    .error-banner {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.25);
      border-radius: 6px;
      color: #ef4444;
      padding: 0.75rem 1rem;
      font-size: 13px;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }

    /* ---- Result actions ---- */
    .result-actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 1rem;
    }
  `],
  template: `
    <div class="tab-container">

      <!-- ================================================================ -->
      <!-- Error banner (global)                                             -->
      <!-- ================================================================ -->
      @if (error()) {
        <div class="error-banner" data-testid="error-banner">
          <span>{{ error() }}</span>
          <button mat-button (click)="error.set(null)">Fechar</button>
        </div>
      }

      <!-- ================================================================ -->
      <!-- IDLE                                                               -->
      <!-- ================================================================ -->
      @if (step() === 'idle') {
        <div class="idle-actions" data-testid="idle-actions">
          <button mat-flat-button color="primary"
                  data-testid="btn-nova-analise"
                  (click)="startNewAnalysis()">
            Nova análise
          </button>
          <button mat-stroked-button
                  data-testid="btn-historico"
                  (click)="step.set('list')">
            Histórico
          </button>
          <button mat-stroked-button
                  data-testid="btn-comparar"
                  (click)="step.set('compare')">
            Comparar
          </button>
        </div>
      }

      <!-- ================================================================ -->
      <!-- TIER_CHOICE — V2: escolha standard vs advanced                    -->
      <!-- ================================================================ -->
      @if (step() === 'tier_choice') {
        <app-tier-selector
          data-testid="tier-selector"
          [standardCost]="standardCost"
          [advancedCost]="advancedCost"
          (tierSelected)="onTierSelected($event)">
        </app-tier-selector>

        <div class="result-actions">
          <button mat-button
                  data-testid="btn-back-idle-from-tier"
                  (click)="step.set('idle')">
            Voltar
          </button>
        </div>
      }

      <!-- ================================================================ -->
      <!-- REGION_PICK                                                        -->
      <!-- ================================================================ -->
      @if (step() === 'region_pick') {
        <app-region-picker
          data-testid="region-picker"
          (regionSelected)="onRegionSelected($event)">
        </app-region-picker>
      }

      <!-- ================================================================ -->
      <!-- CAPTURE — V2 advanced wizard guiado                               -->
      <!-- ================================================================ -->
      @if (step() === 'capture' && currentSessionId()) {
        <app-capture-guide-facial
          data-testid="capture-guide"
          [subjectId]="subject().id"
          [sessionId]="currentSessionId()!"
          (complete)="onCaptureComplete($event)"
          (cancel)="step.set('idle')">
        </app-capture-guide-facial>
      }
      @if (step() === 'capture' && !currentSessionId()) {
        <div data-testid="capture-session-loading" class="processing-wrap">
          <div class="spinner"></div>
          <span class="processing-text">Preparando sessão de captura...</span>
        </div>
      }

      <!-- ================================================================ -->
      <!-- CONSENT_CHECK — spinner while checking                            -->
      <!-- ================================================================ -->
      @if (step() === 'consent_check') {
        <div class="processing-wrap" data-testid="consent-check-spinner">
          <div class="spinner"></div>
          <span class="processing-text">Verificando consentimento...</span>
        </div>
      }

      <!-- ================================================================ -->
      <!-- CONSENT_ASK — opened via MatDialog (step managed externally)      -->
      <!-- Nothing to render here — dialog is opened imperatively            -->
      <!-- ================================================================ -->

      <!-- ================================================================ -->
      <!-- GUIDE                                                              -->
      <!-- ================================================================ -->
      @if (step() === 'guide') {
        <app-photo-quality-guide
          data-testid="photo-quality-guide"
          [region]="selectedRegion()"
          (photosSelected)="onPhotosSelected($event)">
        </app-photo-quality-guide>
      }

      <!-- ================================================================ -->
      <!-- UPLOAD                                                             -->
      <!-- ================================================================ -->
      @if (step() === 'upload') {
        <app-photo-uploader
          #uploader
          data-testid="photo-uploader"
          [subjectId]="subject().id"
          photoType="facial_front"
          (uploadComplete)="onUploadComplete($event)"
          (uploadError)="onUploadError($event)">
        </app-photo-uploader>
      }

      <!-- ================================================================ -->
      <!-- PROCESSING                                                         -->
      <!-- ================================================================ -->
      @if (step() === 'processing') {
        <div class="processing-wrap" data-testid="processing-state">
          <div class="spinner"></div>
          <span class="processing-text">
            Analisando... ~10-15s<br>
            <small style="font-size:11px;color:#7c7b8f">
              Aguarde enquanto a IA processa as fotos.
            </small>
          </span>
        </div>
      }

      <!-- ================================================================ -->
      <!-- RESULT                                                             -->
      <!-- ================================================================ -->
      @if (step() === 'result' && currentAnalysis()) {
        <div data-testid="result-state">
          <app-analysis-result
            [analysis]="currentAnalysis()!"
            [photoUrls]="photoUrls"
            (compareRequested)="onCompareRequested($event)">
          </app-analysis-result>

          <div class="result-actions">
            <button mat-button
                    data-testid="btn-back-idle"
                    (click)="step.set('idle')">
              Voltar
            </button>
          </div>
        </div>
      }

      <!-- ================================================================ -->
      <!-- LIST                                                               -->
      <!-- ================================================================ -->
      @if (step() === 'list') {
        <div data-testid="list-state">
          <app-analysis-list
            [subjectId]="subject().id"
            (analysisSelected)="onAnalysisSelected($event)">
          </app-analysis-list>

          <div class="result-actions">
            <button mat-button
                    data-testid="btn-back-idle-from-list"
                    (click)="step.set('idle')">
              Voltar
            </button>
          </div>
        </div>
      }

      <!-- ================================================================ -->
      <!-- COMPARE                                                            -->
      <!-- ================================================================ -->
      @if (step() === 'compare') {
        <div data-testid="compare-state">
          <app-comparison-view
            [currentAnalysisId]="currentAnalysisId()"
            [availableBaselines]="availableBaselines()">
          </app-comparison-view>

          <div class="result-actions">
            <button mat-button
                    data-testid="btn-back-idle-from-compare"
                    (click)="step.set('idle')">
              Voltar
            </button>
          </div>
        </div>
      }

    </div>
  `,
})
export class FacialAnalysisTabComponent implements OnInit, OnChanges {
  // -------------------------------------------------------------------------
  // Injections
  // -------------------------------------------------------------------------

  private readonly svc         = inject(AestheticFacialService);
  private readonly dialog      = inject(MatDialog);
  private readonly aestheticWs = inject(AestheticWsService);
  private readonly destroyRef  = inject(DestroyRef);

  // -------------------------------------------------------------------------
  // Inputs (signal-based — Angular 18 reactive inputs)
  // -------------------------------------------------------------------------

  /** Subject (paciente / animal) para o qual a análise será criada. */
  readonly subject = input.required<{ id: string; name: string }>();

  /**
   * Deep-link: quando fornecido, carrega a análise pelo ID e avança para o
   * estado `result` diretamente, sem passar pelo fluxo de upload.
   * Passado por patient-detail quando o usuário clica em "Ver análise completa"
   * no timeline-panel.
   */
  @Input() initialAnalysisId?: string | null;

  // -------------------------------------------------------------------------
  // State signals
  // -------------------------------------------------------------------------

  /** Current step in the state machine. */
  readonly step = signal<Step>('idle');

  /** V2: tier selecionado (standard ou advanced). Default standard preserva F1-F6. */
  readonly selectedTier = signal<AnalysisTier>('standard');

  /** V2: session_id criado quando tier=advanced (POST /aesthetic/sessions). */
  readonly currentSessionId = signal<string | null>(null);

  /** Selected anatomical region — defaults to facial for backward compat. */
  readonly selectedRegion = signal<AnalysisType>('facial');

  /**
   * Custos exibidos no TierSelector. Defaults batem com as env vars do
   * backend (AESTHETIC_FACIAL_COST=5, AESTHETIC_FACIAL_COST_ADVANCED=10).
   * Se vier override do servidor no futuro (e.g. GET /aesthetic/pricing),
   * basta atualizar esses signals via setter.
   */
  readonly standardCost = 5;
  readonly advancedCost = 10;

  readonly currentAnalysisId  = signal<string | null>(null);
  readonly currentAnalysis    = signal<AestheticAnalysisDetail | null>(null);

  /**
   * Mapa photo_id → signed URL, carregado on-demand via getPhotoUrl.
   * Passado para AnalysisResultComponent como @Input.
   */
  readonly photoUrls = signal<Record<string, string>>({});

  /** Files selecionados no guide, carregados no uploader. */
  readonly selectedFiles = signal<File[]>([]);

  /** IDs de fotos enviadas pelo uploader. */
  readonly uploadedPhotoIds = signal<string[]>([]);

  /** Análises disponíveis como baseline para comparação. */
  readonly availableBaselines = signal<AestheticAnalysisListItem[]>([]);

  /** Erro global (exibido no banner). */
  readonly error = signal<string | null>(null);

  // -------------------------------------------------------------------------
  // ViewChild — uploader (exists only when step === 'upload')
  // -------------------------------------------------------------------------

  @ViewChild('uploader') uploaderRef?: PhotoUploaderComponent;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialAnalysisId'] && this.initialAnalysisId) {
      this._loadExistingAnalysis(this.initialAnalysisId);
    }
  }

  ngOnInit(): void {
    // If initialAnalysisId was set before the component initialized, load it now.
    if (this.initialAnalysisId) {
      this._loadExistingAnalysis(this.initialAnalysisId);
    }

    // Subscribe to WS events for analysis completion
    this.aestheticWs.events$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event: AestheticEvent) => {
        if (
          event.kind === 'analysis_done' &&
          event.analysis_id === this.currentAnalysisId() &&
          event.subject_id === this.subject().id
        ) {
          this._fetchAnalysisAndAdvance(event.analysis_id);
        } else if (
          event.kind === 'analysis_failed' &&
          event.analysis_id === this.currentAnalysisId()
        ) {
          this.error.set(`Análise falhou: ${event.error_code ?? 'Erro desconhecido'}`);
          this.step.set('idle');
        }
      });
  }

  // -------------------------------------------------------------------------
  // Flow handlers
  // -------------------------------------------------------------------------

  /** Step 1: User clicks "Nova análise" → V2 tier choice first. */
  startNewAnalysis(): void {
    this.step.set('tier_choice');
  }

  /**
   * V2: Tier escolhido → segue para region_pick. tier permanece em
   * selectedTier para o resto do fluxo (consent, upload, createAnalysis).
   */
  onTierSelected(tier: AnalysisTier): void {
    this.selectedTier.set(tier);
    this.currentSessionId.set(null);
    this.step.set('region_pick');
  }

  /** Step 2: Region selected → check consent for the chosen region. */
  onRegionSelected(region: AnalysisType): void {
    this.selectedRegion.set(region);
    this.step.set('consent_check');
    this.checkConsent();
  }

  /** Check consent and advance to guide or open consent modal. */
  checkConsent(): void {
    this.svc.getConsent(this.subject().id).subscribe({
      next: (consent) => {
        // Backend retorna { confirmed: false } quando não existe — objeto truthy
        // mas SEM id/created_at. checar `confirmed` é o discriminador correto.
        const hasValidConsent = !!consent && consent.confirmed === true && !consent.revoked_at;
        if (hasValidConsent) {
          // For sensitive region: also verify reinforced consent covers this region
          if (this._pickedRegionIsSensitive() && !this._hasReinforcedFor(consent, this.selectedRegion())) {
            // Existing consent doesn't cover this sensitive region → open modal in reinforced mode
            this._openConsentModal([this.selectedRegion()]);
            return;
          }
          // V2: tier=advanced abre captura guiada; standard segue guide normal.
          if (this.selectedTier() === 'advanced') {
            this._startAdvancedCapture();
          } else {
            this.step.set('guide');
          }
        } else {
          // No valid consent → open modal; mark reinforced if sensitive
          this._openConsentModal(this._pickedRegionIsSensitive() ? [this.selectedRegion()] : undefined);
        }
      },
      error: (err: unknown) => {
        // 404 → no consent yet → open modal
        const status = (err as { status?: number })?.status;
        if (status === 404) {
          this._openConsentModal(this._pickedRegionIsSensitive() ? [this.selectedRegion()] : undefined);
        } else {
          this.error.set('Erro ao verificar consentimento. Tente novamente.');
          this.step.set('idle');
        }
      },
    });
  }

  /** Photos selected in guide → save to uploader signal and advance. */
  onPhotosSelected(files: File[]): void {
    this.selectedFiles.set(files);
    this.step.set('upload');
    // O <app-photo-uploader> só renderiza quando step==='upload', e o
    // @ViewChild só é resolvido APÓS o ciclo de change detection completar.
    // setTimeout(fn, 0) era racy em prod build — uploaderRef ficava undefined
    // e startUpload nunca era chamado (bug forensicamente confirmado via
    // CloudWatch 2026-05-12: zero POST /aesthetic/photos do tenant estetica).
    // Retry curto até o ref resolver, com bail-out se falhar.
    this._tryStartUpload(files, 0);
  }

  private _tryStartUpload(files: File[], attempt: number): void {
    if (this.uploaderRef) {
      this.uploaderRef.files.set(files);
      this.uploaderRef.startUpload();
      return;
    }
    if (attempt >= 20) {
      // 20 × 25ms = 500ms — se ViewChild não resolveu até aqui, algo está
      // fundamentalmente errado. Surfaceia erro pra UI em vez de spinner eterno.
      this.error.set('Falha ao inicializar o uploader. Recarregue a página.');
      this.step.set('idle');
      return;
    }
    setTimeout(() => this._tryStartUpload(files, attempt + 1), 25);
  }

  /**
   * V2 advanced: cria aesthetic_session (POST /aesthetic/sessions),
   * guarda o ID em currentSessionId e abre o step 'capture' que renderiza
   * o <app-capture-guide-facial>.
   */
  private _startAdvancedCapture(): void {
    this.step.set('capture');
    this.svc.createSession({
      subject_id: this.subject().id,
      session_type: 'facial_analysis',
    }).subscribe({
      next: (sess) => this.currentSessionId.set(sess.id),
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Erro ao criar sessão de captura.';
        this.error.set(msg);
        this.step.set('idle');
      },
    });
  }

  /**
   * V2: captura guiada concluída (5 fotos enviadas com pose + landmarks).
   * Avança direto pra criação da análise (tier=advanced) — pula o step
   * 'upload' que é exclusivo do fluxo standard.
   */
  onCaptureComplete(event: { photoIds: string[]; sessionId: string }): void {
    this.currentSessionId.set(event.sessionId);
    this.onUploadComplete(event.photoIds);
  }

  /** Upload complete → create analysis → go to processing. */
  onUploadComplete(photoIds: string[]): void {
    if (photoIds.length === 0) {
      this.error.set('Nenhuma foto foi enviada com sucesso. Tente novamente.');
      this.step.set('idle');
      return;
    }

    this.uploadedPhotoIds.set(photoIds);

    this.svc.createAnalysis({
      analysis_type: this.selectedRegion(),
      subject_id: this.subject().id,
      photo_ids: photoIds,
      tier: this.selectedTier(),
      session_id: this.currentSessionId() || undefined,
    }).subscribe({
      next: (analysis) => {
        this.currentAnalysisId.set(analysis.id);
        this.step.set('processing');

        // Polling fallback: if WS event doesn't arrive within ~20s, poll
        this._startPollingFallback(analysis.id);
      },
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Erro ao criar análise.';
        this.error.set(msg);
        this.step.set('idle');
      },
    });
  }

  /** Upload encountered an error for a specific file. */
  onUploadError(event: { file: string; error: string }): void {
    // Non-fatal: errors shown inline by PhotoUploaderComponent.
    // Only set global error if we want to surface it.
    // uploadComplete will be emitted with whatever succeeded.
  }

  /** User selected an item from the list → fetch detail → show result. */
  onAnalysisSelected(analysisId: string): void {
    this._fetchAnalysisAndAdvance(analysisId);
  }

  /** AnalysisResultComponent emitted compareRequested → go to compare. */
  onCompareRequested(analysisId: string): void {
    // Load available baselines before switching
    this.svc.listAnalyses(this.subject().id, 'facial').subscribe({
      next: (resp) => {
        this.availableBaselines.set(resp.items.filter(i => i.id !== analysisId));
        this.currentAnalysisId.set(analysisId);
        this.step.set('compare');
      },
      error: () => {
        this.step.set('compare');
      },
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _openConsentModal(reinforced_regions?: string[]): void {
    this.step.set('consent_ask');

    const data: ConsentModalData = {
      subject_id: this.subject().id,
      reinforced_regions,
    };

    const ref = this.dialog.open(ConsentModalComponent, {
      data,
      width: '480px',
    });

    ref.afterClosed().subscribe((confirmed: boolean | undefined) => {
      if (confirmed === true) {
        // V2: tier=advanced cria session + abre captura guiada após consent
        if (this.selectedTier() === 'advanced') {
          this._startAdvancedCapture();
        } else {
          this.step.set('guide');
        }
      } else {
        this.step.set('idle');
      }
    });
  }

  /** Returns true when the currently selected region is anatomically sensitive. */
  private _pickedRegionIsSensitive(): boolean {
    const SENSITIVE = new Set<string>(['breast', 'glutes', 'abdomen']);
    return SENSITIVE.has(this.selectedRegion());
  }

  /** Returns true when existing consent already covers reinforced consent for the given region. */
  private _hasReinforcedFor(consent: AestheticConsent | null, region: string): boolean {
    if (!consent || !consent.reinforced_regions) return false;
    return consent.reinforced_regions.includes(region);
  }

  /**
   * Deep-link loader: fetches an existing analysis by ID and jumps the state
   * machine directly to `result`. Called from ngOnInit/ngOnChanges when
   * `initialAnalysisId` is provided.
   */
  private _loadExistingAnalysis(id: string): void {
    this.svc.getAnalysis(id).subscribe({
      next: async (detail) => {
        this.currentAnalysis.set(detail);
        this.currentAnalysisId.set(detail.id);
        await this._loadPhotoUrls(detail.photo_ids);
        this.step.set('result');
      },
      error: (e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Não foi possível carregar a análise solicitada.';
        this.error.set(msg);
      },
    });
  }

  private _fetchAnalysisAndAdvance(analysisId: string): void {
    this.svc.getAnalysis(analysisId).subscribe({
      next: async (detail) => {
        this.currentAnalysis.set(detail);

        // Fetch signed URLs for each photo
        await this._loadPhotoUrls(detail.photo_ids);

        this.step.set('result');
      },
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Erro ao carregar análise.';
        this.error.set(msg);
        this.step.set('idle');
      },
    });
  }

  private async _loadPhotoUrls(photoIds: string[]): Promise<void> {
    const entries: Record<string, string> = {};
    for (const id of photoIds) {
      try {
        const resp = await firstValueFrom(this.svc.getPhotoUrl(id));
        entries[id] = resp.url;
      } catch {
        // URL load failure is non-fatal; photo overlay just won't render
      }
    }
    this.photoUrls.set(entries);
  }

  /** Polling fallback if WS doesn't fire within ~20s. */
  private _startPollingFallback(analysisId: string): void {
    const MAX_POLLS = 8;    // 8 × 5s = 40s max
    const INTERVAL_MS = 5000;
    let polls = 0;

    const timer = setInterval(() => {
      // If step changed (WS already fired), stop polling
      if (this.step() !== 'processing') {
        clearInterval(timer);
        return;
      }

      polls++;
      this.svc.getAnalysis(analysisId).subscribe({
        next: (detail) => {
          if (detail.status === 'done' || detail.status === 'error') {
            clearInterval(timer);
            if (detail.status === 'done') {
              this._fetchAnalysisAndAdvance(analysisId);
            } else {
              this.error.set(`Análise falhou: ${detail.error_code ?? 'Erro'}`);
              this.step.set('idle');
            }
          } else if (polls >= MAX_POLLS) {
            clearInterval(timer);
            this.error.set('Análise demorou mais que o esperado. Verifique o histórico.');
            this.step.set('idle');
          }
        },
        error: () => {
          if (polls >= MAX_POLLS) {
            clearInterval(timer);
            this.error.set('Erro ao verificar status da análise.');
            this.step.set('idle');
          }
        },
      });
    }, INTERVAL_MS);
  }
}
