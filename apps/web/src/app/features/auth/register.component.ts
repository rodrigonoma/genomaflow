import { Component, inject } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { environment } from '../../../environments/environment';

function passwordStrength(control: AbstractControl): ValidationErrors | null {
  const v: string = control.value ?? '';
  return v.length >= 8 ? null : { minlength: true };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatSelectModule],
  styles: [`
    :host {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: #0b1326;
      background-image: radial-gradient(ellipse at 60% 20%, rgba(73,75,214,0.08) 0%, transparent 60%),
                        radial-gradient(ellipse at 20% 80%, rgba(192,193,255,0.04) 0%, transparent 50%);
      padding: 2rem 1rem;
    }
    .card {
      width: 440px; background: #111929;
      border: 1px solid rgba(70,69,84,0.25);
      border-radius: 8px; padding: 2.5rem;
      box-shadow: 0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(192,193,255,0.04);
    }
    .brand-row {
      display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.25rem;
    }
    .brand-logo { width: 44px; height: 44px; object-fit: contain; }
    .brand {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 1.5rem;
      color: #c0c1ff; letter-spacing: -0.02em;
    }
    .brand-sub {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.15em; color: #6e6d80;
      margin-bottom: 2rem;
    }
    .divider { height: 1px; background: rgba(70,69,84,0.2); margin-bottom: 1.75rem; }
    h2 {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 600; font-size: 1rem;
      color: #a09fb2; margin: 0 0 1.5rem;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .field { margin-bottom: 1rem; width: 100%; }
    .module-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .module-btn {
      padding: 0.875rem 1rem;
      background: #0f1928;
      border: 1px solid rgba(70,69,84,0.25);
      border-radius: 6px; cursor: pointer;
      text-align: left; transition: all 150ms ease;
      display: flex; flex-direction: column; gap: 0.25rem;
    }
    .module-btn:hover { border-color: rgba(192,193,255,0.3); background: #131b2e; }
    .module-btn.selected { border-color: #c0c1ff; background: rgba(192,193,255,0.07); }
    .module-label {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 13px; color: #dae2fd;
    }
    .module-desc {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; color: #6e6d80; text-transform: uppercase; letter-spacing: 0.06em;
    }
    .error-msg {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; color: #ffb4ab;
      background: rgba(147,0,10,0.12);
      border: 1px solid rgba(255,180,171,0.2);
      border-radius: 4px; padding: 0.625rem 0.75rem;
      margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;
    }
    .success-msg {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; color: #10b981;
      background: rgba(16,185,129,0.08);
      border: 1px solid rgba(16,185,129,0.2);
      border-radius: 4px; padding: 0.75rem;
      margin-bottom: 1rem; line-height: 1.6;
    }
    .submit-btn {
      width: 100%; height: 44px;
      background: #c0c1ff; color: #1000a9;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 0.8125rem;
      text-transform: uppercase; letter-spacing: 0.08em;
      border: none; border-radius: 6px; cursor: pointer;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .submit-btn:hover:not(:disabled) {
      background: #d4d5ff;
      box-shadow: 0 4px 16px rgba(192,193,255,0.25);
    }
    .submit-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .footer-note {
      margin-top: 1.5rem; text-align: center;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; color: #6e6d80; letter-spacing: 0.05em;
    }
    .footer-note a { color: #c0c1ff; text-decoration: none; }
    .footer-note a:hover { text-decoration: underline; }
  `],
  template: `
    <div class="card">
      <div class="brand-row">
        <img class="brand-logo" src="logo_genoma.png" alt="GenomaFlow"/>
        <div class="brand">GenomaFlow</div>
      </div>
      <div class="brand-sub">Clinical AI Platform &middot; v1.0</div>
      <div class="divider"></div>
      <h2>Criar conta</h2>

      @if (success) {
        <div class="success-msg">
          ✅ Conta criada com sucesso!<br/>
          Redirecionando para o login...
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field class="field" appearance="outline">
            <mat-label>Nome da clínica / consultório</mat-label>
            <input matInput formControlName="clinic_name" autocomplete="organization"/>
          </mat-form-field>

          <mat-form-field class="field" appearance="outline">
            <mat-label>E-mail</mat-label>
            <input matInput type="email" formControlName="email" autocomplete="email"/>
          </mat-form-field>

          <mat-form-field class="field" appearance="outline">
            <mat-label>Senha (mín. 8 caracteres)</mat-label>
            <input matInput [type]="showPass ? 'text' : 'password'" formControlName="password" autocomplete="new-password"/>
            <button mat-icon-button matSuffix type="button" (click)="showPass = !showPass">
              <mat-icon>{{ showPass ? 'visibility_off' : 'visibility' }}</mat-icon>
            </button>
          </mat-form-field>

          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#6e6d80;margin-bottom:0.625rem">
            Módulo
          </div>
          <div class="module-grid">
            <button type="button" class="module-btn" [class.selected]="selectedModule === 'human'" (click)="selectedModule = 'human'">
              <span class="module-label">Humano</span>
              <span class="module-desc">Médico / Clínica</span>
            </button>
            <button type="button" class="module-btn" [class.selected]="selectedModule === 'veterinary'" (click)="selectedModule = 'veterinary'">
              <span class="module-label">Veterinário</span>
              <span class="module-desc">Pet / Equino / Bovino</span>
            </button>
          </div>

          @if (error) {
            <div class="error-msg">{{ error }}</div>
          }

          <button class="submit-btn" type="submit" [disabled]="form.invalid || !selectedModule || loading">
            {{ loading ? 'CRIANDO CONTA...' : 'CRIAR CONTA' }}
          </button>
        </form>
      }

      <div class="footer-note">
        Já tem conta? <a routerLink="/login">Entrar</a>
      </div>
    </div>
  `
})
export class RegisterComponent {
  private fb     = inject(FormBuilder);
  private http   = inject(HttpClient);
  private router = inject(Router);

  form = this.fb.group({
    clinic_name: ['', Validators.required],
    email:       ['', [Validators.required, Validators.email]],
    password:    ['', [Validators.required, passwordStrength]],
  });

  selectedModule: 'human' | 'veterinary' | null = null;
  showPass = false;
  loading  = false;
  error    = '';
  success  = false;

  submit(): void {
    if (this.form.invalid || !this.selectedModule) return;
    this.error = '';
    this.loading = true;

    const { clinic_name, email, password } = this.form.value;
    this.http.post(`${environment.apiUrl}/auth/register`, {
      clinic_name, email, password, module: this.selectedModule
    }).subscribe({
      next: () => {
        this.success = true;
        setTimeout(() => this.router.navigate(['/login']), 1800);
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.error ?? 'Erro ao criar conta. Tente novamente.';
      }
    });
  }
}
