import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ProfessionalService } from './professional.service';
import { AuthService } from '../../core/auth/auth.service';

const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

@Component({
  selector: 'app-professional-info',
  standalone: true,
  imports: [
    FormsModule, AsyncPipe,
    MatIconModule, MatCheckboxModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatSnackBarModule
  ],
  styles: [`
    :host { display: block; min-height: 100vh; background: #0b1326; padding: 3rem 1rem; }
    .wrap { max-width: 560px; margin: 0 auto; }

    .header {
      display: flex; align-items: center; gap: 0.875rem; margin-bottom: 2rem;
    }
    .logo { width: 56px; height: 56px; object-fit: contain; background: #fff; border-radius: 8px; padding: 4px; }
    .title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.5rem; color: #dae2fd; margin: 0; letter-spacing: -0.02em;
    }
    .subtitle {
      font-family: 'Inter', sans-serif; font-size: 13px; color: #a09fb2;
      margin: 0.25rem 0 0; line-height: 1.5; max-width: 55ch;
    }

    .card {
      background: #111929; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 10px; padding: 1.5rem;
    }

    .form-grid {
      display: grid; grid-template-columns: 1fr 120px; gap: 0.875rem;
      margin-bottom: 0.5rem;
    }
    mat-form-field { width: 100%; }

    .truthfulness-box {
      margin-top: 1.25rem; padding: 1rem 1.125rem;
      background: rgba(192,193,255,0.05);
      border: 1px solid rgba(192,193,255,0.18);
      border-radius: 8px;
    }
    .truth-text {
      font-family: 'Inter', sans-serif; font-size: 13px;
      color: #dae2fd; line-height: 1.55; margin-left: 0.375rem;
    }

    .actions { margin-top: 1.75rem; display: flex; justify-content: flex-end; }
    .submit-btn {
      background: #c0c1ff !important; color: #1000a9 !important;
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      letter-spacing: 0.03em;
    }
    .submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .footer-note {
      margin-top: 1.25rem; padding: 0.875rem 1rem;
      background: rgba(255,203,107,0.06);
      border: 1px solid rgba(255,203,107,0.2);
      border-radius: 6px;
      font-family: 'Inter', sans-serif; font-size: 12px;
      color: #d4b464; line-height: 1.5;
    }
    .footer-note strong { color: #f5c14a; }
    .footer-note mat-icon { font-size: 16px; width: 16px; height: 16px; vertical-align: middle; margin-right: 4px; color: #f5c14a; }
  `],
  template: `
    <div class="wrap">
      <div class="header">
        <img class="logo" src="logo_genoma.png" alt="GenomaFlow"/>
        <div>
          <h1 class="title">Dados profissionais</h1>
          @if ((auth.currentUser$ | async); as user) {
            <p class="subtitle">
              Para liberar o acesso à plataforma, informe seu número de registro profissional
              ({{ user.module === 'veterinary' ? 'CRMV' : 'CRM' }}) e confirme a veracidade das informações.
            </p>
          }
        </div>
      </div>

      @if ((auth.currentUser$ | async); as user) {
        <div class="card">
          <div class="form-grid">
            <mat-form-field appearance="outline">
              <mat-label>{{ user.module === 'veterinary' ? 'Número do CRMV' : 'Número do CRM' }} *</mat-label>
              <input matInput
                     [(ngModel)]="crmNumber"
                     (input)="onCrmInput($event)"
                     placeholder="Somente números"
                     inputmode="numeric"
                     maxlength="10"/>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>UF *</mat-label>
              <mat-select [(ngModel)]="crmUf">
                @for (uf of UFS; track uf) {
                  <mat-option [value]="uf">{{ uf }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>

          <div class="truthfulness-box">
            <mat-checkbox color="primary" [(ngModel)]="truthConfirmed">
              <span class="truth-text">
                Declaro, sob minha responsabilidade pessoal, que as informações
                prestadas são verdadeiras e correspondem a registro profissional
                ativo junto ao {{ user.module === 'veterinary' ? 'CRMV' : 'CRM' }}.
                Estou ciente de que a prestação de informação falsa constitui
                infração ética e pode acarretar responsabilização civil e penal.
              </span>
            </mat-checkbox>
          </div>

          <div class="actions">
            <button mat-flat-button class="submit-btn"
                    [disabled]="!canSubmit() || submitting()"
                    (click)="submit()">
              {{ submitting() ? 'Salvando...' : 'Confirmar e continuar' }}
            </button>
          </div>
        </div>

        <div class="footer-note">
          <mat-icon>info</mat-icon>
          <strong>Registro:</strong> a confirmação será gravada com data, hora, IP e
          identificação do navegador como evidência documental. Informações incorretas podem
          ser auditadas e corrigidas pelo perfil do usuário.
        </div>
      }
    </div>
  `
})
export class ProfessionalInfoComponent implements OnInit {
  private svc = inject(ProfessionalService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  auth = inject(AuthService);

  readonly UFS = UFS;

  crmNumber = '';
  crmUf = '';
  truthConfirmed = false;
  submitting = signal(false);

  canSubmit(): boolean {
    return /^\d{3,10}$/.test(this.crmNumber.trim()) &&
           UFS.includes(this.crmUf) &&
           this.truthConfirmed;
  }

  ngOnInit(): void {
    // Se já confirmou, não deveria estar aqui — manda pra app
    this.svc.getStatus().subscribe({
      next: s => { if (s.confirmed) this.router.navigateByUrl('/doctor/patients'); },
      error: () => {}
    });
  }

  onCrmInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    // Aceita apenas dígitos
    const digits = el.value.replace(/\D/g, '').slice(0, 10);
    this.crmNumber = digits;
    el.value = digits;
  }

  submit(): void {
    if (!this.canSubmit()) return;
    this.submitting.set(true);
    this.svc.submit({
      crm_number: this.crmNumber.trim(),
      crm_uf: this.crmUf,
      truthfulness_confirmed: true
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.snack.open('Dados profissionais confirmados.', '', { duration: 2500 });
        this.router.navigateByUrl('/doctor/patients');
      },
      error: err => {
        this.submitting.set(false);
        this.snack.open(err?.error?.error ?? 'Erro ao salvar.', '', { duration: 4000 });
      }
    });
  }
}
