import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { environment } from '../../../environments/environment';
import { PaymentLinkDialogComponent } from './payment-link-dialog.component';

interface TenantInfo {
  id: string;
  name: string;
  module: 'human' | 'veterinary' | 'estetica';
  type: string;
  active: boolean;
  created_at: string;
}

interface UserItem {
  id: string;
  email: string;
  role: string;
  specialty?: string | null;
  professional_type?: string | null;
  active: boolean;
  email_verified_at: string | null;
  password_change_required: boolean;
  created_at: string;
}

interface CreditItem {
  id: string;
  amount: number;
  kind: string;
  description: string | null;
  created_at: string;
}

interface TenantDetail {
  tenant: TenantInfo;
  balance: number;
  users: UserItem[];
  credit_history: CreditItem[];
}

/**
 * Tela master de gestão consolidada de UM tenant.
 *
 * Acesso: /master/tenants/:id (master only — guard pelo authGuard + role check no template).
 *
 * Ações por tenant:
 *  - Ativar / desativar
 *  - Adicionar/ajustar créditos (positivo ou negativo)
 *
 * Ações por user do tenant:
 *  - Ativar / desativar
 *  - Marcar email como verificado (master pula a verificação por email)
 *  - Resetar senha (definindo nova) com opção de forçar troca no próximo login
 *  - Forçar/cancelar troca de senha no próximo login (sem mudar senha)
 *
 * Não permite ações sobre conta master (role='master') — backend e UI bloqueiam.
 *
 * Não substitui o flow normal — quem quer onboarding pago via Stripe usa o checkout;
 * esta tela é pra suporte/master ajustar tenants quando necessário.
 */
@Component({
  selector: 'app-master-tenant-detail',
  standalone: true,
  imports: [
    CommonModule, DatePipe, FormsModule, RouterModule,
    MatIconModule, MatButtonModule, MatFormFieldModule, MatInputModule,
    MatTooltipModule, MatSnackBarModule, MatProgressSpinnerModule, MatDialogModule,
  ],
  styles: [`
    /* fixed/inset/z-index igual ao MasterComponent — cobre a sidebar do AppComponent
       (que sempre renderiza, mas master tem layout próprio). */
    :host { display:block; position:fixed; inset:0; z-index:9999;
            background:#080e1c; overflow:auto;
            padding:1.5rem 2rem 3rem; color:#dae2fd; }
    .inner { max-width:1200px; margin:0 auto; }

    .header { display:flex; align-items:center; gap:.75rem; margin-bottom:1.5rem; }
    .back-btn {
      background:transparent; border:1px solid rgba(70,69,84,.4); color:#a09fb2;
      border-radius:6px; padding:6px 10px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;
    }
    .back-btn:hover { color:#dae2fd; border-color:rgba(192,193,255,.4); }
    h1 { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:1.4rem; color:#c0c1ff; margin:0; flex:1; }
    .module-badge {
      background:rgba(192,193,255,.15); color:#c0c1ff; padding:3px 10px; border-radius:14px;
      font-family:'JetBrains Mono',monospace; font-size:.65rem; text-transform:uppercase; letter-spacing:.1em;
    }

    .grid { display:grid; grid-template-columns:1fr 1fr; gap:1.25rem; }
    .card {
      background:#131b2e; border:1px solid rgba(70,69,84,.25); border-radius:8px;
      padding:1.25rem;
    }
    .card-title {
      font-family:'JetBrains Mono',monospace; font-size:.7rem; color:#7c7b8f;
      text-transform:uppercase; letter-spacing:.1em; margin-bottom:.875rem;
      padding-bottom:.5rem; border-bottom:1px solid rgba(70,69,84,.2);
      display:flex; align-items:center; gap:.5rem;
    }

    .info-row { display:flex; justify-content:space-between; padding:.375rem 0; font-size:.85rem; }
    .info-row .k { color:#7c7b8f; }
    .info-row .v { color:#dae2fd; font-family:'JetBrains Mono',monospace; }
    .status-pill { padding:2px 9px; border-radius:10px; font-size:.65rem; font-family:'JetBrains Mono',monospace;
                   text-transform:uppercase; letter-spacing:.1em; }
    .status-pill.active { background:rgba(34,197,94,.18); color:#86efac; border:1px solid rgba(34,197,94,.4); }
    .status-pill.inactive { background:rgba(220,38,38,.18); color:#fca5a5; border:1px solid rgba(239,68,68,.4); }

    .balance-big { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:2.2rem; color:#c0c1ff; }
    .balance-sub { color:#7c7b8f; font-size:.75rem; font-family:'JetBrains Mono',monospace; }

    .row-input { display:flex; gap:.5rem; align-items:flex-start; margin-top:.75rem; }
    .row-input input { flex:1; }

    .btn-primary {
      background:#c0c1ff; color:#1000a9; border:none; border-radius:5px;
      padding:.5rem .875rem; cursor:pointer; font-size:.7rem; font-weight:700;
      letter-spacing:.05em; text-transform:uppercase;
      display:inline-flex; align-items:center; gap:4px;
    }
    .btn-primary:hover { background:#d0d2ff; }
    .btn-primary:disabled { opacity:.5; cursor:not-allowed; }

    .btn-warn {
      background:rgba(220,38,38,.18); color:#fca5a5; border:1px solid rgba(239,68,68,.4); border-radius:5px;
      padding:.4rem .75rem; cursor:pointer; font-size:.7rem;
    }
    .btn-warn:hover { background:rgba(220,38,38,.3); }

    .btn-ghost {
      background:transparent; color:#a09fb2; border:1px solid rgba(70,69,84,.4); border-radius:5px;
      padding:.4rem .75rem; cursor:pointer; font-size:.7rem;
    }
    .btn-ghost:hover { color:#dae2fd; border-color:rgba(192,193,255,.4); }

    .users-list { display:flex; flex-direction:column; gap:.625rem; }
    .user-item {
      background:#0e1525; border:1px solid rgba(70,69,84,.2); border-radius:6px;
      padding:.75rem .875rem;
    }
    .user-head { display:flex; align-items:center; gap:.75rem; flex-wrap:wrap; }
    .user-email { font-family:'JetBrains Mono',monospace; font-size:.825rem; color:#dae2fd; flex:1; word-break:break-all; }
    .user-meta { font-size:.7rem; color:#7c7b8f; display:flex; gap:.625rem; flex-wrap:wrap; margin-top:.25rem; }
    .user-meta .pill {
      background:rgba(70,69,84,.25); color:#a09fb2; padding:1px 6px; border-radius:3px;
      font-family:'JetBrains Mono',monospace; font-size:.6rem;
    }
    .user-meta .pill.warn { background:rgba(252,211,77,.15); color:#fcd34d; border:1px solid rgba(252,211,77,.3); }
    .user-meta .pill.danger { background:rgba(220,38,38,.18); color:#fca5a5; border:1px solid rgba(239,68,68,.4); }
    .user-meta .pill.ok { background:rgba(34,197,94,.15); color:#86efac; border:1px solid rgba(34,197,94,.3); }

    .user-actions {
      display:flex; gap:.375rem; margin-top:.625rem; flex-wrap:wrap;
    }

    .credit-history { max-height:340px; overflow-y:auto; margin-top:.75rem; }
    .credit-row {
      display:flex; justify-content:space-between; align-items:center;
      padding:.5rem .75rem; border-bottom:1px solid rgba(70,69,84,.15);
      font-size:.78rem;
    }
    .credit-row:last-child { border-bottom:none; }
    .credit-amt { font-family:'JetBrains Mono',monospace; font-weight:700; }
    .credit-amt.pos { color:#86efac; }
    .credit-amt.neg { color:#fca5a5; }
    .credit-row .desc { color:#a09fb2; flex:1; padding:0 1rem; }
    .credit-row .date { color:#6e6d80; font-family:'JetBrains Mono',monospace; font-size:.7rem; }

    .reset-pwd-form {
      background:#0e1525; border:1px solid rgba(70,69,84,.2); border-radius:6px;
      padding:.75rem; margin-top:.625rem;
    }
    .reset-pwd-form .row { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; }
    .reset-pwd-form input { flex:1; min-width:180px; padding:.45rem .625rem; border-radius:4px;
                            border:1px solid rgba(70,69,84,.4); background:#131b2e; color:#dae2fd;
                            font-size:.8rem; }
    .reset-pwd-form label { font-size:.7rem; color:#a09fb2; display:flex; align-items:center; gap:4px; }
    .reset-pwd-form .help { font-size:.65rem; color:#7c7b8f; margin-top:.375rem; }

    .loading { display:flex; gap:.75rem; align-items:center; color:#7c7b8f; padding:1rem; }

    @media (max-width:840px) {
      .grid { grid-template-columns:1fr; }
      :host { padding:1rem; }
    }
  `],
  template: `
    <div class="header">
      <button class="back-btn" (click)="back()">
        <mat-icon style="font-size:18px;width:18px;height:18px;">arrow_back</mat-icon>
        Voltar
      </button>
      @if (data()) {
        <h1>{{ data()!.tenant.name }}</h1>
        <span class="module-badge">{{ data()!.tenant.module }}</span>
      }
    </div>

    @if (loading()) {
      <div class="loading">
        <mat-spinner diameter="22"></mat-spinner>
        Carregando dados do tenant…
      </div>
    } @else if (data()) {
      <div class="grid">
        <!-- Tenant info + ações -->
        <div class="card">
          <div class="card-title"><mat-icon>business</mat-icon> Tenant</div>
          <div class="info-row"><span class="k">ID</span><span class="v">{{ data()!.tenant.id }}</span></div>
          <div class="info-row"><span class="k">Tipo</span><span class="v">{{ data()!.tenant.type }}</span></div>
          <div class="info-row"><span class="k">Módulo</span><span class="v">{{ data()!.tenant.module }}</span></div>
          <div class="info-row"><span class="k">Criado em</span><span class="v">{{ data()!.tenant.created_at | date:'dd/MM/yyyy HH:mm' }}</span></div>
          <div class="info-row">
            <span class="k">Status</span>
            <span class="status-pill" [class.active]="data()!.tenant.active" [class.inactive]="!data()!.tenant.active">
              {{ data()!.tenant.active ? 'Ativo' : 'Inativo' }}
            </span>
          </div>
          <div style="margin-top:.875rem; display:flex; gap:.5rem; flex-wrap:wrap;">
            @if (data()!.tenant.active) {
              <button class="btn-warn" (click)="toggleTenant(false)">Desativar tenant</button>
            } @else {
              <button class="btn-primary" (click)="toggleTenant(true)">Ativar tenant</button>
            }
            @if (data()!.tenant.active) {
              <button class="btn-ghost" (click)="impersonate()" matTooltip="Abre nova aba acessando como o admin do tenant — sua sessão master segue ativa">
                <mat-icon style="font-size:14px;width:14px;height:14px;vertical-align:middle;margin-right:4px;">person_pin_circle</mat-icon>
                Acessar como tenant
              </button>
            }
          </div>
        </div>

        <!-- Saldo de créditos + adicionar -->
        <div class="card">
          <div class="card-title"><mat-icon>toll</mat-icon> Créditos</div>
          <div class="balance-big">{{ data()!.balance }}</div>
          <div class="balance-sub">saldo atual</div>
          <div class="row-input">
            <input type="number" [(ngModel)]="creditAmount" placeholder="Quantidade (+ ou −)"/>
            <button class="btn-primary" [disabled]="!creditAmount || saving()" (click)="addCredits()">Aplicar</button>
          </div>
          <input type="text" [(ngModel)]="creditDescription" placeholder="Motivo (opcional)"
                 style="margin-top:.5rem; width:100%; padding:.45rem .625rem; border-radius:4px; border:1px solid rgba(70,69,84,.4); background:#0e1525; color:#dae2fd; font-size:.8rem;"/>

          <button class="btn-ghost" style="margin-top:.75rem; width:100%;"
                  (click)="openPaymentLink()" matTooltip="Cria Stripe Checkout Session pra esse tenant (suporta desconto via coupon)">
            <mat-icon style="font-size:14px;width:14px;height:14px;vertical-align:middle;margin-right:4px;">credit_card</mat-icon>
            Gerar link de pagamento Stripe
          </button>

          @if (data()!.credit_history.length > 0) {
            <div style="font-family:'JetBrains Mono',monospace; font-size:.65rem; color:#7c7b8f; margin-top:1rem; text-transform:uppercase; letter-spacing:.1em;">Últimos lançamentos</div>
            <div class="credit-history">
              @for (c of data()!.credit_history; track c.id) {
                <div class="credit-row">
                  <span class="credit-amt" [class.pos]="c.amount > 0" [class.neg]="c.amount < 0">
                    {{ c.amount > 0 ? '+' : '' }}{{ c.amount }}
                  </span>
                  <span class="desc">{{ c.description || c.kind }}</span>
                  <span class="date">{{ c.created_at | date:'dd/MM HH:mm' }}</span>
                </div>
              }
            </div>
          }
        </div>

        <!-- Users do tenant -->
        <div class="card" style="grid-column:1/-1;">
          <div class="card-title"><mat-icon>group</mat-icon> Usuários ({{ data()!.users.length }})</div>
          <div class="users-list">
            @for (u of data()!.users; track u.id) {
              <div class="user-item">
                <div class="user-head">
                  <span class="user-email">{{ u.email }}</span>
                  <span class="status-pill" [class.active]="u.active" [class.inactive]="!u.active">
                    {{ u.active ? 'Ativo' : 'Desativado' }}
                  </span>
                </div>
                <div class="user-meta">
                  <span class="pill">{{ u.role }}</span>
                  @if (u.professional_type) { <span class="pill">{{ u.professional_type }}</span> }
                  @if (u.specialty) { <span class="pill">{{ u.specialty }}</span> }
                  @if (u.email_verified_at) {
                    <span class="pill ok" matTooltip="{{ u.email_verified_at | date:'dd/MM/yyyy HH:mm' }}">email verificado</span>
                  } @else {
                    <span class="pill warn">email não verificado</span>
                  }
                  @if (u.password_change_required) {
                    <span class="pill warn">trocar senha no próximo login</span>
                  }
                </div>
                <div class="user-actions">
                  <button class="btn-ghost" (click)="toggleUser(u)">
                    {{ u.active ? 'Desativar' : 'Ativar' }}
                  </button>
                  @if (!u.email_verified_at) {
                    <button class="btn-ghost" (click)="verifyEmail(u)">Marcar email verificado</button>
                  }
                  <button class="btn-ghost" (click)="togglePwdForm(u.id)">
                    {{ pwdFormFor() === u.id ? 'Cancelar' : 'Resetar senha' }}
                  </button>
                  @if (!u.password_change_required) {
                    <button class="btn-ghost" (click)="setRequireChange(u, true)">Forçar troca senha próximo login</button>
                  } @else {
                    <button class="btn-ghost" (click)="setRequireChange(u, false)">Cancelar exigência de troca</button>
                  }
                </div>

                @if (pwdFormFor() === u.id) {
                  <div class="reset-pwd-form">
                    <div class="row">
                      <input type="text" [(ngModel)]="newPwd" placeholder="Nova senha (mín 8 chars)" autocomplete="new-password"/>
                      <label><input type="checkbox" [(ngModel)]="requireChangeAfter"/> exigir troca no próximo login</label>
                      <button class="btn-primary" [disabled]="!newPwd || newPwd.length < 8 || saving()" (click)="resetPassword(u)">Salvar</button>
                    </div>
                    <div class="help">A sessão atual do usuário será invalidada (single-session JTI).</div>
                  </div>
                }
              </div>
            }
          </div>
        </div>
      </div>
    } @else if (errorMsg()) {
      <div style="color:#fca5a5; padding:2rem; text-align:center;">{{ errorMsg() }}</div>
    }
  `,
})
export class MasterTenantDetailComponent implements OnInit {
  private route  = inject(ActivatedRoute);
  private router = inject(Router);
  private http   = inject(HttpClient);
  private snack  = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  data       = signal<TenantDetail | null>(null);
  loading    = signal(true);
  errorMsg   = signal<string | null>(null);
  saving     = signal(false);
  pwdFormFor = signal<string | null>(null);

  creditAmount = '';
  creditDescription = '';
  newPwd = '';
  requireChangeAfter = true;

  private tenantId = '';

  ngOnInit() {
    this.tenantId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.tenantId) {
      this.errorMsg.set('Tenant ID não informado');
      this.loading.set(false);
      return;
    }
    this.refresh();
  }

  refresh() {
    this.loading.set(true);
    this.http.get<TenantDetail>(`${environment.apiUrl}/master/tenants/${this.tenantId}/detail`).subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      error: (err) => {
        this.loading.set(false);
        this.errorMsg.set(err.error?.error || 'Erro ao carregar tenant');
      },
    });
  }

  back() { this.router.navigate(['/master']); }

  toggleTenant(activate: boolean) {
    const action = activate ? 'activate' : 'deactivate';
    this.http.patch(`${environment.apiUrl}/master/tenants/${this.tenantId}/${action}`, {}).subscribe({
      next: () => { this.snack.open(activate ? 'Tenant ativado' : 'Tenant desativado', '', { duration: 2500 }); this.refresh(); },
      error: () => this.snack.open('Erro ao atualizar tenant', 'OK', { duration: 4000 }),
    });
  }

  addCredits() {
    const n = parseInt(this.creditAmount);
    if (!n) return;
    this.saving.set(true);
    this.http.post(`${environment.apiUrl}/master/credits`, {
      tenant_id: this.tenantId, amount: n, description: this.creditDescription || undefined,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.creditAmount = ''; this.creditDescription = '';
        this.snack.open('Lançamento aplicado', '', { duration: 2500 });
        this.refresh();
      },
      error: (err) => {
        this.saving.set(false);
        this.snack.open(err.error?.error || 'Erro ao aplicar', 'OK', { duration: 4000 });
      },
    });
  }

  toggleUser(u: UserItem) {
    this.http.patch(`${environment.apiUrl}/master/tenants/${this.tenantId}/users/${u.id}/toggle`, {}).subscribe({
      next: () => { this.snack.open(`Usuário ${u.active ? 'desativado' : 'ativado'}`, '', { duration: 2000 }); this.refresh(); },
      error: () => this.snack.open('Erro', 'OK', { duration: 4000 }),
    });
  }

  verifyEmail(u: UserItem) {
    this.http.post(`${environment.apiUrl}/master/users/${u.id}/verify-email`, {}).subscribe({
      next: () => { this.snack.open('Email marcado como verificado', '', { duration: 2500 }); this.refresh(); },
      error: (err) => this.snack.open(err.error?.error || 'Erro', 'OK', { duration: 4000 }),
    });
  }

  togglePwdForm(userId: string) {
    if (this.pwdFormFor() === userId) {
      this.pwdFormFor.set(null);
      this.newPwd = '';
    } else {
      this.pwdFormFor.set(userId);
      this.newPwd = '';
      this.requireChangeAfter = true;
    }
  }

  resetPassword(u: UserItem) {
    if (!this.newPwd || this.newPwd.length < 8) return;
    this.saving.set(true);
    this.http.post(`${environment.apiUrl}/master/users/${u.id}/reset-password`, {
      password: this.newPwd, require_change: this.requireChangeAfter,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.snack.open('Senha resetada · sessão atual invalidada', '', { duration: 4000 });
        this.pwdFormFor.set(null);
        this.newPwd = '';
        this.refresh();
      },
      error: (err) => {
        this.saving.set(false);
        this.snack.open(err.error?.error || 'Erro ao resetar senha', 'OK', { duration: 4000 });
      },
    });
  }

  /** Master gera token de impersonate e abre nova aba — sessão master continua ativa */
  impersonate() {
    const d = this.data();
    if (!d) return;
    this.http.post<any>(`${environment.apiUrl}/master/tenants/${d.tenant.id}/impersonate`, {}).subscribe({
      next: (res) => {
        const params = new URLSearchParams({
          token: res.token,
          tenant_name: res.tenant_name,
          master_id: '', // backend não devolve, é o master atual; não precisamos pra UI
          target_email: res.user_email || '',
        });
        // Nova aba — isolada por sessionStorage. Aba master fica intocada.
        window.open(`/impersonate-launch?${params.toString()}`, '_blank', 'noopener');
      },
      error: (err) => this.snack.open(err.error?.error || 'Erro ao iniciar impersonate', 'OK', { duration: 4000 }),
    });
  }

  openPaymentLink() {
    const d = this.data();
    if (!d) return;
    this.dialog.open(PaymentLinkDialogComponent, {
      width: '560px',
      panelClass: 'dark-dialog',
      data: { tenant_id: d.tenant.id, tenant_name: d.tenant.name },
    });
  }

  setRequireChange(u: UserItem, required: boolean) {
    this.http.patch(`${environment.apiUrl}/master/users/${u.id}/require-password-change`, { required }).subscribe({
      next: () => { this.snack.open(required ? 'Marcado: trocar senha no próximo login' : 'Exigência de troca cancelada', '', { duration: 2500 }); this.refresh(); },
      error: () => this.snack.open('Erro', 'OK', { duration: 4000 }),
    });
  }
}
