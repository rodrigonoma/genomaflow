import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AestheticFacialService } from '../services/aesthetic-facial.service';

export interface ConsentModalData {
  subject_id: string;
  reinforced_regions?: string[];
}

@Component({
  selector: 'app-consent-modal',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  styles: [`
    :host { display: block; }
    .modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1.5rem 1.5rem 0;
    }
    h2 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 1.125rem; font-weight: 700; color: #dae2fd; margin: 0;
    }
    .modal-body { padding: 1.25rem 1.5rem; }
    .consent-text {
      font-family: 'Inter', sans-serif; font-size: 13px;
      color: #9b9aad; line-height: 1.6; margin-bottom: 1.25rem;
      background: rgba(192,193,255,0.04); border-radius: 6px;
      padding: 0.75rem 1rem; border-left: 3px solid #c0c1ff;
    }
    .regions-list {
      margin: 0.75rem 0; padding-left: 1.25rem;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #7c7b8f;
    }
    .regions-list li { margin-bottom: 0.25rem; }
    .checkbox-row { margin-bottom: 1rem; }
    .footer {
      display: flex; justify-content: flex-end; align-items: center;
      padding: 1rem 1.5rem; border-top: 1px solid rgba(70,69,84,0.15); gap: 0.75rem;
    }
  `],
  template: `
    <div class="modal-header">
      <h2>Confirmação de Consentimento</h2>
    </div>

    <div class="modal-body">
      <p class="consent-text">
        Confirmo que tenho autorização do paciente para coleta de foto facial e análise via IA,
        conforme consentimento obtido fora do sistema.
      </p>

      @if (data.reinforced_regions && data.reinforced_regions.length > 0) {
        <ul class="regions-list">
          @for (region of data.reinforced_regions; track region) {
            <li>{{ region }}</li>
          }
        </ul>
      }

      <div class="checkbox-row">
        <mat-checkbox [formControl]="lgpdControl">
          Estou ciente das premissas LGPD
        </mat-checkbox>
      </div>

      <mat-form-field appearance="outline" style="width:100%">
        <mat-label>Seu nome (digitando declaro estar conforme)</mat-label>
        <input matInput [formControl]="signerNameControl" autocomplete="name" />
      </mat-form-field>
    </div>

    <div class="footer">
      <button mat-button (click)="cancel()">Cancelar</button>
      <button mat-flat-button color="primary"
              [disabled]="!canConfirm()"
              (click)="confirm()">
        Confirmar
      </button>
    </div>
  `,
})
export class ConsentModalComponent {
  readonly data: ConsentModalData = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ConsentModalComponent>);
  private readonly service = inject(AestheticFacialService);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.group({
    lgpdAware: [false, Validators.requiredTrue],
    signerName: ['', [Validators.required, Validators.minLength(3)]],
  });

  get lgpdControl() { return this.form.controls.lgpdAware; }
  get signerNameControl() { return this.form.controls.signerName; }

  /** Returns true only when checkbox is checked AND signer name >= 3 chars. */
  canConfirm(): boolean {
    const v = this.form.value;
    return !!v.lgpdAware && !!v.signerName && v.signerName.trim().length >= 3;
  }

  confirm(): void {
    if (!this.canConfirm()) return;
    this.service
      .createConsent({
        subject_id: this.data.subject_id,
        notes: this.form.value.signerName ?? undefined,
        reinforced_regions: this.data.reinforced_regions,
      })
      .subscribe(() => {
        this.dialogRef.close(true);
      });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
