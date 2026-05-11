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
  OnInit,
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
} from '../models/analysis.model';

import { ConsentModalComponent, ConsentModalData } from './consent-modal.component';
import { PhotoQualityGuideComponent } from './photo-quality-guide.component';
import { PhotoUploaderComponent } from './photo-uploader.component';
import { AnalysisResultComponent } from './analysis-result.component';
import { AnalysisListComponent } from './analysis-list.component';
import { ComparisonViewComponent } from './comparison-view.component';

// ---------------------------------------------------------------------------
// Step type
// ---------------------------------------------------------------------------

export type Step =
  | 'idle'
  | 'consent_check'
  | 'consent_ask'
  | 'guide'
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
    PhotoQualityGuideComponent,
    PhotoUploaderComponent,
    AnalysisResultComponent,
    AnalysisListComponent,
    ComparisonViewComponent,
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
export class FacialAnalysisTabComponent implements OnInit {
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

  // -------------------------------------------------------------------------
  // State signals
  // -------------------------------------------------------------------------

  /** Current step in the state machine. */
  readonly step = signal<Step>('idle');

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

  ngOnInit(): void {
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

  /** Step 1: User clicks "Nova análise" → check consent. */
  startNewAnalysis(): void {
    this.step.set('consent_check');
    this.svc.getConsent(this.subject().id).subscribe({
      next: (consent) => {
        // Consent exists and is not revoked → go to guide
        if (consent && !consent.revoked_at) {
          this.step.set('guide');
        } else {
          this._openConsentModal();
        }
      },
      error: (err: unknown) => {
        // 404 → no consent yet → open modal
        const status = (err as { status?: number })?.status;
        if (status === 404) {
          this._openConsentModal();
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
    // Trigger upload on next tick after uploader is rendered
    setTimeout(() => {
      if (this.uploaderRef) {
        this.uploaderRef.files.set(files);
        this.uploaderRef.startUpload();
      }
    });
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
      analysis_type: 'facial',
      subject_id: this.subject().id,
      photo_ids: photoIds,
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

  private _openConsentModal(): void {
    this.step.set('consent_ask');

    const data: ConsentModalData = {
      subject_id: this.subject().id,
    };

    const ref = this.dialog.open(ConsentModalComponent, {
      data,
      width: '480px',
    });

    ref.afterClosed().subscribe((confirmed: boolean | undefined) => {
      if (confirmed === true) {
        this.step.set('guide');
      } else {
        this.step.set('idle');
      }
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
