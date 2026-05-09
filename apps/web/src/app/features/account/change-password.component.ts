import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';

/**
 * Tela para o usuário trocar a própria senha. Usada em:
 *  - Troca voluntária a partir do menu de conta
 *  - Troca obrigatória após login quando `password_change_required = true`
 *    (master pode marcar essa flag ao criar conta com senha temporária)
 *
 * Backend: POST /auth/change-password { current_password, new_password }
 * Ao salvar com sucesso, a flag é zerada no DB e o usuário é redirecionado.
 */
@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatSnackBarModule],
  styles: [`
    :host { display:flex; align-items:center; justify-content:center; min-height:100vh; padding:1.5rem; color:#dae2fd; }
    .card {
      width:100%; max-width:420px; background:#131b2e; border:1px solid rgba(70,69,84,.3);
      border-radius:10px; padding:1.75rem;
    }
    .header { display:flex; align-items:center; gap:.625rem; margin-bottom:1.25rem; }
    .header mat-icon { color:#c0c1ff; }
    h1 { margin:0; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:1.1rem; color:#c0c1ff; }
    .lead { color:#a09fb2; font-size:.85rem; line-height:1.5; margin-bottom:1.25rem; }
    .lead strong { color:#fcd34d; }

    label { display:block; font-size:.7rem; color:#7c7b8f; margin-bottom:.25rem;
            text-transform:uppercase; letter-spacing:.08em; font-family:'JetBrains Mono',monospace; }
    input {
      width:100%; padding:.625rem .75rem; background:#0e1525; color:#dae2fd;
      border:1px solid rgba(70,69,84,.4); border-radius:5px; font-size:.9rem;
      margin-bottom:.875rem;
    }
    input:focus { outline:none; border-color:#c0c1ff; }

    .error { color:#fca5a5; font-size:.8rem; margin-bottom:.75rem; }

    .footer { display:flex; gap:.5rem; justify-content:flex-end; margin-top:.5rem; }
    .btn-primary {
      background:#c0c1ff; color:#1000a9; border:none; border-radius:5px;
      padding:.625rem 1.25rem; cursor:pointer; font-size:.75rem; font-weight:700;
      letter-spacing:.05em; text-transform:uppercase; display:inline-flex; align-items:center; gap:.5rem;
    }
    .btn-primary:disabled { opacity:.5; cursor:not-allowed; }
    .btn-ghost {
      background:transparent; color:#a09fb2; border:1px solid rgba(70,69,84,.4); border-radius:5px;
      padding:.625rem 1rem; cursor:pointer; font-size:.75rem;
    }
  `],
  template: `
    <div class="card">
      <div class="header">
        <mat-icon>lock_reset</mat-icon>
        <h1>{{ forced() ? 'Defina uma nova senha' : 'Trocar senha' }}</h1>
      </div>

      @if (forced()) {
        <div class="lead">
          Por segurança, <strong>é necessário trocar sua senha</strong> antes de acessar o sistema.
          Defina uma nova senha de no mínimo 8 caracteres.
        </div>
      } @else {
        <div class="lead">Defina uma nova senha de no mínimo 8 caracteres. Você precisará fazer login novamente após salvar.</div>
      }

      <label>Senha atual</label>
      <input type="password" [(ngModel)]="current" autocomplete="current-password"/>

      <label>Nova senha</label>
      <input type="password" [(ngModel)]="next" autocomplete="new-password"/>

      <label>Confirmar nova senha</label>
      <input type="password" [(ngModel)]="confirm" autocomplete="new-password"/>

      @if (errorMsg()) {
        <div class="error">{{ errorMsg() }}</div>
      }

      <div class="footer">
        @if (!forced()) {
          <button class="btn-ghost" (click)="cancel()" [disabled]="saving()">Cancelar</button>
        }
        <button class="btn-primary" (click)="submit()"
                [disabled]="saving() || !current || !next || next.length < 8 || next !== confirm">
          @if (saving()) { <mat-spinner diameter="14"></mat-spinner> }
          Salvar
        </button>
      </div>
    </div>
  `,
})
export class ChangePasswordComponent {
  private http   = inject(HttpClient);
  private router = inject(Router);
  private auth   = inject(AuthService);
  private snack  = inject(MatSnackBar);

  current = '';
  next = '';
  confirm = '';
  saving = signal(false);
  errorMsg = signal<string | null>(null);

  // forced = true quando flag password_change_required do user atual está true
  forced = signal(this.auth.currentProfile?.password_change_required === true);

  cancel() { this.router.navigate(['/']); }

  submit() {
    this.errorMsg.set(null);
    if (!this.current || !this.next) {
      this.errorMsg.set('Preencha todos os campos.');
      return;
    }
    if (this.next.length < 8) {
      this.errorMsg.set('Nova senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (this.next !== this.confirm) {
      this.errorMsg.set('A confirmação não confere com a nova senha.');
      return;
    }
    if (this.next === this.current) {
      this.errorMsg.set('Nova senha deve ser diferente da atual.');
      return;
    }

    this.saving.set(true);
    this.http.post(`${environment.apiUrl}/auth/change-password`, {
      current_password: this.current,
      new_password: this.next,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.snack.open('Senha alterada. Faça login novamente.', '', { duration: 3000 });
        // Forçar re-login pra rotação de sessão
        this.auth.logout();
        this.router.navigate(['/login']);
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMsg.set(err.error?.error || 'Erro ao trocar senha. Tente novamente.');
      },
    });
  }
}
