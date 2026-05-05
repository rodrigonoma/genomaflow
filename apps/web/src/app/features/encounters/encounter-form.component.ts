import { Component, Input, Output, EventEmitter, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EncountersService, EncounterCreatePayload, ClinicalEncounter, VitalSigns } from './encounters.service';
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
    <form (submit)="onSubmit($event)">
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
  `,
  styles: [`
    form { display: flex; flex-direction: column; gap: 12px; }
    label { display: flex; flex-direction: column; gap: 3px; font-size: 0.75rem; color: #c7c5d0; }
    label.full { width: 100%; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; }
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
