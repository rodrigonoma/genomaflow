import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  styles: [`
    :host { display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0b1326; }
    .card { width:420px;max-width:92vw;background:#111929;border:1px solid rgba(70,69,84,0.25);border-radius:8px;padding:2.5rem;color:#dae2fd;font-family:'Space Grotesk',sans-serif; }
    h1 { font-size:1.25rem;font-weight:700;margin:0 0 0.5rem;color:#c0c1ff; }
    .sub { color:#a09fb2;font-size:0.85rem;margin:0 0 1.5rem;line-height:1.45; }
    .field { width:100%;margin-bottom:1rem; }
    .submit-btn { width:100%;height:44px;background:#c0c1ff;color:#1000a9;font-weight:700;font-size:0.8125rem;text-transform:uppercase;letter-spacing:0.08em;border:none;border-radius:6px;cursor:pointer;transition:background 150ms; }
    .submit-btn:hover:not(:disabled) { background:#d4d5ff; }
    .submit-btn:disabled { opacity:0.4;cursor:not-allowed; }
    .error-msg { color:#ffb4ab;background:rgba(147,0,10,0.12);border:1px solid rgba(255,180,171,0.2);border-radius:4px;padding:0.625rem;font-family:'JetBrains Mono',monospace;font-size:11px;margin-bottom:1rem; }
    .ok { background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);color:#10b981;padding:0.75rem;border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.5; }
    .footer { margin-top:1.25rem;text-align:center;font-family:'JetBrains Mono',monospace;font-size:11px;color:#7c7b8f; }
    .footer a { color:#c0c1ff;text-decoration:none; }
  `],
  template: `
    <div class="card">
      <h1>Redefinir senha</h1>

      @if (done()) {
        <div class="ok">✓ Senha redefinida com sucesso! Você já pode entrar com a nova senha.</div>
        <div class="footer"><a routerLink="/login">Ir para login</a></div>
      } @else if (!token) {
        <p class="sub">Link inválido ou ausente.</p>
        <div class="footer"><a routerLink="/forgot-password">Pedir novo link</a></div>
      } @else {
        <p class="sub">Defina uma nova senha de pelo menos 8 caracteres.</p>
        <form [formGroup]="form" (ngSubmit)="submit()">
          @if (error()) { <div class="error-msg">{{ error() }}</div> }

          <mat-form-field class="field" appearance="outline">
            <mat-label>Nova senha</mat-label>
            <input matInput [type]="show() ? 'text' : 'password'" formControlName="password" autocomplete="new-password"/>
            <button mat-icon-button matSuffix type="button" (click)="show.set(!show())">
              <mat-icon>{{ show() ? 'visibility_off' : 'visibility' }}</mat-icon>
            </button>
          </mat-form-field>

          <mat-form-field class="field" appearance="outline">
            <mat-label>Confirmar nova senha</mat-label>
            <input matInput [type]="show() ? 'text' : 'password'" formControlName="confirm" autocomplete="new-password"/>
          </mat-form-field>

          <button class="submit-btn" type="submit" [disabled]="form.invalid || loading()">
            {{ loading() ? 'REDEFININDO...' : 'REDEFINIR SENHA' }}
          </button>
        </form>
        <div class="footer"><a routerLink="/login">Cancelar</a></div>
      }
    </div>
  `
})
export class ResetPasswordComponent implements OnInit {
  private http  = inject(HttpClient);
  private fb    = inject(FormBuilder);
  private route = inject(ActivatedRoute);

  token: string | null = null;
  show    = signal(false);
  loading = signal(false);
  done    = signal(false);
  error   = signal('');

  form = this.fb.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirm:  ['', [Validators.required]]
  });

  ngOnInit() {
    this.token = this.route.snapshot.queryParams['token'] || null;
  }

  submit() {
    const { password, confirm } = this.form.value;
    if (password !== confirm) { this.error.set('As senhas não conferem'); return; }
    if (!this.token) return;

    this.loading.set(true);
    this.error.set('');
    this.http.post(`${environment.apiUrl}/auth/password-reset/confirm`,
      { token: this.token, new_password: password }
    ).subscribe({
      next: () => { this.loading.set(false); this.done.set(true); },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.error ?? 'Erro ao redefinir senha');
      }
    });
  }
}
