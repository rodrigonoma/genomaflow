import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { environment } from '../../../environments/environment';

interface CreateTenantResp {
  tenant_id: string;
  user_id: string;
  email: string;
  active: boolean;
  initial_credits: number;
}

/**
 * Dialog do master pra criar tenant manualmente.
 *
 * Body: { clinic_name, email, password, module, professional_type,
 *         initial_credits, mark_email_verified, accept_all_terms, active,
 *         require_password_change }
 *
 * Backend: POST /master/tenants — cria tenant + user admin em transação.
 * Por padrão: active=true, email já verificado, todos os termos aceitos,
 * obriga troca de senha no primeiro login.
 */
@Component({
  selector: 'app-create-tenant-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule,
    MatIconModule, MatProgressSpinnerModule, MatSnackBarModule,
  ],
  styles: [`
    :host { color:#dae2fd; display:block; max-height:88vh; overflow:hidden; display:flex; flex-direction:column; }
    .header { padding:1rem 1.25rem; display:flex; align-items:center; gap:.625rem; border-bottom:1px solid rgba(70,69,84,.25); }
    h2 { margin:0; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:1.05rem; color:#c0c1ff; flex:1; }

    .body { padding:1rem 1.25rem; overflow-y:auto; flex:1; }

    label { display:block; font-size:.7rem; color:#7c7b8f; margin-bottom:.25rem;
            text-transform:uppercase; letter-spacing:.08em; font-family:'JetBrains Mono',monospace; margin-top:.625rem; }
    input, select { width:100%; padding:.55rem .75rem; background:#0e1525; color:#dae2fd;
                    border:1px solid rgba(70,69,84,.4); border-radius:5px; font-size:.85rem; }
    input:focus, select:focus { outline:none; border-color:#c0c1ff; }
    .row-2 { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; }

    .toggles { margin-top:.875rem; display:flex; flex-direction:column; gap:.45rem;
               background:#0e1525; padding:.75rem; border-radius:6px; border:1px solid rgba(70,69,84,.25); }
    .toggle-row { display:flex; align-items:flex-start; gap:.5rem; font-size:.78rem; color:#dae2fd; cursor:pointer; }
    .toggle-row input { width:auto; margin-top:.15rem; }
    .toggle-row .desc { color:#7c7b8f; font-size:.7rem; margin-left:1.5rem; display:block; margin-top:.125rem; }

    .error { color:#fca5a5; font-size:.78rem; margin-top:.5rem;
             padding:.5rem .75rem; background:rgba(220,38,38,.12);
             border:1px solid rgba(239,68,68,.3); border-radius:4px; }
    .success { color:#86efac; font-size:.78rem; margin-top:.5rem;
               padding:.5rem .75rem; background:rgba(34,197,94,.12);
               border:1px solid rgba(34,197,94,.3); border-radius:4px;
               font-family:'JetBrains Mono',monospace; }

    .footer { padding:.75rem 1.25rem; display:flex; justify-content:flex-end; gap:.625rem;
              border-top:1px solid rgba(70,69,84,.25); }
    .btn-primary {
      background:#c0c1ff; color:#1000a9; border:none; border-radius:5px;
      padding:.55rem 1.25rem; cursor:pointer; font-size:.72rem; font-weight:700;
      letter-spacing:.05em; text-transform:uppercase;
      display:inline-flex; align-items:center; gap:.4rem;
    }
    .btn-primary:disabled { opacity:.4; cursor:not-allowed; }
    .btn-ghost { background:transparent; color:#a09fb2; border:1px solid rgba(70,69,84,.4); border-radius:5px;
                 padding:.55rem 1rem; cursor:pointer; font-size:.72rem; }
  `],
  template: `
    <div class="header">
      <mat-icon style="color:#c0c1ff;">add_business</mat-icon>
      <h2>Criar tenant manualmente</h2>
    </div>

    <div class="body">
      <label>Nome da clínica *</label>
      <input type="text" [(ngModel)]="form.clinic_name" maxlength="120"/>

      <div class="row-2">
        <div>
          <label>Email do admin *</label>
          <input type="email" [(ngModel)]="form.email"/>
        </div>
        <div>
          <label>Senha inicial * (mín 8)</label>
          <input type="text" [(ngModel)]="form.password" autocomplete="new-password"/>
        </div>
      </div>

      <div class="row-2">
        <div>
          <label>Módulo *</label>
          <select [(ngModel)]="form.module">
            <option value="human">human</option>
            <option value="veterinary">veterinary</option>
            <option value="estetica">estetica</option>
          </select>
        </div>
        <div>
          <label>Tipo profissional</label>
          <select [(ngModel)]="form.professional_type">
            <option value="medico">medico</option>
            <option value="esteticista">esteticista</option>
            <option value="dentista">dentista</option>
            <option value="biomedico">biomedico</option>
            <option value="outro">outro</option>
          </select>
        </div>
      </div>

      <label>Créditos iniciais (opcional)</label>
      <input type="number" min="0" max="100000" [(ngModel)]="form.initial_credits"/>

      <div class="toggles">
        <label class="toggle-row">
          <input type="checkbox" [(ngModel)]="form.active"/>
          <span>Tenant ativo
            <span class="desc">Se desmarcado, login fica bloqueado até o master ativar</span>
          </span>
        </label>
        <label class="toggle-row">
          <input type="checkbox" [(ngModel)]="form.mark_email_verified"/>
          <span>Marcar email como verificado
            <span class="desc">Pula a etapa de verificação por email (não envia link)</span>
          </span>
        </label>
        <label class="toggle-row">
          <input type="checkbox" [(ngModel)]="form.accept_all_terms"/>
          <span>Aceitar todos os termos legais (5 docs)
            <span class="desc">Registra aceite de Contrato SaaS, DPA, Políticas (Incidentes, Segurança, Uso Aceitável)</span>
          </span>
        </label>
        <label class="toggle-row">
          <input type="checkbox" [(ngModel)]="form.require_password_change"/>
          <span>Exigir troca de senha no primeiro login
            <span class="desc">Recomendado quando você define uma senha temporária</span>
          </span>
        </label>
      </div>

      @if (errorMsg()) { <div class="error">{{ errorMsg() }}</div> }
      @if (created()) {
        <div class="success">
          ✓ Tenant criado<br>
          tenant_id: {{ created()!.tenant_id }}<br>
          user_id: {{ created()!.user_id }}
        </div>
      }
    </div>

    <div class="footer">
      @if (created()) {
        <button class="btn-primary" (click)="closeWithSuccess()">Fechar</button>
      } @else {
        <button class="btn-ghost" (click)="cancel()" [disabled]="saving()">Cancelar</button>
        <button class="btn-primary" (click)="submit()"
                [disabled]="saving() || !valid()">
          @if (saving()) { <mat-spinner diameter="14"></mat-spinner> }
          Criar
        </button>
      }
    </div>
  `,
})
export class CreateTenantDialogComponent {
  private ref = inject(MatDialogRef<CreateTenantDialogComponent, CreateTenantResp | null>);
  private http = inject(HttpClient);
  private snack = inject(MatSnackBar);

  form = {
    clinic_name: '',
    email: '',
    password: '',
    module: 'veterinary' as 'human' | 'veterinary' | 'estetica',
    professional_type: 'medico' as 'medico' | 'esteticista' | 'dentista' | 'biomedico' | 'outro',
    initial_credits: 0,
    active: true,
    mark_email_verified: true,
    accept_all_terms: true,
    require_password_change: true,
  };

  saving = signal(false);
  errorMsg = signal<string | null>(null);
  created = signal<CreateTenantResp | null>(null);

  valid(): boolean {
    return !!(this.form.clinic_name?.trim() && this.form.email?.trim()
              && this.form.password && this.form.password.length >= 8);
  }

  cancel() { this.ref.close(null); }
  closeWithSuccess() { this.ref.close(this.created()); }

  submit() {
    this.errorMsg.set(null);
    if (!this.valid()) {
      this.errorMsg.set('Preencha todos os campos obrigatórios.');
      return;
    }
    this.saving.set(true);
    this.http.post<CreateTenantResp>(`${environment.apiUrl}/master/tenants`, {
      clinic_name: this.form.clinic_name.trim(),
      email: this.form.email.trim().toLowerCase(),
      password: this.form.password,
      module: this.form.module,
      professional_type: this.form.professional_type,
      initial_credits: this.form.initial_credits || 0,
      active: this.form.active,
      mark_email_verified: this.form.mark_email_verified,
      accept_all_terms: this.form.accept_all_terms,
      require_password_change: this.form.require_password_change,
    }).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.created.set(res);
        this.snack.open('Tenant criado com sucesso', '', { duration: 3000 });
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMsg.set(err.error?.error || 'Erro ao criar tenant');
      },
    });
  }
}
