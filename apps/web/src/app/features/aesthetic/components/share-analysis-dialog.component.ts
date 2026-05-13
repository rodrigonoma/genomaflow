/**
 * ShareAnalysisDialogComponent (V2 Fase 4)
 *
 * Modal pra esteticista compartilhar relatório do paciente:
 *  - Checkboxes: email + whatsapp (pelo menos 1 obrigatório)
 *  - Input email + phone (validados conforme canal selecionado)
 *  - Textarea opcional "mensagem personalizada" (até 500 chars)
 *  - Botão "Enviar" → POST /aesthetic/analyses/:id/share
 *  - Loading + result inline (sucesso/erro por canal)
 */
import { Component, Inject, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  MAT_DIALOG_DATA, MatDialogRef, MatDialogModule,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import {
  AestheticFacialService,
  ShareAnalysisResponse,
  ShareAnalysisPayload,
} from '../services/aesthetic-facial.service';

export interface ShareDialogData {
  analysisId: string;
  defaultPatientName?: string;
  defaultEmail?: string;
  defaultPhone?: string;
}

@Component({
  selector: 'app-share-analysis-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatCheckboxModule, MatIconModule,
    MatProgressSpinnerModule,
  ],
  styles: [`
    :host { display: block; }
    .share-wrap {
      padding: 0.5rem 0;
      min-width: 420px;
      max-width: 100%;
    }
    h2 { margin: 0 0 0.5rem; font-size: 1.1rem; color: #5a4490; }
    .subtitle {
      font-size: 13px; color: #6a6a76; margin: 0 0 1rem;
    }
    .channels {
      display: flex; gap: 1rem; margin: 0.5rem 0 0.8rem;
    }
    .field { margin: 0.5rem 0; width: 100%; }
    textarea { font-family: 'Inter', sans-serif; resize: vertical; min-height: 60px; }
    .results { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.4rem; }
    .result-line {
      display: flex; align-items: center; gap: 0.5rem;
      font-size: 13px; padding: 0.5rem 0.75rem;
      border-radius: 6px;
    }
    .result-line.ok { background: #ecfdf5; color: #065f46; }
    .result-line.fail { background: #fef2f2; color: #991b1b; }
    .error-banner {
      background: #fef2f2; color: #991b1b;
      padding: 0.5rem 0.75rem; border-radius: 6px;
      font-size: 13px; margin-bottom: 0.5rem;
    }
  `],
  template: `
    <div class="share-wrap" data-testid="share-analysis-dialog">
      <h2 mat-dialog-title>📤 Compartilhar com paciente</h2>
      <p class="subtitle">
        @if (data.defaultPatientName) {
          {{ data.defaultPatientName }} receberá um relatório acessível
          em PDF, com linguagem simples.
        } @else {
          O paciente receberá um relatório acessível em PDF.
        }
      </p>

      <mat-dialog-content>
        <div class="channels">
          <mat-checkbox [(ngModel)]="useEmail" data-testid="check-email">
            📧 Email
          </mat-checkbox>
          <mat-checkbox [(ngModel)]="useWhatsapp" data-testid="check-whatsapp">
            💬 WhatsApp
          </mat-checkbox>
        </div>

        @if (useEmail) {
          <mat-form-field appearance="outline" class="field">
            <mat-label>Email do paciente</mat-label>
            <input matInput type="email"
                   data-testid="input-email"
                   [(ngModel)]="email"
                   placeholder="paciente@email.com" />
          </mat-form-field>
        }

        @if (useWhatsapp) {
          <mat-form-field appearance="outline" class="field">
            <mat-label>WhatsApp do paciente</mat-label>
            <input matInput type="tel"
                   data-testid="input-phone"
                   [(ngModel)]="phone"
                   placeholder="+55 11 99999-9999" />
            <mat-hint>Formato com DDD; código país opcional</mat-hint>
          </mat-form-field>
        }

        <mat-form-field appearance="outline" class="field">
          <mat-label>Mensagem personalizada (opcional)</mat-label>
          <textarea matInput rows="3"
                    data-testid="input-message"
                    [(ngModel)]="customMessage"
                    maxlength="500"
                    placeholder="Ex: Olá! Aqui está sua análise. Aguardo seu retorno na próxima semana."></textarea>
          <mat-hint align="end">{{ customMessage.length }}/500</mat-hint>
        </mat-form-field>

        @if (error()) {
          <div class="error-banner" data-testid="share-error">⚠ {{ error() }}</div>
        }

        @if (result()) {
          <div class="results" data-testid="share-results">
            @if (result()!.email) {
              <div class="result-line" [class.ok]="result()!.email!.sent" [class.fail]="!result()!.email!.sent">
                <mat-icon>{{ result()!.email!.sent ? 'check_circle' : 'error' }}</mat-icon>
                <span>
                  Email: {{ result()!.email!.sent ? 'Enviado com sucesso' : 'Falha' }}
                  @if (result()!.email!.error) { — {{ result()!.email!.error }} }
                </span>
              </div>
            }
            @if (result()!.whatsapp) {
              <div class="result-line" [class.ok]="result()!.whatsapp!.sent" [class.fail]="!result()!.whatsapp!.sent">
                <mat-icon>{{ result()!.whatsapp!.sent ? 'check_circle' : 'error' }}</mat-icon>
                <span>
                  WhatsApp: {{ result()!.whatsapp!.sent ? 'Enviado com sucesso' : 'Falha' }}
                  @if (result()!.whatsapp!.error) { — {{ result()!.whatsapp!.error }} }
                </span>
              </div>
            }
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="dialogRef.close()" data-testid="btn-cancel">
          @if (result()) { Fechar } @else { Cancelar }
        </button>
        @if (!result()) {
          <button mat-flat-button color="primary"
                  data-testid="btn-send"
                  [disabled]="loading() || !canSubmit()"
                  (click)="onSubmit()">
            @if (loading()) {
              <mat-spinner diameter="18" style="display:inline-block;vertical-align:middle"></mat-spinner>
              Enviando...
            } @else {
              Enviar
            }
          </button>
        }
      </mat-dialog-actions>
    </div>
  `,
})
export class ShareAnalysisDialogComponent {
  private readonly svc = inject(AestheticFacialService);

  useEmail = true;
  useWhatsapp = false;
  email = '';
  phone = '';
  customMessage = '';

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<ShareAnalysisResponse | null>(null);

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ShareDialogData,
    public dialogRef: MatDialogRef<ShareAnalysisDialogComponent>,
  ) {
    this.email = data.defaultEmail || '';
    this.phone = data.defaultPhone || '';
  }

  canSubmit(): boolean {
    if (!this.useEmail && !this.useWhatsapp) return false;
    if (this.useEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) return false;
    if (this.useWhatsapp && this.phone.replace(/\D/g, '').length < 10) return false;
    return true;
  }

  onSubmit(): void {
    if (!this.canSubmit()) return;
    const channels: Array<'email' | 'whatsapp'> = [];
    if (this.useEmail) channels.push('email');
    if (this.useWhatsapp) channels.push('whatsapp');

    const payload: ShareAnalysisPayload = {
      channels,
      recipient_email: this.useEmail ? this.email.trim() : undefined,
      recipient_phone: this.useWhatsapp ? this.phone.trim() : undefined,
      custom_message: this.customMessage.trim() || undefined,
    };

    this.loading.set(true);
    this.error.set(null);
    this.svc.shareAnalysis(this.data.analysisId, payload).subscribe({
      next: (resp) => {
        this.loading.set(false);
        this.result.set(resp);
      },
      error: (err: { error?: { error?: string; message?: string }; message?: string; status?: number }) => {
        this.loading.set(false);
        const code = err.error?.error || 'UNKNOWN';
        const msg = err.error?.message || err.message;
        this.error.set(`${code}: ${msg || 'Falha ao enviar'}`);
        // Para 207 (multi-status) o backend retorna result no body — exibir
        if (err.status === 207 && err.error && (err.error as unknown as ShareAnalysisResponse).share_ids) {
          this.result.set(err.error as unknown as ShareAnalysisResponse);
          this.error.set(null);
        }
      },
    });
  }
}
