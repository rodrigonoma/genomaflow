import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AgendaService } from './agenda.service';
import {
  Appointment,
  AppointmentStatus,
  STATUS_LABELS,
  VALID_SLOT_MINUTES,
} from './agenda.models';

export interface EditAppointmentDialogData {
  appointment: Appointment;
  subject_name?: string;
}

export type EditAppointmentDialogResult =
  | { action: 'updated'; appointment: Appointment }
  | { action: 'cancelled'; id: string }
  | { action: 'deleted'; id: string }
  | null;

@Component({
  selector: 'app-edit-appointment-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
  ],
  styles: [`
    :host { display:flex; flex-direction:column; max-height:85vh; color:#dae2fd; width:100%; max-width:480px; }
    @media (max-width: 639px) {
      :host { max-width: none; max-height: 100vh; height: 100vh; }
      .body { padding: 0 1rem 1rem; }
      .header { padding: 0.875rem 1rem 0.5rem; }
      .meta { padding: 0 1rem 0.625rem; }
      .footer { padding: 0.625rem 1rem; flex-wrap: wrap; gap: 0.5rem; }
      /* Action buttons em grid 2 colunas pra encaixar bem */
      .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.375rem; }
      .actions .action-btn { padding: 0.5rem 0.625rem; }
    }
    .header { padding:1rem 1.25rem 0.5rem; display:flex; justify-content:space-between; align-items:center; }
    h2 { font-family:'Space Grotesk',sans-serif; font-size:1rem; font-weight:700; margin:0; color:#c0c1ff; }
    .meta { padding:0 1.25rem 0.75rem; font-family:'JetBrains Mono',monospace; font-size:11px; color:#908fa0; letter-spacing:0.05em; }
    .body { padding:0 1.25rem 1rem; display:flex; flex-direction:column; gap:0.875rem; flex:1; min-height:0; overflow-y:auto; }
    .row-label { font-family:'JetBrains Mono',monospace; font-size:10px; text-transform:uppercase; color:#908fa0; letter-spacing:0.08em; margin-bottom:4px; }
    .full { width:100%; }
    .actions { display:flex; flex-wrap:wrap; gap:0.375rem; padding:0.5rem 0; }
    .action-btn {
      background:#171f33; color:#c0c1ff; border:1px solid rgba(192,193,255,0.2);
      border-radius:5px; padding:0.375rem 0.75rem; font-size:0.7rem; font-family:'JetBrains Mono',monospace;
      cursor:pointer; text-transform:uppercase; letter-spacing:0.06em;
    }
    .action-btn:hover { background:#1d2640; border-color:#c0c1ff; }
    .action-btn.danger { color:#ef4444; border-color:rgba(239,68,68,0.3); }
    .action-btn.danger:hover { background:rgba(239,68,68,0.1); }
    .footer { display:flex; justify-content:space-between; padding:0.75rem 1.25rem; border-top:1px solid rgba(70,69,84,0.2); background:#0b1326; }
    .submit-btn {
      background:#c0c1ff; color:#1000a9; border:none; border-radius:6px;
      padding:0.5rem 1rem; font-size:0.75rem; font-weight:700;
      letter-spacing:0.06em; text-transform:uppercase; cursor:pointer;
    }
    .submit-btn:disabled { opacity:0.4; cursor:not-allowed; }
    .error { color:#ef4444; font-size:0.75rem; font-family:'JetBrains Mono',monospace; padding:0.5rem 0; }
  `],
  template: `
    <div class="header">
      <h2>{{ isBlocked() ? 'Editar bloqueio' : 'Editar agendamento' }}</h2>
      <button mat-icon-button (click)="cancel()"><mat-icon>close</mat-icon></button>
    </div>
    <div class="meta">
      {{ formatStart() }} · {{ data.appointment.duration_minutes }} min
      @if (data.subject_name) { · {{ data.subject_name }} }
    </div>
    <div class="body">
      <div>
        <div class="row-label">Status</div>
        <mat-form-field appearance="outline" class="full">
          <mat-select [(ngModel)]="status">
            @for (s of selectableStatuses(); track s) {
              <mat-option [value]="s">{{ statusLabel(s) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      <div>
        <div class="row-label">Duração</div>
        <mat-form-field appearance="outline" class="full">
          <mat-select [(ngModel)]="durationMinutes">
            @for (m of validSlots; track m) {
              <mat-option [value]="m">{{ m }} min</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      @if (isBlocked()) {
        <div>
          <div class="row-label">Motivo</div>
          <mat-form-field appearance="outline" class="full">
            <input matInput [(ngModel)]="reason"/>
          </mat-form-field>
        </div>
      }

      <div>
        <div class="row-label">Notas</div>
        <mat-form-field appearance="outline" class="full">
          <textarea matInput [(ngModel)]="notes" rows="2"></textarea>
        </mat-form-field>
      </div>

      <div class="actions">
        @if (data.appointment.status === 'scheduled') {
          <button class="action-btn" (click)="quickAction('confirmed')">Confirmar</button>
        }
        @if (data.appointment.status === 'confirmed' || data.appointment.status === 'scheduled') {
          <button class="action-btn" (click)="quickAction('completed')">Marcar como concluído</button>
          <button class="action-btn danger" (click)="quickAction('no_show')">Marcou falta</button>
        }
        @if (data.appointment.status !== 'cancelled' && data.appointment.status !== 'blocked') {
          <button class="action-btn danger" (click)="cancelAppointment()">Cancelar agendamento</button>
        }
        @if (isBlocked()) {
          <button class="action-btn danger" (click)="deleteBlock()">Excluir bloqueio</button>
        }
      </div>

      @if (errorMsg()) { <div class="error">{{ errorMsg() }}</div> }
    </div>
    <div class="footer">
      <button mat-button (click)="cancel()" [disabled]="submitting()">Fechar</button>
      <button class="submit-btn" [disabled]="submitting()" (click)="save()">
        {{ submitting() ? 'Salvando...' : 'Salvar alterações' }}
      </button>
    </div>
  `,
})
export class EditAppointmentDialogComponent {
  private ref = inject(MatDialogRef<EditAppointmentDialogComponent, EditAppointmentDialogResult>);
  private agenda = inject(AgendaService);
  data: EditAppointmentDialogData = inject(MAT_DIALOG_DATA);

  readonly validSlots = VALID_SLOT_MINUTES;
  readonly statusLabels = STATUS_LABELS;

  status: AppointmentStatus = this.data.appointment.status;
  durationMinutes = this.data.appointment.duration_minutes;
  reason = this.data.appointment.reason || '';
  notes = this.data.appointment.notes || '';
  errorMsg = signal('');
  submitting = signal(false);

  isBlocked(): boolean { return this.data.appointment.status === 'blocked'; }

  selectableStatuses(): AppointmentStatus[] {
    if (this.isBlocked()) return ['blocked'];
    return ['scheduled', 'confirmed', 'completed', 'no_show', 'cancelled'];
  }

  statusLabel(s: AppointmentStatus): string { return this.statusLabels[s]; }

  formatStart(): string {
    const d = new Date(this.data.appointment.start_at);
    return d.toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  cancel() { this.ref.close(null); }

  save() {
    this.submitting.set(true);
    this.errorMsg.set('');
    const body: any = {};
    if (this.durationMinutes !== this.data.appointment.duration_minutes) body.duration_minutes = this.durationMinutes;
    if (this.status !== this.data.appointment.status) body.status = this.status;
    if (this.notes !== (this.data.appointment.notes || '')) body.notes = this.notes.trim() || null;
    if (this.isBlocked() && this.reason !== (this.data.appointment.reason || '')) body.reason = this.reason.trim();

    if (Object.keys(body).length === 0) {
      this.ref.close(null);
      return;
    }

    this.agenda.update(this.data.appointment.id, body).subscribe({
      next: (appt) => this.ref.close({ action: 'updated', appointment: appt }),
      error: (err) => {
        this.submitting.set(false);
        const e = err.error || {};
        this.errorMsg.set(e.code === 'OVERLAP' ? 'Conflito com outro agendamento.' : (e.error || 'Erro ao salvar.'));
      }
    });
  }

  quickAction(newStatus: AppointmentStatus) {
    this.submitting.set(true);
    this.agenda.update(this.data.appointment.id, { status: newStatus }).subscribe({
      next: (appt) => this.ref.close({ action: 'updated', appointment: appt }),
      error: (err) => {
        this.submitting.set(false);
        this.errorMsg.set(err.error?.error || 'Erro ao atualizar status.');
      }
    });
  }

  cancelAppointment() {
    this.submitting.set(true);
    this.agenda.cancel(this.data.appointment.id).subscribe({
      next: () => this.ref.close({ action: 'cancelled', id: this.data.appointment.id }),
      error: (err) => {
        this.submitting.set(false);
        this.errorMsg.set(err.error?.error || 'Erro ao cancelar.');
      }
    });
  }

  deleteBlock() {
    this.submitting.set(true);
    this.agenda.delete(this.data.appointment.id).subscribe({
      next: () => this.ref.close({ action: 'deleted', id: this.data.appointment.id }),
      error: (err) => {
        this.submitting.set(false);
        this.errorMsg.set(err.error?.error || 'Erro ao excluir.');
      }
    });
  }
}
