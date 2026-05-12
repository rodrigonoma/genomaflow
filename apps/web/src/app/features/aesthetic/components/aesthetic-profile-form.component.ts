import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AestheticProfileService,
  AestheticProfile,
  ComputedNutrition,
  ACTIVITY_LEVELS,
  GOAL_OPTIONS,
  DIETARY_OPTIONS,
} from '../services/aesthetic-profile.service';

@Component({
  selector: 'app-aesthetic-profile-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  styles: [`
    :host {
      display: block;
      font-family: 'Space Grotesk', sans-serif;
      color: #dae2fd;
    }

    .profile-layout {
      display: grid;
      grid-template-columns: 1fr 340px;
      gap: 1.5rem;
      align-items: start;
    }

    @media (max-width: 900px) {
      .profile-layout { grid-template-columns: 1fr; }
    }

    /* ── Section ── */
    .section {
      background: #0b1326;
      border: 1px solid rgba(192,193,255,0.1);
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .section:last-child { margin-bottom: 0; }
    .section-title {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #a09fb2;
      margin: 0 0 1rem;
    }

    /* ── Form grid ── */
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.875rem; }
    .form-full { grid-column: 1 / -1; }

    @media (max-width: 640px) {
      .form-grid { grid-template-columns: 1fr; }
    }

    .field label {
      display: block;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #6e6d80;
      margin-bottom: 0.375rem;
    }
    .field input,
    .field select,
    .field textarea {
      width: 100%;
      background: #060d1a;
      color: #dae2fd;
      border: 1px solid rgba(192,193,255,0.12);
      border-radius: 5px;
      padding: 0.625rem 0.75rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      outline: none;
      box-sizing: border-box;
      transition: border-color 150ms;
    }
    .field input:focus,
    .field select:focus,
    .field textarea:focus {
      border-color: rgba(192,193,255,0.4);
    }
    .field textarea { resize: vertical; min-height: 72px; }
    .field-hint {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: #6e6d80;
      margin-top: 0.25rem;
    }

    /* ── Checkbox group ── */
    .checkbox-group {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
    }
    @media (max-width: 640px) {
      .checkbox-group { grid-template-columns: 1fr; }
    }
    .check-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 13px;
      color: #dae2fd;
      cursor: pointer;
      user-select: none;
    }
    .check-row input[type="checkbox"] {
      width: auto;
      accent-color: #c0c1ff;
      cursor: pointer;
    }

    /* ── Buttons ── */
    .btn {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      padding: 8px 18px;
      border-radius: 4px;
      cursor: pointer;
      border: none;
      transition: all 150ms;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .btn-primary { background: #c0c1ff; color: #1000a9; font-weight: 700; }
    .btn-primary:hover:not(:disabled) { background: #d4d5ff; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ── Alerts ── */
    .error-bar {
      background: rgba(255,180,171,0.1);
      border: 1px solid rgba(255,180,171,0.2);
      color: #ffb4ab;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      padding: 0.75rem;
      border-radius: 5px;
      margin-bottom: 1rem;
    }
    .success-bar {
      background: rgba(16,185,129,0.1);
      border: 1px solid rgba(16,185,129,0.2);
      color: #10b981;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      padding: 0.75rem;
      border-radius: 5px;
      margin-bottom: 1rem;
    }
    .loading-state {
      text-align: center;
      padding: 2rem;
      color: #6e6d80;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }

    /* ── Computed panel ── */
    .computed-panel {
      background: #0b1326;
      border: 1px solid rgba(192,193,255,0.1);
      border-radius: 8px;
      padding: 1.25rem;
      position: sticky;
      top: 1rem;
    }
    .computed-title {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #a09fb2;
      margin: 0 0 1rem;
    }
    .computed-empty {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #6e6d80;
      text-align: center;
      padding: 1rem 0;
    }
    .computed-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 0;
      border-bottom: 1px solid rgba(192,193,255,0.05);
    }
    .computed-row:last-child { border-bottom: none; }
    .computed-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6e6d80;
    }
    .computed-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      font-weight: 700;
      color: #c0c1ff;
    }
    .computed-value.green { color: #10b981; }
    .macros-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }
    .macro-card {
      background: rgba(192,193,255,0.05);
      border-radius: 6px;
      padding: 0.625rem;
      text-align: center;
    }
    .macro-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #6e6d80;
      display: block;
      margin-bottom: 0.25rem;
    }
    .macro-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 700;
      color: #dae2fd;
    }
    .macro-unit {
      font-size: 9px;
      color: #6e6d80;
    }

    /* ── Disclaimer ── */
    .disclaimer {
      background: rgba(192,193,255,0.04);
      border: 1px solid rgba(192,193,255,0.08);
      border-radius: 6px;
      padding: 0.75rem;
      margin-top: 1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: #6e6d80;
      line-height: 1.5;
    }

    .form-footer {
      display: flex;
      justify-content: flex-end;
      padding-top: 0.5rem;
    }
  `],
  template: `
    @if (loading()) {
      <div class="loading-state" data-testid="loading-state">Carregando perfil...</div>
    } @else {
      @if (errorMsg()) {
        <div class="error-bar" data-testid="error-bar">{{ errorMsg() }}</div>
      }
      @if (successMsg()) {
        <div class="success-bar" data-testid="success-bar">{{ successMsg() }}</div>
      }

      <div class="profile-layout">
        <!-- Left: form sections -->
        <div>
          <!-- Section 1: Antropometria -->
          <div class="section">
            <p class="section-title">Antropometria</p>
            <div class="form-grid">
              <div class="field">
                <label>Altura (cm)</label>
                <input
                  type="number"
                  [ngModel]="formProfile().height_cm"
                  (ngModelChange)="patchProfile({ height_cm: $event ? +$event : undefined })"
                  min="140" max="220"
                  placeholder="Ex: 165"
                  data-testid="input-height"
                />
              </div>
              <div class="field">
                <label>Peso (kg)</label>
                <input
                  type="number"
                  [ngModel]="formProfile().weight_kg"
                  (ngModelChange)="patchProfile({ weight_kg: $event ? +$event : undefined })"
                  min="35" max="200"
                  step="0.1"
                  placeholder="Ex: 68.5"
                  data-testid="input-weight"
                />
              </div>
              <div class="field">
                <label>Idade</label>
                <input
                  type="number"
                  [ngModel]="formProfile().age"
                  (ngModelChange)="patchProfile({ age: $event ? +$event : undefined })"
                  min="12" max="100"
                  placeholder="Ex: 32"
                  data-testid="input-age"
                />
              </div>
              <div class="field">
                <label>Sexo</label>
                <select
                  [ngModel]="formProfile().sex"
                  (ngModelChange)="patchProfile({ sex: $event || undefined })"
                  data-testid="select-sex"
                >
                  <option value="">Não informado</option>
                  <option value="F">Feminino</option>
                  <option value="M">Masculino</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Section 2: Nível de atividade -->
          <div class="section">
            <p class="section-title">Nível de Atividade</p>
            <div class="field">
              <label>Frequência semanal de exercício</label>
              <select
                [ngModel]="formProfile().activity_level"
                (ngModelChange)="patchProfile({ activity_level: $event || undefined })"
                data-testid="select-activity"
              >
                <option value="">Não informado</option>
                @for (opt of activityLevels; track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
            </div>
          </div>

          <!-- Section 3: Objetivos -->
          <div class="section">
            <p class="section-title">Objetivos (máx. 5)</p>
            <div class="checkbox-group">
              @for (opt of goalOptions; track opt.value) {
                <label class="check-row">
                  <input
                    type="checkbox"
                    [checked]="isGoalSelected(opt.value)"
                    (change)="toggleGoal(opt.value)"
                    [attr.data-testid]="'goal-' + opt.value"
                  />
                  {{ opt.label }}
                </label>
              }
            </div>
          </div>

          <!-- Section 4: Restrições alimentares -->
          <div class="section">
            <p class="section-title">Restrições Alimentares</p>
            <div class="checkbox-group">
              @for (opt of dietaryOptions; track opt.value) {
                <label class="check-row">
                  <input
                    type="checkbox"
                    [checked]="isDietarySelected(opt.value)"
                    (change)="toggleDietary(opt.value)"
                    [attr.data-testid]="'dietary-' + opt.value"
                  />
                  {{ opt.label }}
                </label>
              }
            </div>
          </div>

          <!-- Section 5: Alergias -->
          <div class="section">
            <p class="section-title">Alergias</p>
            <div class="field">
              <label>Uma por linha</label>
              <textarea
                [ngModel]="allergiesToText()"
                (ngModelChange)="patchProfile({ allergies: textToLines($event) })"
                rows="3"
                placeholder="Ex: amendoim&#10;leite&#10;frutos do mar"
                data-testid="textarea-allergies"
              ></textarea>
              <div class="field-hint">Máx. 20 itens — uma alergia por linha</div>
            </div>
          </div>

          <!-- Section 6: Condições médicas -->
          <div class="section">
            <p class="section-title">Condições Médicas</p>
            <div class="field">
              <label>Uma por linha</label>
              <textarea
                [ngModel]="conditionsToText()"
                (ngModelChange)="patchProfile({ medical_conditions: textToLines($event) })"
                rows="3"
                placeholder="Ex: diabetes tipo 2&#10;hipertensão"
                data-testid="textarea-conditions"
              ></textarea>
              <div class="field-hint">Máx. 20 itens — uma condição por linha</div>
            </div>
          </div>

          <div class="form-footer">
            <button
              class="btn btn-primary"
              (click)="saveProfile()"
              [disabled]="saving()"
              data-testid="btn-save"
            >
              {{ saving() ? 'Salvando...' : 'Salvar perfil' }}
            </button>
          </div>
        </div>

        <!-- Right: computed nutrition panel -->
        <div class="computed-panel" data-testid="computed-panel">
          <p class="computed-title">Estimativa Nutricional</p>

          @if (computed()) {
            <div data-testid="computed-content">
              <div class="computed-row">
                <span class="computed-label">TMB</span>
                <span class="computed-value">{{ computed()!.tmb }} <span style="font-size:10px;color:#6e6d80">kcal/dia</span></span>
              </div>
              <div class="computed-row">
                <span class="computed-label">Calorias (meta)</span>
                <span class="computed-value green">{{ computed()!.calories }} <span style="font-size:10px;color:#6e6d80">kcal/dia</span></span>
              </div>

              <p class="computed-title" style="margin-top:1rem; margin-bottom:0.5rem">Macros diários</p>
              <div class="macros-grid">
                <div class="macro-card">
                  <span class="macro-label">Proteína</span>
                  <span class="macro-value">{{ computed()!.macros.protein_g }}<span class="macro-unit">g</span></span>
                </div>
                <div class="macro-card">
                  <span class="macro-label">Carboidratos</span>
                  <span class="macro-value">{{ computed()!.macros.carbs_g }}<span class="macro-unit">g</span></span>
                </div>
                <div class="macro-card">
                  <span class="macro-label">Gordura</span>
                  <span class="macro-value">{{ computed()!.macros.fat_g }}<span class="macro-unit">g</span></span>
                </div>
              </div>
            </div>
          } @else {
            <div class="computed-empty" data-testid="computed-empty">
              Preencha altura, peso, idade, sexo e nível de atividade para ver a estimativa.
            </div>
          }

          <div class="disclaimer" data-testid="disclaimer">
            ⚕ Cálculos baseados em Mifflin-St Jeor. Estas orientações de estilo de vida não substituem consulta com nutricionista (CRN).
          </div>
        </div>
      </div>
    }
  `,
})
export class AestheticProfileFormComponent implements OnInit {
  private svc = inject(AestheticProfileService);

  // Required input — subject ID from patient-detail
  subjectId = input.required<string>();

  // Expose constants to template
  readonly activityLevels = ACTIVITY_LEVELS;
  readonly goalOptions = GOAL_OPTIONS;
  readonly dietaryOptions = DIETARY_OPTIONS;

  // Signal state
  loading = signal(false);
  saving = signal(false);
  errorMsg = signal<string | null>(null);
  successMsg = signal<string | null>(null);
  formProfile = signal<AestheticProfile>({});
  computed = signal<ComputedNutrition | null>(null);

  ngOnInit(): void {
    this.loadProfile();
  }

  loadProfile(): void {
    this.loading.set(true);
    this.errorMsg.set(null);
    this.svc.get(this.subjectId()).subscribe({
      next: (res) => {
        this.formProfile.set(res.profile ?? {});
        this.computed.set(res.computed);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err.error?.error ?? 'Erro ao carregar perfil estético.');
        this.loading.set(false);
      },
    });
  }

  saveProfile(): void {
    this.saving.set(true);
    this.errorMsg.set(null);
    this.successMsg.set(null);
    this.svc.update(this.subjectId(), this.formProfile()).subscribe({
      next: (res) => {
        this.formProfile.set(res.profile ?? {});
        this.computed.set(res.computed);
        this.saving.set(false);
        this.successMsg.set('Perfil salvo com sucesso.');
        setTimeout(() => this.successMsg.set(null), 4000);
      },
      error: (err) => {
        this.errorMsg.set(err.error?.error ?? 'Erro ao salvar perfil estético.');
        this.saving.set(false);
      },
    });
  }

  // Patch a subset of the profile immutably
  patchProfile(patch: Partial<AestheticProfile>): void {
    this.formProfile.update((prev) => ({ ...prev, ...patch }));
  }

  // Goal checkbox toggle
  toggleGoal(value: string): void {
    this.formProfile.update((prev) => {
      const current = prev.goals ?? [];
      const exists = current.includes(value);
      if (exists) {
        return { ...prev, goals: current.filter((g) => g !== value) };
      }
      if (current.length >= 5) return prev; // max 5
      return { ...prev, goals: [...current, value] };
    });
  }

  isGoalSelected(value: string): boolean {
    return (this.formProfile().goals ?? []).includes(value);
  }

  // Dietary restriction checkbox toggle
  toggleDietary(value: string): void {
    this.formProfile.update((prev) => {
      const current = prev.dietary_restrictions ?? [];
      const exists = current.includes(value);
      if (exists) {
        return { ...prev, dietary_restrictions: current.filter((d) => d !== value) };
      }
      return { ...prev, dietary_restrictions: [...current, value] };
    });
  }

  isDietarySelected(value: string): boolean {
    return (this.formProfile().dietary_restrictions ?? []).includes(value);
  }

  // Textarea <-> string[] helpers
  allergiesToText(): string {
    return (this.formProfile().allergies ?? []).join('\n');
  }

  conditionsToText(): string {
    return (this.formProfile().medical_conditions ?? []).join('\n');
  }

  textToLines(text: string): string[] {
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 20);
  }
}
