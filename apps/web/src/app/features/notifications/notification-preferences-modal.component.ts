import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { NotificationPreferencesService, NotificationPreferences } from './notification-preferences.service';

/**
 * Modal admin pra configurar preferências de notificação:
 * - Lembretes de consulta (hours_before, via)
 * - NPS pós-consulta
 * - Follow-up automatizado (4.2): pós-consulta, exam alert, próxima dose vacina
 * - Janela de envio (send_window)
 *
 * Backend: PUT /notifications/preferences (admin only). Defaults TRUE pra
 * todos follow-ups. Cliente pode desabilitar individualmente.
 */
@Component({
  selector: 'app-notification-preferences-modal',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatButtonModule, MatIconModule,
    MatSlideToggleModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>notifications</mat-icon>
      Configurar comunicações automáticas
    </h2>

    <mat-dialog-content>
      @if (loading()) {
        <p class="muted">Carregando…</p>
      } @else if (prefs(); as p) {
        <div class="section">
          <div class="section-title">Lembretes de consulta</div>
          <p class="muted">WhatsApp/email pré-consulta. Confirma 1, cancela 2.</p>
          <mat-slide-toggle [(ngModel)]="p.appointment_reminder_enabled">
            Habilitado
          </mat-slide-toggle>

          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>Horas antes (separadas por vírgula)</mat-label>
              <input matInput type="text"
                     [ngModel]="hoursBeforeStr(p.reminder_hours_before)"
                     (ngModelChange)="p.reminder_hours_before = parseHours($event)"
                     placeholder="24, 2"/>
              <mat-hint>Ex: "24, 2" envia T-24h e T-2h</mat-hint>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Canal</mat-label>
              <mat-select [(ngModel)]="p.reminder_via">
                <mat-option value="whatsapp">WhatsApp</mat-option>
                <mat-option value="email">Email</mat-option>
                <mat-option value="both">Ambos</mat-option>
              </mat-select>
            </mat-form-field>
          </div>

          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>Início janela (HH:MM)</mat-label>
              <input matInput [(ngModel)]="p.send_window_start" placeholder="08:00"/>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Fim janela (HH:MM)</mat-label>
              <input matInput [(ngModel)]="p.send_window_end" placeholder="20:00"/>
            </mat-form-field>
          </div>
        </div>

        <div class="divider"></div>

        <div class="section">
          <div class="section-title">Pesquisa NPS</div>
          <p class="muted">Email/WhatsApp pós-encontro. Tutor responde no portal.</p>
          <mat-slide-toggle [(ngModel)]="p.nps_enabled">Habilitado</mat-slide-toggle>
          @if (p.nps_enabled) {
            <div class="row">
              <mat-form-field appearance="outline">
                <mat-label>Canal</mat-label>
                <mat-select [(ngModel)]="p.nps_via">
                  <mat-option value="email">Email</mat-option>
                  <mat-option value="whatsapp">WhatsApp</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Atraso (horas após consulta)</mat-label>
                <input matInput type="number" min="1" max="72" [(ngModel)]="p.nps_delay_hours"/>
              </mat-form-field>
            </div>
          }
        </div>

        <div class="divider"></div>

        <div class="section">
          <div class="section-title">Follow-up pós-consulta <span class="badge-new">Novo</span></div>
          <p class="muted">"Como está se sentindo?" alguns dias após a consulta finalizada.</p>
          <mat-slide-toggle [(ngModel)]="p.post_consultation_followup_enabled">Habilitado</mat-slide-toggle>
          @if (p.post_consultation_followup_enabled) {
            <mat-form-field appearance="outline">
              <mat-label>Dias após consulta</mat-label>
              <input matInput type="number" min="1" max="30" [(ngModel)]="p.post_consultation_followup_days"/>
              <mat-hint>Default: 7 dias</mat-hint>
            </mat-form-field>
          }
        </div>

        <div class="section">
          <div class="section-title">Follow-up de exame com alerta <span class="badge-new">Novo</span></div>
          <p class="muted">Lembrete pra reavaliação após exame com alerta crítico.</p>
          <mat-slide-toggle [(ngModel)]="p.exam_alert_followup_enabled">Habilitado</mat-slide-toggle>
          @if (p.exam_alert_followup_enabled) {
            <mat-form-field appearance="outline">
              <mat-label>Dias após exame</mat-label>
              <input matInput type="number" min="7" max="180" [(ngModel)]="p.exam_alert_followup_days"/>
              <mat-hint>Default: 30 dias</mat-hint>
            </mat-form-field>
          }
        </div>

        <div class="section">
          <div class="section-title">Lembrete de próxima dose de vacina <span class="badge-new">Vet · Novo</span></div>
          <p class="muted">Avisa o tutor antes da data programada da próxima dose.</p>
          <mat-slide-toggle [(ngModel)]="p.vaccine_dose_reminder_enabled">Habilitado</mat-slide-toggle>
          @if (p.vaccine_dose_reminder_enabled) {
            <mat-form-field appearance="outline">
              <mat-label>Horas antes (separadas por vírgula)</mat-label>
              <input matInput type="text"
                     [ngModel]="hoursBeforeStr(p.vaccine_dose_reminder_hours_before)"
                     (ngModelChange)="p.vaccine_dose_reminder_hours_before = parseHours($event)"
                     placeholder="168, 24"/>
              <mat-hint>Default: 168h (T-7d) e 24h (T-1d)</mat-hint>
            </mat-form-field>
          }
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Cancelar</button>
      <button mat-flat-button color="primary" (click)="save()" [disabled]="saving() || !prefs()">
        <mat-icon>save</mat-icon>
        {{ saving() ? 'Salvando...' : 'Salvar' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; min-width: min(560px, 95vw); color: #dae2fd; }
    h2 { display: flex; align-items: center; gap: 8px; }
    h2 mat-icon { color: #c0c1ff; }
    mat-dialog-content { padding: 1.25rem 1.5rem 0.5rem !important; max-height: 75vh; }
    .muted { color: #a09fb2; font-size: 0.875rem; margin: 4px 0 12px; }
    .section { margin-bottom: 14px; padding: 12px 14px;
               background: rgba(192,193,255,0.04);
               border: 1px solid rgba(192,193,255,0.1);
               border-radius: 8px; }
    .section-title { font-size: 0.8125rem; font-weight: 600; color: #c0c1ff;
                     margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
    .row mat-form-field { flex: 1 1 200px; }
    mat-form-field { width: 100%; margin-top: 8px; }
    .divider { height: 1px; background: rgba(192,193,255,0.12); margin: 12px 0; }
    .badge-new { font-size: 0.625rem; padding: 1px 6px; border-radius: 100px;
                 background: rgba(74,214,160,0.15); color: #4ad6a0;
                 text-transform: uppercase; letter-spacing: 0.05em;
                 font-family: 'JetBrains Mono', monospace; font-weight: 700; }
  `],
})
export class NotificationPreferencesModalComponent implements OnInit {
  private service = inject(NotificationPreferencesService);
  private snack = inject(MatSnackBar);
  private dialogRef = inject(MatDialogRef<NotificationPreferencesModalComponent>);

  prefs = signal<NotificationPreferences | null>(null);
  loading = signal(true);
  saving = signal(false);

  ngOnInit() {
    this.service.get().subscribe({
      next: p => { this.prefs.set(p); this.loading.set(false); },
      error: () => { this.loading.set(false); this.snack.open('Erro ao carregar preferências', 'Fechar', { duration: 4000 }); },
    });
  }

  hoursBeforeStr(arr: number[] | undefined): string {
    return Array.isArray(arr) ? arr.join(', ') : '';
  }

  parseHours(input: string): number[] {
    return String(input).split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
  }

  save() {
    const p = this.prefs();
    if (!p) return;
    this.saving.set(true);
    // Não envia tenant_id nem is_default — backend define
    const { tenant_id, is_default, ...patch } = p as any;
    this.service.update(patch).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.snack.open('Preferências salvas.', 'OK', { duration: 2500 });
        this.dialogRef.close(updated);
      },
      error: (err) => {
        this.saving.set(false);
        const msg = err?.error?.error || 'Erro ao salvar preferências';
        this.snack.open(msg, 'Fechar', { duration: 4000 });
      },
    });
  }

  close() { this.dialogRef.close(); }
}
