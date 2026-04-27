import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { AgendaService } from './agenda.service';
import {
  ScheduleSettings,
  BusinessHours,
  DayKey,
  DAY_LABELS,
  DAY_ORDER,
  VALID_SLOT_MINUTES,
} from './agenda.models';

@Component({
  selector: 'app-agenda-settings-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule,
  ],
  styles: [`
    :host { display:flex; flex-direction:column; max-height:85vh; color:#dae2fd; width:100%; max-width:520px; }
    @media (max-width: 639px) {
      :host { max-width: none; max-height: 100vh; height: 100vh; }
      .body { padding: 0.5rem 1rem 1rem; }
      .header { padding: 0.875rem 1rem 0.5rem; }
      .footer { padding: 0.625rem 1rem; }
      /* Day-row 2 linhas: dia + checkbox no topo, time inputs lado-a-lado embaixo */
      .day-row {
        grid-template-columns: 1fr auto !important;
        grid-template-rows: auto auto;
        gap: 0.375rem 0.5rem;
        padding: 0.625rem 0;
      }
      .day-row .day-name { grid-column: 1; grid-row: 1; align-self: center; }
      .day-row > :nth-child(2),
      .day-row > :nth-child(3) {
        grid-row: 2;
      }
      .day-row > :nth-child(2) { grid-column: 1; }
      .day-row > :nth-child(3) { grid-column: 2; }
      .day-row > :last-child { grid-column: 2; grid-row: 1; justify-self: end; }
    }
    .header { padding:1rem 1.25rem 0.5rem; display:flex; justify-content:space-between; align-items:center; }
    h2 { font-family:'Space Grotesk',sans-serif; font-size:1rem; font-weight:700; margin:0; color:#c0c1ff; }
    .body { padding:0.5rem 1.25rem 1rem; display:flex; flex-direction:column; gap:0.875rem; flex:1; min-height:0; overflow-y:auto; }
    .row-label { font-family:'JetBrains Mono',monospace; font-size:10px; text-transform:uppercase; color:#908fa0; letter-spacing:0.08em; margin-bottom:4px; }
    .full { width:100%; }
    .day-row { display:grid; grid-template-columns: 100px 1fr 1fr auto; gap:0.5rem; align-items:center; padding:0.25rem 0; border-top:1px solid rgba(70,69,84,0.12); }
    .day-row:first-child { border-top:none; }
    .day-row.closed { opacity:0.5; }
    .day-name { font-family:'JetBrains Mono',monospace; font-size:11px; color:#dae2fd; text-transform:uppercase; }
    .time-input {
      background:#171f33; color:#dae2fd; border:1px solid rgba(70,69,84,0.3);
      border-radius:4px; padding:0.375rem 0.5rem; font-family:'JetBrains Mono',monospace; font-size:0.8125rem;
      width:100%; box-sizing:border-box;
    }
    .time-input:focus { outline:none; border-color:#c0c1ff; }
    .footer { display:flex; justify-content:flex-end; gap:0.5rem; padding:0.75rem 1.25rem; border-top:1px solid rgba(70,69,84,0.2); background:#0b1326; }
    .submit-btn {
      background:#c0c1ff; color:#1000a9; border:none; border-radius:6px;
      padding:0.5rem 1rem; font-size:0.75rem; font-weight:700;
      letter-spacing:0.06em; text-transform:uppercase; cursor:pointer;
    }
    .submit-btn:disabled { opacity:0.4; cursor:not-allowed; }
    .error { color:#ef4444; font-size:0.75rem; font-family:'JetBrains Mono',monospace; padding:0.5rem 0; }
    .info-banner {
      background:rgba(192,193,255,0.06); padding:0.625rem 0.75rem; border-radius:5px;
      font-size:0.75rem; line-height:1.45; color:#a09fb2; font-family:'JetBrains Mono',monospace;
    }
    .info-banner strong { color:#c0c1ff; }
  `],
  template: `
    <div class="header">
      <h2>Configurações da agenda</h2>
      <button mat-icon-button (click)="cancel()"><mat-icon>close</mat-icon></button>
    </div>
    <div class="body">
      <div>
        <div class="row-label">Duração padrão da consulta/atendimento</div>
        <mat-form-field appearance="outline" class="full">
          <mat-select [(ngModel)]="defaultSlotMinutes">
            @for (m of validSlots; track m) {
              <mat-option [value]="m">{{ m }} minutos</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <div class="info-banner">
          <strong>Importante:</strong> alterar a duração não afeta agendamentos já criados —
          eles permanecem com a duração original. Apenas novos agendamentos passam a usar a nova duração.
        </div>
      </div>

      <div>
        <div class="row-label">Horários de atendimento</div>
        @for (day of dayOrder; track day) {
          <div class="day-row" [class.closed]="!hasWindow(day)">
            <div class="day-name">{{ dayLabels[day] }}</div>
            <input type="time" class="time-input"
                   [(ngModel)]="startTimes[day]"
                   [disabled]="!hasWindow(day)"
                   placeholder="--:--"/>
            <input type="time" class="time-input"
                   [(ngModel)]="endTimes[day]"
                   [disabled]="!hasWindow(day)"
                   placeholder="--:--"/>
            <mat-checkbox [(ngModel)]="dayActive[day]" color="primary" matTooltip="Atende neste dia"></mat-checkbox>
          </div>
        }
      </div>

      @if (errorMsg()) { <div class="error">{{ errorMsg() }}</div> }
    </div>
    <div class="footer">
      <button mat-button (click)="cancel()" [disabled]="submitting()">Cancelar</button>
      <button class="submit-btn" [disabled]="submitting()" (click)="save()">
        {{ submitting() ? 'Salvando...' : 'Salvar' }}
      </button>
    </div>
  `,
})
export class AgendaSettingsDialogComponent {
  private ref = inject(MatDialogRef<AgendaSettingsDialogComponent, ScheduleSettings | null>);
  private agenda = inject(AgendaService);
  data: { settings: ScheduleSettings | null } = inject(MAT_DIALOG_DATA);

  readonly validSlots = VALID_SLOT_MINUTES;
  readonly dayOrder = DAY_ORDER;
  readonly dayLabels = DAY_LABELS;

  defaultSlotMinutes: number;
  startTimes: Record<DayKey, string> = { mon: '09:00', tue: '09:00', wed: '09:00', thu: '09:00', fri: '09:00', sat: '09:00', sun: '09:00' };
  endTimes: Record<DayKey, string> = { mon: '18:00', tue: '18:00', wed: '18:00', thu: '18:00', fri: '18:00', sat: '13:00', sun: '13:00' };
  dayActive: Record<DayKey, boolean> = { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false };

  errorMsg = signal('');
  submitting = signal(false);

  constructor() {
    const s = this.data.settings;
    this.defaultSlotMinutes = s?.default_slot_minutes ?? 30;
    if (s?.business_hours) {
      for (const day of this.dayOrder) {
        const windows = s.business_hours[day] || [];
        if (windows.length > 0) {
          // V1 simplificado: usa primeira janela do dia + última hora da última janela
          // (consolida múltiplas janelas em uma única no editor)
          this.startTimes[day] = windows[0][0];
          this.endTimes[day] = windows[windows.length - 1][1];
          this.dayActive[day] = true;
        } else {
          this.dayActive[day] = false;
        }
      }
    }
  }

  hasWindow(day: DayKey): boolean { return this.dayActive[day]; }

  cancel() { this.ref.close(null); }

  save() {
    this.errorMsg.set('');
    const business_hours: BusinessHours = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };
    for (const day of this.dayOrder) {
      if (!this.dayActive[day]) {
        business_hours[day] = [];
        continue;
      }
      const start = this.startTimes[day];
      const end = this.endTimes[day];
      if (!start || !end || start >= end) {
        this.errorMsg.set(`${this.dayLabels[day]}: horário inválido (início deve ser < fim)`);
        return;
      }
      business_hours[day] = [[start, end]];
    }

    this.submitting.set(true);
    this.agenda.saveSettings({
      default_slot_minutes: this.defaultSlotMinutes,
      business_hours,
    }).subscribe({
      next: (saved) => this.ref.close(saved),
      error: (err) => {
        this.submitting.set(false);
        this.errorMsg.set(err.error?.error || 'Erro ao salvar.');
      }
    });
  }
}
