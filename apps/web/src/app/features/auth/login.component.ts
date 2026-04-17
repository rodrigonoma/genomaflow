import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  styles: [`
    :host {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: #0b1326;
    }
    .login-card {
      width: 400px; background: #131b2e;
      border: 1px solid rgba(70,69,84,0.2);
      border-radius: 4px; padding: 2.5rem;
    }
    .brand {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 1.5rem;
      color: #c0c1ff; letter-spacing: -0.02em;
      margin-bottom: 0.25rem;
    }
    .brand-sub {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.15em; color: #464554;
      margin-bottom: 2rem;
    }
    h2 {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 1.125rem;
      color: #dae2fd; margin: 0 0 1.5rem;
    }
    .field { margin-bottom: 1rem; width: 100%; }
    .error-msg {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; color: #ffb4ab;
      background: rgba(147,0,10,0.15);
      border: 1px solid rgba(255,180,171,0.2);
      border-radius: 4px; padding: 0.5rem 0.75rem;
      margin-bottom: 1rem;
    }
    .submit-btn {
      width: 100%; height: 44px;
      background: #c0c1ff; color: #1000a9;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 0.8125rem;
      text-transform: uppercase; letter-spacing: 0.08em;
      border: none; border-radius: 4px; cursor: pointer;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .submit-btn:hover:not(:disabled) { filter: brightness(1.1); }
    .submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  `],
  template: `
    <div class="login-card">
      <div class="brand">GenomaFlow</div>
      <div class="brand-sub">Clinical AI Platform &middot; v1.0</div>
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

        <button class="submit-btn" type="submit" [disabled]="form.invalid || loading">
          {{ loading ? 'AUTENTICANDO...' : 'ENTRAR' }}
        </button>
      </form>
    </div>
  `
})
export class LoginComponent implements OnInit {
  private auth = inject(AuthService);
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required]
  });

  error = '';
  loading = false;
  showPass = false;
  showActivatedBanner = false;

  ngOnInit(): void {
    this.showActivatedBanner = this.route.snapshot.queryParams['activated'] === 'true';
  }

  submit(): void {
    if (this.form.invalid) return;
    this.error = '';
    this.loading = true;
    const { email, password } = this.form.value;
    // AuthService.login() already navigates to the correct role page internally
    this.auth.login(email!, password!).subscribe({
      next: () => { this.loading = false; },
      error: () => {
        this.loading = false;
        this.error = 'E-mail ou senha inválidos.';
      }
    });
  }
}
