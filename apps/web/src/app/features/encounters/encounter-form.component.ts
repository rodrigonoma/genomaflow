import { Component, Input, Output, EventEmitter, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EncountersService, EncounterCreatePayload, ClinicalEncounter, VitalSigns, CopilotResponse } from './encounters.service';
import { VetVitalSignsComponent } from './vet/vet-vital-signs.component';
import { HumanVitalSignsComponent } from './human/human-vital-signs.component';

/**
 * Shell shared do formulário de evolução. Renderiza:
 * - Campos universais (queixa, anamnese, exame físico, hipótese, conduta, retorno)
 * - Sub-componente módulo-específico de sinais vitais
 * - Campos humano-only (antecedentes, medicamentos em uso, alergias) só se module='human'
 *
 * Sem `if (module) { ... } else { ... }` aninhado — separação por @if explícito.
 */
@Component({
  selector: 'app-encounter-form',
  standalone: true,
  imports: [CommonModule, FormsModule, VetVitalSignsComponent, HumanVitalSignsComponent],
  template: `
    <div class="layout">
    <form (submit)="onSubmit($event)" class="form-col">
      <div class="row">
        <label>
          Tipo
          <select [(ngModel)]="encounterType" name="encounter_type">
            <option value="consulta">Consulta</option>
            <option value="retorno">Retorno</option>
            <option value="evolucao">Evolução</option>
            <option value="procedimento">Procedimento</option>
            <option value="telemedicina">Telemedicina</option>
            <option value="outro">Outro</option>
          </select>
        </label>
        <button type="button" class="copilot-toggle" [class.active]="copilotOpen()" (click)="toggleCopilot()">
          <span class="dot"></span>
          {{ copilotOpen() ? 'Co-piloto IA' : 'Ativar co-piloto IA' }}
        </button>
      </div>

      <label class="full">
        Queixa principal
        <textarea rows="2" [(ngModel)]="chiefComplaint" name="chief_complaint"></textarea>
      </label>

      <label class="full">
        {{ module === 'human' ? 'História da doença atual' : 'Anamnese' }}
        <textarea rows="3" [(ngModel)]="anamnesis" name="anamnesis"></textarea>
      </label>

      @if (module === 'human') {
        <label class="full">
          Antecedentes
          <textarea rows="2" [(ngModel)]="medicalHistory" name="medical_history"></textarea>
        </label>
        <label class="full">
          Medicamentos em uso
          <textarea rows="2" [(ngModel)]="medicationsInUse" name="medications_in_use"></textarea>
        </label>
        <label class="full">
          Alergias
          <input type="text" [(ngModel)]="allergies" name="allergies" />
        </label>
      }

      <label class="full">
        Exame físico
        <textarea rows="3" [(ngModel)]="physicalExam" name="physical_exam"></textarea>
      </label>

      @if (module === 'veterinary') {
        <app-vet-vital-signs [signs]="vitalSigns" (signsChange)="vitalSigns = $event"></app-vet-vital-signs>
      } @else {
        <app-human-vital-signs [signs]="vitalSigns" (signsChange)="vitalSigns = $event"></app-human-vital-signs>
      }

      <label class="full">
        Hipótese / suspeita diagnóstica
        <textarea rows="2" [(ngModel)]="hypothesis" name="hypothesis"></textarea>
      </label>

      <label class="full">
        Conduta
        <textarea rows="3" [(ngModel)]="conduct" name="conduct"></textarea>
      </label>

      <label class="full">
        Recomendação de retorno
        <input type="text" [(ngModel)]="returnRec" name="return_recommendation" placeholder="Ex: 7 dias" />
      </label>

      @if (errorMsg()) {
        <p class="error">{{ errorMsg() }}</p>
      }

      <div class="actions">
        <button type="button" (click)="cancel.emit()" [disabled]="saving()">Cancelar</button>
        <button type="submit" [disabled]="saving()">{{ saving() ? 'Salvando…' : 'Salvar evolução' }}</button>
      </div>
    </form>

    @if (copilotOpen()) {
      <aside class="copilot">
        <div class="copilot-head">
          <div class="copilot-title">
            <span class="ai-icon">✨</span>
            <span>Co-piloto IA</span>
          </div>
          <button type="button" class="copilot-close" (click)="copilotOpen.set(false)" aria-label="Fechar">×</button>
        </div>

        <button type="button" class="copilot-run" (click)="runCopilot()" [disabled]="copilotLoading()">
          {{ copilotLoading() ? 'Analisando...' : (copilotResult() ? 'Reanalisar' : 'Analisar prontuário atual') }}
        </button>

        @if (copilotError()) {
          <p class="copilot-error">{{ copilotError() }}</p>
        }

        @if (copilotResult(); as r) {
          @if (r.hypotheses.length > 0) {
            <section class="cp-section">
              <div class="cp-section-title">Hipóteses prováveis</div>
              @for (h of r.hypotheses; track h.name) {
                <div class="cp-card">
                  <div class="cp-row">
                    <strong>{{ h.name }}</strong>
                    @if (h.icd10) { <span class="cp-chip cid">{{ h.icd10 }}</span> }
                    <span class="cp-prob">{{ (h.prob_score * 100) | number:'1.0-0' }}%</span>
                  </div>
                  <div class="cp-rationale">{{ h.rationale }}</div>
                </div>
              }
            </section>
          }

          @if (r.recommended_exams.length > 0) {
            <section class="cp-section">
              <div class="cp-section-title">Exames sugeridos</div>
              @for (e of r.recommended_exams; track e.name) {
                <div class="cp-card">
                  <div class="cp-row">
                    <strong>{{ e.name }}</strong>
                    <span class="cp-chip" [class]="'p-' + e.priority">{{ priorityLabel(e.priority) }}</span>
                    <span class="cp-chip type">{{ examTypeLabel(e.type) }}</span>
                  </div>
                  <div class="cp-rationale">{{ e.indication }}</div>
                </div>
              }
            </section>
          }

          @if (r.red_flags.length > 0) {
            <section class="cp-section red-flag-section">
              <div class="cp-section-title">⚠ Sinais de alarme</div>
              @for (f of r.red_flags; track f.signal) {
                <div class="cp-card red-flag">
                  <div class="cp-row">
                    <strong>{{ f.signal }}</strong>
                    <span class="cp-chip urgency-{{ f.urgency }}">{{ urgencyLabel(f.urgency) }}</span>
                  </div>
                  <div class="cp-rationale">{{ f.recommendation }}</div>
                </div>
              }
            </section>
          }

          @if (r.needs_more_info.length > 0) {
            <section class="cp-section">
              <div class="cp-section-title">Falta investigar</div>
              <ul class="cp-list">
                @for (q of r.needs_more_info; track q) {
                  <li>{{ q }}</li>
                }
              </ul>
            </section>
          }

          @if (r.hypotheses.length === 0 && r.recommended_exams.length === 0 && r.red_flags.length === 0) {
            <p class="cp-empty">Sem sugestões com os dados atuais.</p>
          }

          <p class="cp-disclaimer">⚕ Sugestões da IA. Médico decide.</p>
        }
      </aside>
    }
    </div>
  `,
  styles: [`
    .layout { display: flex; gap: 16px; align-items: flex-start; }
    .form-col { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
    label { display: flex; flex-direction: column; gap: 3px; font-size: 0.75rem; color: #c7c5d0; }
    label.full { width: 100%; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    input, select, textarea { padding: 8px; background: #060d20; border: 1px solid #2a3148;
      color: #dbe2fd; border-radius: 4px; font-family: inherit; font-size: 0.875rem; }
    .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px; }
    .actions button { padding: 8px 16px; cursor: pointer; border-radius: 4px; border: none;
      font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 0.75rem;
      letter-spacing: 0.1em; text-transform: uppercase; }
    .actions button[type="submit"] { background: #c0c1ff; color: #4b4d83; }
    .actions button[type="button"] { background: #2a3148; color: #c7c5d0; }
    .actions button[disabled] { opacity: 0.5; cursor: not-allowed; }
    .error { color: #ffb4ab; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; }

    /* Co-pilot toggle button */
    .copilot-toggle {
      margin-left: auto;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; background: rgba(192,193,255,0.08);
      border: 1px solid rgba(192,193,255,0.2);
      color: #c0c1ff; border-radius: 100px; cursor: pointer;
      font-size: 0.75rem; font-weight: 600;
      transition: background 0.15s;
    }
    .copilot-toggle:hover { background: rgba(192,193,255,0.16); }
    .copilot-toggle.active { background: rgba(192,193,255,0.2); border-color: #c0c1ff; }
    .copilot-toggle .dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #c0c1ff;
      box-shadow: 0 0 8px rgba(192,193,255,0.6);
    }

    /* Co-pilot sidebar */
    .copilot {
      width: 320px; flex-shrink: 0;
      background: linear-gradient(180deg, rgba(192,193,255,0.08), rgba(74,214,160,0.04));
      border: 1px solid rgba(192,193,255,0.18);
      border-radius: 10px; padding: 14px;
      align-self: stretch;
      max-height: 80vh; overflow-y: auto;
      display: flex; flex-direction: column; gap: 10px;
    }
    .copilot-head { display: flex; align-items: center; justify-content: space-between; }
    .copilot-title { display: flex; align-items: center; gap: 6px;
                     color: #dae2fd; font-weight: 600; font-size: 0.875rem; }
    .ai-icon { color: #c0c1ff; }
    .copilot-close {
      background: transparent; border: none; color: #7c7b8f; cursor: pointer;
      font-size: 1.25rem; padding: 0 4px;
    }
    .copilot-close:hover { color: #fff; }

    .copilot-run {
      padding: 10px 14px; background: #c0c1ff; color: #1a1d3a;
      border: none; border-radius: 6px; font-weight: 600; font-size: 0.8125rem;
      cursor: pointer; transition: background 0.15s;
    }
    .copilot-run:hover:not(:disabled) { background: #d8d9ff; }
    .copilot-run:disabled { opacity: 0.5; cursor: not-allowed; }
    .copilot-error { color: #ff8b8b; font-size: 0.75rem; margin: 0; }

    .cp-section { display: flex; flex-direction: column; gap: 6px; }
    .cp-section-title { font-size: 0.6875rem; text-transform: uppercase;
                        letter-spacing: 0.08em; color: #a09fb2; font-weight: 600;
                        font-family: 'JetBrains Mono', monospace; }
    .red-flag-section .cp-section-title { color: #ff8b8b; }

    .cp-card {
      background: rgba(11,19,38,0.6);
      border: 1px solid rgba(192,193,255,0.1);
      border-radius: 6px; padding: 8px 10px;
    }
    .cp-card.red-flag { border-color: rgba(255,107,107,0.3); background: rgba(255,107,107,0.05); }
    .cp-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
    .cp-row strong { color: #fff; font-size: 0.8125rem; flex: 1; min-width: 0; }
    .cp-rationale { color: #c7c5d0; font-size: 0.75rem; line-height: 1.4; }
    .cp-prob { color: #c0c1ff; font-size: 0.6875rem; font-weight: 600;
               font-family: 'JetBrains Mono', monospace; }

    .cp-chip {
      font-size: 0.625rem; padding: 1px 6px; border-radius: 100px;
      background: rgba(255,255,255,0.06); color: #c7c5d0;
      font-family: 'JetBrains Mono', monospace; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .cp-chip.cid { background: rgba(192,193,255,0.15); color: #c0c1ff; }
    .cp-chip.type { background: rgba(74,214,160,0.1); color: #4ad6a0; }
    .cp-chip.p-high { background: rgba(255,107,107,0.18); color: #ff8b8b; }
    .cp-chip.p-medium { background: rgba(247,200,115,0.15); color: #f7c873; }
    .cp-chip.p-low { background: rgba(74,214,160,0.15); color: #4ad6a0; }
    .cp-chip.urgency-imediata { background: rgba(255,107,107,0.25); color: #ff8b8b; }
    .cp-chip.urgency-hoje { background: rgba(247,200,115,0.2); color: #f7c873; }
    .cp-chip.urgency-esta_semana { background: rgba(192,193,255,0.15); color: #c0c1ff; }

    .cp-list { padding-left: 18px; margin: 0; color: #c7c5d0; font-size: 0.75rem; }
    .cp-list li { margin: 2px 0; }
    .cp-empty { color: #7c7b8f; font-size: 0.8125rem; font-style: italic; }
    .cp-disclaimer { color: #7c7b8f; font-size: 0.6875rem; text-align: center;
                     padding-top: 8px; border-top: 1px solid rgba(192,193,255,0.08);
                     margin: 4px 0 0; }

    /* Responsive: empilha em viewport menor */
    @media (max-width: 920px) {
      .layout { flex-direction: column; }
      .copilot { width: auto; max-width: 100%; }
    }
  `]
})
export class EncounterFormComponent {
  @Input({ required: true }) subjectId!: string;
  @Input({ required: true }) module!: 'human' | 'veterinary';
  @Input() appointmentId: string | null = null;

  @Output() saved = new EventEmitter<ClinicalEncounter>();
  @Output() cancel = new EventEmitter<void>();

  private encountersService = inject(EncountersService);

  encounterType: ClinicalEncounter['encounter_type'] = 'consulta';
  chiefComplaint = '';
  anamnesis = '';
  physicalExam = '';
  hypothesis = '';
  conduct = '';
  returnRec = '';
  medicalHistory = '';
  medicationsInUse = '';
  allergies = '';
  vitalSigns: VitalSigns = {};

  saving = signal(false);
  errorMsg = signal('');

  // ── Co-piloto IA (4.4) ─────────────────────────────────────────────
  copilotOpen = signal(false);
  copilotLoading = signal(false);
  copilotError = signal('');
  copilotResult = signal<CopilotResponse | null>(null);

  toggleCopilot() {
    this.copilotOpen.update(v => !v);
  }

  runCopilot() {
    this.copilotError.set('');
    this.copilotLoading.set(true);
    this.encountersService.copilot({
      subject_id: this.subjectId,
      chief_complaint: this.chiefComplaint || null,
      anamnesis: this.anamnesis || null,
      physical_exam: this.physicalExam || null,
      hypothesis: this.hypothesis || null,
      vital_signs: Object.keys(this.vitalSigns).length > 0 ? this.vitalSigns : null,
    }).subscribe({
      next: (r) => {
        this.copilotResult.set(r);
        this.copilotLoading.set(false);
      },
      error: (err) => {
        this.copilotLoading.set(false);
        this.copilotError.set(err?.error?.error || 'Erro ao analisar. Tente novamente.');
      },
    });
  }

  priorityLabel(p: string): string {
    return ({ high: 'Alta', medium: 'Média', low: 'Baixa' } as any)[p] || p;
  }
  examTypeLabel(t: string): string {
    return ({ lab: 'Lab', imaging: 'Imagem', other: 'Outro' } as any)[t] || t;
  }
  urgencyLabel(u: string): string {
    return ({ imediata: 'Imediata', hoje: 'Hoje', esta_semana: 'Esta semana' } as any)[u] || u;
  }

  onSubmit(ev: Event) {
    ev.preventDefault();
    this.errorMsg.set('');
    this.saving.set(true);

    const payload: EncounterCreatePayload = {
      subject_id: this.subjectId,
      appointment_id: this.appointmentId,
      encounter_type: this.encounterType,
      chief_complaint: this.chiefComplaint || null,
      anamnesis: this.anamnesis || null,
      physical_exam: this.physicalExam || null,
      hypothesis: this.hypothesis || null,
      conduct: this.conduct || null,
      return_recommendation: this.returnRec || null,
    };

    if (this.module === 'human') {
      payload.medical_history = this.medicalHistory || null;
      payload.medications_in_use = this.medicationsInUse || null;
      payload.allergies = this.allergies || null;
    }

    // Só envia vital_signs se algum campo preenchido
    const vsHasContent = Object.entries(this.vitalSigns).some(([_, v]) => v !== null && v !== undefined && v !== '');
    if (vsHasContent) payload.vital_signs = this.vitalSigns;

    this.encountersService.create(payload).subscribe({
      next: (enc) => {
        this.saving.set(false);
        this.saved.emit(enc);
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMsg.set(err?.error?.error ?? 'Erro ao salvar evolução');
      },
    });
  }
}
