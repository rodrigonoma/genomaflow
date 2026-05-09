import {
  Component, Input, Output, EventEmitter, OnChanges, OnDestroy,
  SimpleChanges, inject, signal
} from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TimelineEvent } from './patient-timeline.component';
import { environment } from '../../../../environments/environment';

interface ExamResult {
  agent_type: string;
  interpretation: string;
  risk_scores: Record<string, string>;
  alerts: Array<{ marker: string; value: string; severity: string }>;
  recommendations: any[];
  disclaimer: string;
  metadata?: any;
}

interface ExamDetail {
  id: string;
  status: string;
  file_type: string;
  results: ExamResult[] | null;
}

const SEVERITY_CLS: Record<string, string> = {
  critical: 'alert-critical',
  high:     'alert-high',
  medium:   'alert-medium',
  low:      'alert-low',
};

const AGENT_LABELS: Record<string, string> = {
  metabolic:            'Metabólico',
  cardiovascular:       'Cardiovascular',
  hematology:           'Hematologia',
  therapeutic:          'Terapêutica',
  nutrition:            'Nutrição',
  clinical_correlation: 'Correlação Clínica',
  small_animals:        'Pequenos Animais',
  equine:               'Equinos',
  bovine:               'Bovinos',
  imaging_rx:           'Radiografia',
  imaging_ecg:          'ECG',
  imaging_ultrasound:   'Ultrassom',
  imaging_mri:          'Ressonância Magnética',
};

@Component({
  selector: 'app-timeline-panel',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  styles: [`
    .backdrop {
      position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:200;
      opacity:0; transition:opacity 220ms ease; pointer-events:none;
    }
    .backdrop.open { opacity:1; pointer-events:auto; }

    .panel {
      position:fixed; top:0; right:0; bottom:0; width:420px; z-index:201;
      background:#111929; border-left:1px solid rgba(70,69,84,.25);
      display:flex; flex-direction:column; overflow:hidden;
      transform:translateX(100%); transition:transform 220ms ease;
    }
    .panel.open { transform:translateX(0); }

    @media (max-width:768px) {
      .panel {
        top:auto; left:0; right:0; bottom:0; width:100%; height:85vh;
        border-left:none; border-top:1px solid rgba(70,69,84,.25);
        border-radius:16px 16px 0 0; transform:translateY(100%);
      }
      .panel.open { transform:translateY(0); }
      .handle {
        width:40px; height:4px; background:rgba(70,69,84,.5);
        border-radius:2px; margin:.75rem auto .25rem; flex-shrink:0;
      }
    }
    @media (min-width:769px) { .handle { display:none; } }

    .panel-header {
      display:flex; align-items:center; gap:.5rem;
      padding:.875rem 1rem; border-bottom:1px solid rgba(70,69,84,.2);
      flex-shrink:0;
    }
    .panel-title { flex:1; font-size:.9rem; font-weight:600; color:#dae2fd; }
    .panel-date  { font-size:.7rem; color:#6e6d80; font-family:'JetBrains Mono',monospace; }
    .close-btn   { color:#6e6d80; cursor:pointer; background:none; border:none; padding:0; line-height:1; }
    .close-btn:hover { color:#dae2fd; }

    .panel-body { flex:1; overflow-y:auto; padding:1rem; }

    .field { margin-bottom:.875rem; }
    .field-label {
      font-size:.65rem; color:#6e6d80; font-family:'JetBrains Mono',monospace;
      text-transform:uppercase; letter-spacing:.08em; margin-bottom:.25rem;
    }
    .field-value { font-size:.82rem; color:#dae2fd; line-height:1.5; }

    .action-btn {
      width:100%; margin-top:1rem; padding:.625rem;
      background:#1a2440; border:1px solid rgba(192,193,255,.25);
      border-radius:6px; color:#c0c1ff; font-size:.8rem; cursor:pointer;
      display:flex; align-items:center; justify-content:center; gap:.5rem;
    }
    .action-btn:hover { background:#202e4a; }
    .action-btn:disabled { opacity:.5; cursor:default; }

    .badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:.7rem;
             font-family:'JetBrains Mono',monospace; }
    .badge-critical { background:#7f1d1d; color:#fca5a5; }
    .badge-high     { background:#78350f; color:#fde68a; }
    .badge-done     { background:#14532d; color:#86efac; }
    .badge-tele     { background:#164e63; color:#67e8f9; }

    /* Exam inline results */
    .spinner-wrap { display:flex; justify-content:center; padding:2rem 0; }

    .exam-image {
      width:100%; border-radius:8px; border:1px solid rgba(70,69,84,.2);
      margin-bottom:.875rem; display:block;
    }

    .agent-block {
      background:#0d1525; border:1px solid rgba(70,69,84,.2);
      border-radius:8px; padding:.75rem; margin-bottom:.875rem;
    }
    .agent-label {
      font-size:.7rem; font-weight:600; color:#c0c1ff;
      font-family:'JetBrains Mono',monospace; text-transform:uppercase;
      letter-spacing:.08em; margin-bottom:.625rem;
    }

    .alerts-row { display:flex; flex-wrap:wrap; gap:.375rem; margin-bottom:.625rem; }
    .alert-pill {
      display:inline-flex; align-items:center; gap:.25rem;
      padding:2px 8px; border-radius:4px; font-size:.68rem;
      font-family:'JetBrains Mono',monospace;
    }
    .alert-critical { background:#7f1d1d; color:#fca5a5; }
    .alert-high     { background:#78350f; color:#fde68a; }
    .alert-medium   { background:#1e3a5f; color:#93c5fd; }
    .alert-low      { background:#14532d; color:#86efac; }

    .risk-grid {
      display:grid; grid-template-columns:1fr auto;
      gap:.25rem .75rem; margin-bottom:.625rem;
    }
    .risk-name  { font-size:.7rem; color:#a09fb2; }
    .risk-value {
      font-size:.7rem; font-family:'JetBrains Mono',monospace;
      text-align:right; font-weight:600;
    }
    .risk-high     { color:#fca5a5; }
    .risk-moderate { color:#fde68a; }
    .risk-low      { color:#86efac; }
    .risk-minimal  { color:#a09fb2; }

    .interpretation {
      font-size:.75rem; color:#a09fb2; line-height:1.6;
      border-top:1px solid rgba(70,69,84,.2); padding-top:.5rem; margin-top:.5rem;
    }

    .no-results { text-align:center; color:#6e6d80; font-size:.8rem; padding:1.5rem 0; }

    /* PDF full-screen overlay */
    .pdf-overlay {
      position:fixed; inset:0; z-index:300;
      background:#0b1326; display:flex; flex-direction:column;
    }
    .pdf-overlay-bar {
      display:flex; align-items:center; gap:.75rem;
      padding:.625rem 1rem; border-bottom:1px solid rgba(70,69,84,.25);
      flex-shrink:0;
    }
    .pdf-overlay-bar span { flex:1; font-size:.85rem; color:#dae2fd; font-weight:600; }
    .pdf-overlay-bar button {
      background:none; border:none; color:#6e6d80; cursor:pointer; padding:0; line-height:1;
    }
    .pdf-overlay-bar button:hover { color:#dae2fd; }
    .pdf-frame { flex:1; width:100%; border:none; }
  `],
  template: `
    <!-- PDF full-screen overlay -->
    @if (showPdfOverlay()) {
      <div class="pdf-overlay">
        <div class="pdf-overlay-bar">
          <span>Laudo PDF</span>
          <button (click)="closePdfOverlay()"><mat-icon>close</mat-icon></button>
        </div>
        <iframe class="pdf-frame" [src]="safePdfUrl()" title="PDF do exame"></iframe>
      </div>
    }

    <div class="backdrop" [class.open]="visible" (click)="close.emit()"></div>

    <div class="panel" [class.open]="visible" (keydown.escape)="close.emit()" tabindex="-1">
      <div class="handle"></div>

      @if (event) {
        <div class="panel-header">
          <span class="panel-title">{{ panelTitle() }}</span>
          <span class="panel-date">{{ event.event_at | date:'dd/MM/yyyy HH:mm' }}</span>
          <button class="close-btn" (click)="close.emit()"><mat-icon>close</mat-icon></button>
        </div>

        <div class="panel-body">
          @switch (event.event_type) {

            @case ('registered') {
              <div class="field">
                <div class="field-label">Nome</div>
                <div class="field-value">{{ event.payload['name'] }}</div>
              </div>
              <div class="field">
                <div class="field-label">Tipo</div>
                <div class="field-value">{{ event.payload['subject_type'] === 'animal' ? 'Animal' : 'Humano' }}</div>
              </div>
            }

            @case ('exam') {
              <div class="field">
                <div class="field-label">Tipo</div>
                <div class="field-value">{{ event.payload['file_type'] ?? 'N/A' }}</div>
              </div>
              <div class="field">
                <div class="field-label">Status</div>
                <div class="field-value">{{ event.payload['status'] }}</div>
              </div>

              @if (examLoading()) {
                <div class="spinner-wrap"><mat-spinner diameter="28"></mat-spinner></div>
              } @else {
                <!-- Imagem anotada para exames de imagem -->
                @if (examImageUrl()) {
                  <img class="exam-image" [src]="examImageUrl()!" alt="Imagem do exame" />
                }

                <!-- Botão PDF -->
                @if (event.payload['file_type'] === 'pdf') {
                  <button class="action-btn" [disabled]="loadingPdf()" (click)="openPdf(event.payload['id'])">
                    <mat-icon style="font-size:16px;width:16px;height:16px;">picture_as_pdf</mat-icon>
                    {{ loadingPdf() ? 'Carregando PDF...' : 'Ver laudo original (PDF)' }}
                  </button>
                }

                <!-- Resultados IA -->
                @if (examDetail()?.results?.length) {
                  @for (r of examDetail()!.results!; track r.agent_type) {
                    <div class="agent-block">
                      <div class="agent-label">{{ agentLabel(r.agent_type) }}</div>

                      @if (r.alerts?.length) {
                        <div class="alerts-row">
                          @for (a of r.alerts; track a.marker) {
                            <span class="alert-pill" [class]="severityCls(a.severity)">
                              ⚠ {{ a.marker }}: {{ a.value }}
                            </span>
                          }
                        </div>
                      }

                      @if (r.risk_scores && objectKeys(r.risk_scores).length) {
                        <div class="risk-grid">
                          @for (k of objectKeys(r.risk_scores); track k) {
                            <span class="risk-name">{{ k }}</span>
                            <span class="risk-value" [class]="riskCls(r.risk_scores[k])">
                              {{ (+r.risk_scores[k] * 100 | number:'1.0-0') }}%
                            </span>
                          }
                        </div>
                      }

                      @if (r.interpretation) {
                        <div class="interpretation">
                          {{ r.interpretation | slice:0:400 }}{{ r.interpretation.length > 400 ? '…' : '' }}
                        </div>
                      }
                    </div>
                  }
                } @else {
                  <div class="no-results">
                    @if (event.payload['status'] === 'done') {
                      Sem análise IA disponível para este exame.
                    } @else {
                      Análise ainda em processamento.
                    }
                  </div>
                }
              }
            }

            @case ('ai_analysis') {
              <div class="field">
                <div class="field-label">Agente</div>
                <div class="field-value">{{ agentLabel(event.payload['agent_type']) }}</div>
              </div>

              @if (examLoading()) {
                <div class="spinner-wrap"><mat-spinner diameter="28"></mat-spinner></div>
              } @else if (aiResult()) {
                <div class="agent-block">
                  @if (aiResult()!.alerts?.length) {
                    <div class="alerts-row">
                      @for (a of aiResult()!.alerts; track a.marker) {
                        <span class="alert-pill" [class]="severityCls(a.severity)">
                          ⚠ {{ a.marker }}: {{ a.value }}
                        </span>
                      }
                    </div>
                  }
                  @if (aiResult()!.risk_scores && objectKeys(aiResult()!.risk_scores).length) {
                    <div class="risk-grid">
                      @for (k of objectKeys(aiResult()!.risk_scores); track k) {
                        <span class="risk-name">{{ k }}</span>
                        <span class="risk-value" [class]="riskCls(aiResult()!.risk_scores[k])">
                          {{ (+aiResult()!.risk_scores[k] * 100 | number:'1.0-0') }}%
                        </span>
                      }
                    </div>
                  }
                  @if (aiResult()!.interpretation) {
                    <div class="interpretation">
                      {{ aiResult()!.interpretation | slice:0:400 }}{{ aiResult()!.interpretation.length > 400 ? '…' : '' }}
                    </div>
                  }
                </div>
              }
            }

            @case ('appointment') {
              <div class="field">
                <div class="field-label">Tipo</div>
                <div class="field-value">{{ event.payload['appointment_type'] ?? 'N/A' }}</div>
              </div>
              <div class="field">
                <div class="field-label">Duração</div>
                <div class="field-value">{{ event.payload['duration_minutes'] }} min</div>
              </div>
              <div class="field">
                <div class="field-label">Status</div>
                <div class="field-value">{{ event.payload['status'] }}</div>
              </div>
              @if (event.payload['notes']) {
                <div class="field">
                  <div class="field-label">Notas</div>
                  <div class="field-value">{{ event.payload['notes'] }}</div>
                </div>
              }
            }

            @case ('video_consultation') {
              <div class="field">
                <div class="field-label">Modalidade</div>
                <div class="field-value">{{ event.payload['modality'] === 'complete' ? 'Completa (IA)' : 'Simples' }}</div>
              </div>
              <div class="field">
                <div class="field-label">Duração</div>
                <div class="field-value">
                  {{ event.payload['duration_seconds']
                    ? ((event.payload['duration_seconds'] / 60) | number:'1.0-0') + ' min'
                    : 'N/A' }}
                </div>
              </div>
              <div class="field">
                <div class="field-label">Créditos debitados</div>
                <div class="field-value">{{ event.payload['credits_debited'] ?? 0 }}</div>
              </div>
              <div class="field">
                <div class="field-label">Status</div>
                <div class="field-value">
                  <span class="badge badge-tele">{{ event.payload['status'] }}</span>
                </div>
              </div>
              @if (event.payload['encounter_id']) {
                <button class="action-btn" (click)="navigate('/clinic/encounters/' + event.payload['encounter_id'])">
                  <mat-icon style="font-size:16px;width:16px;height:16px;">description</mat-icon>
                  Abrir prontuário gerado pela IA
                </button>
              }
            }

            @case ('encounter') {
              @if (event.payload['chief_complaint']) {
                <div class="field">
                  <div class="field-label">Queixa principal</div>
                  <div class="field-value">{{ event.payload['chief_complaint'] }}</div>
                </div>
              }
              <div class="field">
                <div class="field-label">Origem</div>
                <div class="field-value">{{ event.payload['source'] === 'video_ai' ? 'IA de teleconsulta' : 'Manual' }}</div>
              </div>
              @if (event.payload['signed_at']) {
                <div class="field">
                  <div class="field-label">Assinado em</div>
                  <div class="field-value">{{ event.payload['signed_at'] | date:'dd/MM/yyyy HH:mm' }}</div>
                </div>
              }
              <button class="action-btn" (click)="navigate('/clinic/encounters/' + event.payload['id'])">
                <mat-icon style="font-size:16px;width:16px;height:16px;">open_in_new</mat-icon>
                Abrir prontuário completo
              </button>
            }

            @case ('prescription') {
              <div class="field">
                <div class="field-label">Itens prescritos</div>
                <div class="field-value">{{ event.payload['item_count'] }} item(s)</div>
              </div>
              @if (event.payload['agent_type']) {
                <div class="field">
                  <div class="field-label">Agente IA</div>
                  <div class="field-value">{{ agentLabel(event.payload['agent_type']) }}</div>
                </div>
              }
            }

            @case ('followup') {
              <div class="field">
                <div class="field-label">Tipo</div>
                <div class="field-value">{{ event.payload['notification_type'] }}</div>
              </div>
              <div class="field">
                <div class="field-label">Canal</div>
                <div class="field-value">{{ event.payload['channel'] }}</div>
              </div>
            }

          }
        </div>
      }
    </div>
  `
})
export class TimelinePanelComponent implements OnChanges, OnDestroy {
  @Input() event: TimelineEvent | null = null;
  @Input() visible = false;
  @Output() close = new EventEmitter<void>();

  private router    = inject(Router);
  private http      = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);

  examLoading   = signal(false);
  examDetail    = signal<ExamDetail | null>(null);
  aiResult      = signal<ExamResult | null>(null);
  examImageUrl  = signal<string | null>(null);
  loadingPdf    = signal(false);
  showPdfOverlay = signal(false);
  private _pdfBlobUrl: string | null = null;
  private _safePdfUrl: SafeResourceUrl | null = null;

  safePdfUrl() { return this._safePdfUrl; }

  ngOnChanges(changes: SimpleChanges) {
    if (!changes['event']) return;
    this._revokeBlobUrls();
    this.examDetail.set(null);
    this.aiResult.set(null);
    this.examImageUrl.set(null);
    this.showPdfOverlay.set(false);

    const ev = this.event;
    if (!ev) return;

    if (ev.event_type === 'exam' && ev.payload['id']) {
      this.fetchExam(ev.payload['id']);
    } else if (ev.event_type === 'ai_analysis' && ev.payload['exam_id']) {
      this.fetchAiResult(ev.payload['exam_id'], ev.payload['agent_type']);
    }
  }

  ngOnDestroy() { this._revokeBlobUrls(); }

  private _revokeBlobUrls() {
    if (this._pdfBlobUrl) { URL.revokeObjectURL(this._pdfBlobUrl); this._pdfBlobUrl = null; }
  }

  private fetchExam(examId: string) {
    this.examLoading.set(true);
    this.http.get<ExamDetail>(`${environment.apiUrl}/exams/${examId}`).subscribe({
      next: (d) => {
        this.examDetail.set(d);
        this.examLoading.set(false);
        const hasImaging = (d.results ?? []).some(r => r.agent_type.startsWith('imaging_'));
        if (hasImaging) this.fetchExamImage(examId);
      },
      error: () => this.examLoading.set(false),
    });
  }

  private fetchAiResult(examId: string, agentType: string) {
    this.examLoading.set(true);
    this.http.get<ExamDetail>(`${environment.apiUrl}/exams/${examId}`).subscribe({
      next: (d) => {
        const r = (d.results ?? []).find(x => x.agent_type === agentType) ?? null;
        this.aiResult.set(r);
        this.examLoading.set(false);
      },
      error: () => this.examLoading.set(false),
    });
  }

  private fetchExamImage(examId: string) {
    this.http.get(`${environment.apiUrl}/exams/${examId}/image`, { responseType: 'blob' }).subscribe({
      next: (blob) => this.examImageUrl.set(URL.createObjectURL(blob)),
      error: () => {},
    });
  }

  openPdf(examId: string) {
    this.loadingPdf.set(true);
    this.http.get(`${environment.apiUrl}/exams/${examId}/file`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        this._revokeBlobUrls();
        this._pdfBlobUrl = URL.createObjectURL(blob);
        this._safePdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this._pdfBlobUrl);
        this.showPdfOverlay.set(true);
        this.loadingPdf.set(false);
      },
      error: () => this.loadingPdf.set(false),
    });
  }

  closePdfOverlay() {
    this.showPdfOverlay.set(false);
    // Keep blob URL alive in case user reopens — revoked on next event change or destroy
  }

  panelTitle(): string {
    if (!this.event) return '';
    const map: Record<string, string> = {
      registered: 'Cadastro', exam: 'Exame', ai_analysis: 'Análise IA',
      appointment: 'Agendamento', video_consultation: 'Teleconsulta',
      encounter: 'Prontuário', prescription: 'Prescrição', followup: 'Follow-up',
    };
    return map[this.event.event_type] ?? this.event.event_type;
  }

  navigate(path: string) {
    this.close.emit();
    this.router.navigate([path]);
  }

  agentLabel(type: string)  { return AGENT_LABELS[type] ?? type; }
  severityCls(s: string)    { return SEVERITY_CLS[s] ?? 'alert-low'; }
  objectKeys(o: Record<string, string>) { return Object.keys(o ?? {}); }

  riskCls(val: string): string {
    const n = parseFloat(val);
    if (n >= 0.75) return 'risk-high';
    if (n >= 0.50) return 'risk-moderate';
    if (n >= 0.25) return 'risk-low';
    return 'risk-minimal';
  }
}
