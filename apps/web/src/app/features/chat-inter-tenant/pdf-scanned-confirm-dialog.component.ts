import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';

export interface PdfScannedConfirmDialogData {
  filename: string;
  page_count: number;
  reasoning: string;
}

export interface PdfScannedConfirmDialogResult {
  user_confirmed_scanned: true;
}

@Component({
  selector: 'app-pdf-scanned-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatCheckboxModule, FormsModule],
  styles: [`
    :host { display:flex; flex-direction:column; max-height:90vh; color:#dae2fd; max-width:560px; }
    .header { display:flex; align-items:center; justify-content:space-between; padding:1.25rem 1.5rem 0.5rem; flex-shrink:0; }
    .header h2 { font-family:'Space Grotesk',sans-serif; font-size:1.0625rem; font-weight:700; margin:0; color:#fbbf24; display:flex; align-items:center; gap:0.5rem; }
    .header mat-icon.warn { color:#fbbf24; }
    .body { padding:0.5rem 1.5rem 1rem; display:flex; flex-direction:column; gap:0.875rem; overflow-y:auto; flex:1; min-height:0; }
    .file-info {
      font-family:'JetBrains Mono',monospace; font-size:11px;
      color:#a09fb2;
      background:rgba(192,193,255,0.06); padding:0.5rem 0.75rem; border-radius:5px;
    }
    .file-info strong { color:#dae2fd; }
    .warn-box {
      background:rgba(251,191,36,0.08); border:1px solid rgba(251,191,36,0.3);
      border-radius:6px; padding:0.875rem 1rem;
      font-size:0.8125rem; line-height:1.5; color:#dae2fd;
    }
    .warn-box p { margin:0 0 0.625rem; }
    .warn-box p:last-child { margin-bottom:0; }
    .warn-box strong { color:#fbbf24; }
    .confirm-row { display:flex; align-items:flex-start; gap:0.5rem; padding:0.5rem 0; }
    .confirm-row ::ng-deep .mdc-form-field,
    .confirm-row ::ng-deep .mdc-form-field > label,
    .confirm-row ::ng-deep .mdc-label { color:#dae2fd !important; font-size:0.8125rem; line-height:1.4; }
    .footer {
      display:flex; justify-content:flex-end; align-items:center; gap:0.625rem;
      padding:0.875rem 1.5rem; border-top:1px solid rgba(70,69,84,0.2);
      flex-shrink:0; background:#0b1326;
    }
    .submit-btn {
      background:#fbbf24; color:#1c1500; border:none; border-radius:6px;
      padding:0.625rem 1.125rem; font-size:0.75rem; font-weight:700;
      letter-spacing:0.06em; text-transform:uppercase; cursor:pointer;
    }
    .submit-btn:disabled { opacity:0.4; cursor:not-allowed; }
  `],
  template: `
    <div class="header">
      <h2><mat-icon class="warn">warning_amber</mat-icon> PDF escaneado detectado</h2>
      <button mat-icon-button (click)="cancel()"><mat-icon>close</mat-icon></button>
    </div>
    <div class="body">
      <div class="file-info">
        Arquivo: <strong>{{ data.filename }}</strong> · <strong>{{ data.page_count }}</strong> página{{ data.page_count > 1 ? 's' : '' }}
      </div>

      <div class="warn-box">
        <p>
          Este PDF parece ser <strong>escaneado</strong> (imagem sem camada de texto).
          Por isso, <strong>não é possível redigir automaticamente</strong> dados pessoais.
        </p>
        <p>
          A LGPD (Lei Geral de Proteção de Dados) <strong>proíbe o compartilhamento</strong>
          de informações pessoais sensíveis sem o consentimento adequado e medidas técnicas
          de proteção. Antes de enviar, certifique-se de que:
        </p>
        <p style="padding-left:1rem">
          • O documento <strong>não contém</strong> nome, CPF, RG, endereço, telefone,
          microchip ou qualquer outro dado identificável; <strong>ou</strong><br>
          • Você tem <strong>consentimento expresso</strong> do titular dos dados para
          compartilhar com a clínica destinatária no contexto de cuidado em saúde.
        </p>
      </div>

      <div class="confirm-row">
        <mat-checkbox [(ngModel)]="confirmed" color="primary">
          Estou ciente da LGPD e assumo a <strong>responsabilidade exclusiva</strong> pelo
          envio deste PDF escaneado, garantindo que não há dados pessoais expostos ou que
          tenho o consentimento adequado dos titulares.
        </mat-checkbox>
      </div>
    </div>
    <div class="footer">
      <button mat-button (click)="cancel()">Cancelar</button>
      <button class="submit-btn" [disabled]="!confirmed" (click)="submit()">
        Enviar mesmo assim
      </button>
    </div>
  `,
})
export class PdfScannedConfirmDialogComponent {
  private ref = inject(MatDialogRef<PdfScannedConfirmDialogComponent, PdfScannedConfirmDialogResult | null>);
  data: PdfScannedConfirmDialogData = inject(MAT_DIALOG_DATA);

  confirmed = false;

  cancel(): void {
    this.ref.close(null);
  }

  submit(): void {
    if (!this.confirmed) return;
    this.ref.close({ user_confirmed_scanned: true });
  }
}
