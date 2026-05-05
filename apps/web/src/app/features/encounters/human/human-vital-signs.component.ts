import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VitalSigns } from '../encounters.service';

@Component({
  selector: 'app-human-vital-signs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="vital-signs human">
      <legend>Sinais vitais (humano)</legend>
      <div class="grid">
        <label>
          Peso (kg)
          <input type="number" step="0.01" min="0" max="2000"
                 [ngModel]="signs.weight_kg ?? null"
                 (ngModelChange)="update('weight_kg', $event)" />
        </label>
        <label>
          Temperatura (°C)
          <input type="number" step="0.1" min="25" max="45"
                 [ngModel]="signs.temperature_c ?? null"
                 (ngModelChange)="update('temperature_c', $event)" />
        </label>
        <label>
          FC (bpm)
          <input type="number" step="1" min="0" max="400"
                 [ngModel]="signs.heart_rate_bpm ?? null"
                 (ngModelChange)="update('heart_rate_bpm', $event)" />
        </label>
        <label>
          FR (rpm)
          <input type="number" step="1" min="0" max="200"
                 [ngModel]="signs.respiratory_rate_rpm ?? null"
                 (ngModelChange)="update('respiratory_rate_rpm', $event)" />
        </label>
        <label>
          PA Sistólica
          <input type="number" step="1" min="30" max="300"
                 [ngModel]="signs.blood_pressure_systolic ?? null"
                 (ngModelChange)="update('blood_pressure_systolic', $event)" />
        </label>
        <label>
          PA Diastólica
          <input type="number" step="1" min="20" max="200"
                 [ngModel]="signs.blood_pressure_diastolic ?? null"
                 (ngModelChange)="update('blood_pressure_diastolic', $event)" />
        </label>
        <label>
          Dor (0–10)
          <input type="number" step="1" min="0" max="10"
                 [ngModel]="signs.pain_score ?? null"
                 (ngModelChange)="update('pain_score', $event)" />
        </label>
      </div>
      <label class="notes">
        Observações
        <textarea rows="2"
                  [ngModel]="signs.notes ?? ''"
                  (ngModelChange)="update('notes', $event || null)"></textarea>
      </label>
    </fieldset>
  `,
  styles: [`
    .vital-signs { border: 1px solid #2a3148; border-radius: 6px; padding: 12px 16px; margin-top: 12px; }
    legend { color: #c0c1ff; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; padding: 0 6px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
    label { display: flex; flex-direction: column; gap: 3px; font-size: 0.75rem; color: #c7c5d0; }
    input, select, textarea { padding: 6px 8px; background: #060d20; border: 1px solid #2a3148;
      color: #dbe2fd; border-radius: 4px; font-family: inherit; font-size: 0.875rem; }
    .notes { grid-column: 1 / -1; margin-top: 8px; }
  `]
})
export class HumanVitalSignsComponent {
  @Input() signs: VitalSigns = {};
  @Output() signsChange = new EventEmitter<VitalSigns>();

  update<K extends keyof VitalSigns>(key: K, value: VitalSigns[K]) {
    const next = { ...this.signs, [key]: value };
    this.signs = next;
    this.signsChange.emit(next);
  }
}
