import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  styles: [`
    :host { display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0b1326; }
    .card { width:420px;max-width:92vw;background:#111929;border:1px solid rgba(70,69,84,0.25);border-radius:8px;padding:2.5rem;color:#dae2fd;font-family:'Space Grotesk',sans-serif; }
    h1 { font-size:1.25rem;font-weight:700;margin:0 0 0.5rem;color:#c0c1ff; }
    .sub { color:#a09fb2;font-size:0.85rem;margin:0 0 1.5rem;line-height:1.45; }
    .field { width:100%;margin-bottom:1rem; }
    .submit-btn { width:100%;height:44px;background:#c0c1ff;color:#1000a9;font-weight:700;font-size:0.8125rem;text-transform:uppercase;letter-spacing:0.08em;border:none;border-radius:6px;cursor:pointer;transition:background 150ms; }
    .submit-btn:hover:not(:disabled) { background:#d4d5ff; }
    .submit-btn:disabled { opacity:0.4;cursor:not-allowed; }
    .footer { margin-top:1.25rem;text-align:center;font-family:'JetBrains Mono',monospace;font-size:11px;color:#7c7b8f; }
    .footer a { color:#c0c1ff;text-decoration:none; }
    .ok { background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);color:#10b981;padding:0.75rem;border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.5; }
  `],
  template: `
    <div class="card">
      <h1>Esqueci a senha</h1>
      <p class="sub">Informe o e-mail da sua conta. Se estiver cadastrado, enviaremos um link pra redefinir a senha. O link vale por 1 hora.</p>

      @if (sent()) {
        <div class="ok">✓ Se o e-mail estiver cadastrado, você vai receber o link em instantes. Verifique sua caixa de entrada e o spam.</div>
        <div class="footer"><a routerLink="/login">Voltar ao login</a></div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field class="field" appearance="outline">
            <mat-label>E-mail</mat-label>
            <input matInput type="email" formControlName="email" autocomplete="email"/>
          </mat-form-field>
          <button class="submit-btn" type="submit" [disabled]="form.invalid || loading()">
            {{ loading() ? 'ENVIANDO...' : 'ENVIAR LINK' }}
          </button>
        </form>
        <div class="footer"><a routerLink="/login">Voltar ao login</a></div>
      }
    </div>
  `
})
export class ForgotPasswordComponent {
  private http = inject(HttpClient);
  private fb   = inject(FormBuilder);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]]
  });

  loading = signal(false);
  sent    = signal(false);

  submit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.http.post(`${environment.apiUrl}/auth/password-reset/request`,
      { email: this.form.value.email }
    ).subscribe({
      next: () => { this.loading.set(false); this.sent.set(true); },
      error: () => { this.loading.set(false); this.sent.set(true); } // sempre mostra ok — evita enumeration
    });
  }
}
