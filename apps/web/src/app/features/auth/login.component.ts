import { Component, inject } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule
  ],
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

      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field class="field" appearance="outlined">
          <mat-label>E-mail</mat-label>
          <input matInput type="email" formControlName="email" autocomplete="email" />
        </mat-form-field>

        <mat-form-field class="field" appearance="outlined">
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
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  error = '';
  loading = false;
  showPass = false;

  submit(): void {
    if (this.form.invalid) return;

    this.error = '';
    this.loading = true;
    const { email, password } = this.form.value;

    this.auth.login(email!, password!).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigate(['/dashboard']);
      },
      error: () => {
        this.loading = false;
        this.error = 'E-mail ou senha inválidos.';
      }
    });
  }
}
