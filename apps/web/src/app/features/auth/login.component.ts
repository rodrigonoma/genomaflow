import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../core/auth/auth.service';
import { environment } from '../../../environments/environment';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  styles: [`
    :host {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: #0b1326;
      background-image: radial-gradient(ellipse at 60% 20%, rgba(73,75,214,0.08) 0%, transparent 60%),
                        radial-gradient(ellipse at 20% 80%, rgba(192,193,255,0.04) 0%, transparent 50%);
    }
    .login-card {
      width: 420px; background: #111929;
      border: 1px solid rgba(70,69,84,0.25);
      border-radius: 8px; padding: 2.5rem;
      box-shadow: 0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(192,193,255,0.04);
    }
    .brand-row {
      display: flex; align-items: center; gap: 0.75rem;
      margin-bottom: 0.25rem;
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
    .divider {
      height: 1px; background: rgba(70,69,84,0.2);
      margin-bottom: 1.75rem;
    }
    h2 {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 600; font-size: 1rem;
      color: #a09fb2; margin: 0 0 1.5rem;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .field { margin-bottom: 1rem; width: 100%; }
    .error-msg {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; color: #ffb4ab;
      background: rgba(147,0,10,0.12);
      border: 1px solid rgba(255,180,171,0.2);
      border-radius: 4px; padding: 0.625rem 0.75rem;
      margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;
    }
    .submit-btn {
      width: 100%; height: 44px;
      background: #c0c1ff; color: #1000a9;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 0.8125rem;
      text-transform: uppercase; letter-spacing: 0.08em;
      border: none; border-radius: 6px; cursor: pointer;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
      position: relative; overflow: hidden;
    }
    .submit-btn:hover:not(:disabled) {
      background: #d4d5ff;
      box-shadow: 0 4px 16px rgba(192,193,255,0.25);
    }
    .submit-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    input:-webkit-autofill,
    input:-webkit-autofill:hover,
    input:-webkit-autofill:focus {
      -webkit-box-shadow: 0 0 0 1000px #111929 inset !important;
      -webkit-text-fill-color: #dae2fd !important;
      caret-color: #dae2fd;
    }
    .footer-note {
      margin-top: 1.5rem;
      text-align: center;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; color: #6e6d80;
      letter-spacing: 0.05em;
    }
  `],
  template: `
    <div class="login-card">
      <div class="brand-row">
        <img class="brand-logo" src="logo_genoma.png" alt="GenomaFlow"/>
        <div class="brand">GenomaFlow</div>
      </div>
      <div class="brand-sub">Clinical AI Platform &middot; v1.0</div>
      <div class="divider"></div>
      <h2>Acesso ao sistema</h2>

      @if (showActivatedBanner) {
        <div style="border-left:2px solid #585990;background:rgba(192,193,255,0.08);padding:1rem;border-radius:0.25rem;margin-bottom:1.5rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#c0c1ff;">
          ✅ Conta ativada! Seus créditos de boas-vindas já estão disponíveis.
        </div>
      }

      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field class="field" appearance="outline">
          <mat-label>E-mail</mat-label>
          <input matInput type="email" formControlName="email" autocomplete="email" />
        </mat-form-field>

        <mat-form-field class="field" appearance="outline">
          <mat-label>Senha</mat-label>
          <input matInput [type]="showPass ? 'text' : 'password'" formControlName="password" autocomplete="current-password" />
          <button mat-icon-button matSuffix type="button" (click)="showPass = !showPass">
            <mat-icon>{{ showPass ? 'visibility_off' : 'visibility' }}</mat-icon>
          </button>
        </mat-form-field>

        @if (error) {
          <div class="error-msg">{{ error }}</div>
        }

        @if (needsVerification) {
          <div style="background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;padding:0.75rem;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.5;margin-bottom:1rem;">
            Seu e-mail ainda não foi verificado. Verifique sua caixa de entrada ou
            <a href="javascript:void(0)" (click)="resendVerification()" style="color:#fbbf24;text-decoration:underline;cursor:pointer;">
              {{ resending ? 'reenviando...' : (resent ? 'reenviado ✓' : 'reenviar link') }}
            </a>.
          </div>
        }

        <button class="submit-btn" type="submit" [disabled]="loading">
          {{ loading ? 'AUTENTICANDO...' : 'ENTRAR' }}
        </button>
      </form>
      <div class="footer-note">
        <a routerLink="/forgot-password" style="color:#c0c1ff;text-decoration:none">Esqueci a senha</a>
        &nbsp;&middot;&nbsp;
        Não tem conta? <a routerLink="/register" style="color:#c0c1ff;text-decoration:none">Registrar</a>
      </div>
    </div>
  `
})
export class LoginComponent implements OnInit {
  private auth   = inject(AuthService);
  private fb     = inject(FormBuilder);
  private route  = inject(ActivatedRoute);
  private router = inject(Router);
  private http   = inject(HttpClient);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required]
  });

  error = '';
  loading = false;
  showPass = false;
  showActivatedBanner = false;

  needsVerification = false;
  resending = false;
  resent = false;

  ngOnInit(): void {
    this.showActivatedBanner = this.route.snapshot.queryParams['activated'] === 'true';
  }

  submit(): void {
    if (this.form.invalid) return;
    this.error = '';
    this.needsVerification = false;
    this.resent = false;
    this.loading = true;
    const { email, password } = this.form.value;
    this.auth.login(email!, password!).subscribe({
      next: () => { this.loading = false; },
      error: (err) => {
        this.loading = false;
        if (err.status === 403 && err.error?.error === 'EMAIL_NOT_VERIFIED') {
          this.needsVerification = true;
          this.error = '';
        } else {
          this.error = err.error?.error ?? 'E-mail ou senha inválidos.';
        }
      }
    });
  }

  resendVerification(): void {
    const email = this.form.value.email;
    if (!email || this.resending) return;
    this.resending = true;
    this.http.post(`${environment.apiUrl}/auth/email-verification/send-by-email`, { email })
      .subscribe({
        next: () => { this.resending = false; this.resent = true; },
        error: () => { this.resending = false; this.resent = true; } // mesmo em erro mostramos sucesso pra não vazar info
      });
  }
}
