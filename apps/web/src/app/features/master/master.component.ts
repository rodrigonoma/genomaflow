import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { environment } from '../../../environments/environment';

interface Tenant {
  id: string; name: string; type: string; module: string; plan: string;
  active: boolean; created_at: string;
  user_count: number; balance: number;
  last_purchase_at: string | null; specialties: string[];
  _expanded?: boolean; _users?: TenantUser[];
}
interface TenantUser {
  id: string; email: string; role: string; specialty: string; active: boolean; created_at: string;
}
interface ErrorLog {
  id: string; url: string; method: string; status_code: number;
  error_message: string; created_at: string;
  tenant_name: string; user_email: string;
}
interface FeedbackItem {
  id: string; type: string; message: string; screenshot_url: string; created_at: string;
  tenant_name: string; user_email: string;
}
interface Stats {
  total_tenants: number; errors_24h: number;
  total_feedback: number; total_credits_issued: number;
}

@Component({
  selector: 'app-master',
  standalone: true,
  imports: [FormsModule, DatePipe, DecimalPipe],
  styles: [`
    :host { display:block; position:fixed; inset:0; z-index:9999;
            background:#080e1c; color:#dae2fd; overflow:auto;
            font-family:'Space Grotesk',sans-serif; }
    .topbar {
      display:flex; align-items:center; justify-content:space-between;
      padding:0 2rem; height:56px;
      background:#0d1525; border-bottom:1px solid rgba(192,193,255,0.08);
    }
    .brand { display:flex; align-items:center; gap:0.75rem; }
    .brand img { width:28px; height:28px; }
    .brand-name { font-weight:700; font-size:1.1rem; color:#c0c1ff; letter-spacing:-0.02em; }
    .brand-badge { font-family:'JetBrains Mono',monospace; font-size:9px;
      background:rgba(192,193,255,0.12); color:#c0c1ff; padding:2px 8px;
      border-radius:3px; text-transform:uppercase; letter-spacing:0.1em; }
    .logout-btn { font-family:'JetBrains Mono',monospace; font-size:11px; color:#6e6d80;
      background:none; border:none; cursor:pointer; transition:color 150ms; }
    .logout-btn:hover { color:#ffb4ab; }
    .layout { display:flex; min-height:calc(100vh - 56px); }
    .sidebar {
      width:200px; flex-shrink:0; background:#0a1120;
      border-right:1px solid rgba(192,193,255,0.06);
      padding:1.5rem 0;
    }
    .nav-item {
      display:flex; align-items:center; gap:0.625rem;
      padding:0.625rem 1.5rem; cursor:pointer;
      font-size:13px; color:#a09fb2; transition:all 150ms;
      border-left:2px solid transparent;
    }
    .nav-item:hover { color:#dae2fd; background:rgba(192,193,255,0.04); }
    .nav-item.active { color:#c0c1ff; border-left-color:#c0c1ff;
      background:rgba(192,193,255,0.06); }
    .nav-icon { font-family:'Material Icons'; font-size:16px; }
    .content { flex:1; padding:2rem; overflow:auto; max-width:1200px; }
    .stats-row { display:grid; grid-template-columns:repeat(4,1fr); gap:1rem; margin-bottom:2rem; }
    .stat-card {
      background:#0d1525; border:1px solid rgba(192,193,255,0.08);
      border-radius:8px; padding:1.25rem;
    }
    .stat-label { font-family:'JetBrains Mono',monospace; font-size:10px;
      text-transform:uppercase; letter-spacing:0.1em; color:#6e6d80; margin-bottom:0.5rem; }
    .stat-value { font-size:1.75rem; font-weight:700; color:#c0c1ff; }
    .section-title { font-size:1rem; font-weight:600; color:#a09fb2;
      text-transform:uppercase; letter-spacing:0.05em; margin-bottom:1rem; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th { font-family:'JetBrains Mono',monospace; font-size:10px; text-transform:uppercase;
      letter-spacing:0.08em; color:#6e6d80; padding:0.5rem 0.75rem;
      text-align:left; border-bottom:1px solid rgba(192,193,255,0.08); }
    td { padding:0.75rem; border-bottom:1px solid rgba(192,193,255,0.05); vertical-align:middle; }
    tr:hover td { background:rgba(192,193,255,0.02); }
    .badge {
      display:inline-block; font-family:'JetBrains Mono',monospace; font-size:10px;
      padding:2px 8px; border-radius:3px; text-transform:uppercase; letter-spacing:0.05em;
    }
    .badge-active { background:rgba(16,185,129,0.15); color:#10b981; }
    .badge-inactive { background:rgba(255,180,171,0.12); color:#ffb4ab; }
    .badge-bug { background:rgba(255,180,171,0.12); color:#ffb4ab; }
    .badge-feature { background:rgba(192,193,255,0.12); color:#c0c1ff; }
    .btn { font-family:'JetBrains Mono',monospace; font-size:11px; padding:4px 12px;
      border-radius:4px; cursor:pointer; border:none; transition:all 150ms;
      text-transform:uppercase; letter-spacing:0.05em; }
    .btn-sm-green { background:rgba(16,185,129,0.15); color:#10b981; }
    .btn-sm-green:hover { background:rgba(16,185,129,0.25); }
    .btn-sm-red { background:rgba(255,180,171,0.12); color:#ffb4ab; }
    .btn-sm-red:hover { background:rgba(255,180,171,0.22); }
    .btn-sm-ghost { background:rgba(192,193,255,0.08); color:#c0c1ff; }
    .btn-sm-ghost:hover { background:rgba(192,193,255,0.15); }
    .expand-row td { background:#0a1120; padding:1rem 1rem 1rem 2.5rem; }
    .user-row { display:flex; align-items:center; gap:1rem; padding:0.375rem 0;
      font-size:12px; border-bottom:1px solid rgba(192,193,255,0.04); }
    .user-row:last-child { border-bottom:none; }
    .credit-form {
      background:#0d1525; border:1px solid rgba(192,193,255,0.08);
      border-radius:8px; padding:1.5rem; max-width:520px;
    }
    .field { margin-bottom:1rem; }
    .field label { display:block; font-family:'JetBrains Mono',monospace;
      font-size:10px; text-transform:uppercase; letter-spacing:0.08em;
      color:#6e6d80; margin-bottom:0.375rem; }
    .field input, .field textarea, .field select {
      width:100%; background:#060d1a; color:#dae2fd;
      border:1px solid rgba(192,193,255,0.12); border-radius:5px;
      padding:0.625rem 0.75rem; font-family:'JetBrains Mono',monospace; font-size:13px;
      outline:none; box-sizing:border-box; transition:border-color 150ms;
    }
    .field input:focus, .field textarea:focus, .field select:focus {
      border-color:rgba(192,193,255,0.4);
    }
    .submit-btn { width:100%; padding:0.75rem; background:#c0c1ff; color:#1000a9;
      font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:13px;
      text-transform:uppercase; letter-spacing:0.08em; border:none; border-radius:6px;
      cursor:pointer; transition:all 150ms; }
    .submit-btn:hover:not(:disabled) { background:#d4d5ff; }
    .submit-btn:disabled { opacity:0.35; cursor:not-allowed; }
    .success-bar { background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.2);
      color:#10b981; font-family:'JetBrains Mono',monospace; font-size:12px;
      padding:0.75rem; border-radius:5px; margin-bottom:1rem; }
    .error-bar { background:rgba(255,180,171,0.1); border:1px solid rgba(255,180,171,0.2);
      color:#ffb4ab; font-family:'JetBrains Mono',monospace; font-size:12px;
      padding:0.75rem; border-radius:5px; margin-bottom:1rem; }
    .mono { font-family:'JetBrains Mono',monospace; }
    .text-muted { color:#6e6d80; }
    .pager { display:flex; align-items:center; gap:0.75rem; margin-top:1rem;
      font-family:'JetBrains Mono',monospace; font-size:11px; color:#6e6d80; }
    .pager button { background:rgba(192,193,255,0.08); color:#c0c1ff; border:none;
      padding:4px 12px; border-radius:4px; cursor:pointer; }
    .pager button:disabled { opacity:0.3; cursor:not-allowed; }
    .filter-row { display:flex; gap:0.75rem; margin-bottom:1rem; }
    .filter-btn { font-family:'JetBrains Mono',monospace; font-size:11px;
      padding:4px 14px; border-radius:4px; cursor:pointer; border:1px solid rgba(192,193,255,0.15);
      background:transparent; color:#a09fb2; transition:all 150ms; text-transform:uppercase; }
    .filter-btn.active, .filter-btn:hover { background:rgba(192,193,255,0.1); color:#c0c1ff;
      border-color:rgba(192,193,255,0.3); }
    .pending-badge { display:inline-flex; align-items:center; justify-content:center;
      background:#ffb4ab; color:#1a0000; border-radius:10px;
      font-family:'JetBrains Mono',monospace; font-size:10px; font-weight:700;
      min-width:18px; height:18px; padding:0 5px; margin-left:auto; }
    .err-msg-cell { max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      font-family:'JetBrains Mono',monospace; font-size:11px; color:#ffb4ab; }
    .msg-cell { max-width:400px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    @media(max-width:900px) {
      .stats-row { grid-template-columns:1fr 1fr; }
      .sidebar { display:none; }
    }
  `],
  template: `
<div>
  <!-- Topbar -->
  <div class="topbar">
    <div class="brand">
      <img src="logo_genoma.png" alt="GenomaFlow"/>
      <span class="brand-name">GenomaFlow</span>
      <span class="brand-badge">Master Panel</span>
    </div>
    <button class="logout-btn" (click)="logout()">Sair</button>
  </div>

  <div class="layout">
    <!-- Sidebar -->
    <div class="sidebar">
      @for (tab of tabs; track tab.id) {
        <div class="nav-item" [class.active]="activeTab() === tab.id" (click)="activeTab.set(tab.id)">
          <span class="nav-icon material-icons">{{ tab.icon }}</span>
          {{ tab.label }}
          @if (tab.id === 'tenants' && pendingCount() > 0) {
            <span class="pending-badge">{{ pendingCount() }}</span>
          }
        </div>
      }
    </div>

    <!-- Main content -->
    <div class="content">

      <!-- Stats always visible -->
      @if (stats()) {
        <div class="stats-row">
          <div class="stat-card">
            <div class="stat-label">Tenants</div>
            <div class="stat-value">{{ stats()!.total_tenants }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Erros 24h</div>
            <div class="stat-value" [style.color]="stats()!.errors_24h > 0 ? '#ffb4ab' : '#10b981'">
              {{ stats()!.errors_24h }}
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Feedbacks</div>
            <div class="stat-value">{{ stats()!.total_feedback }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Créditos emitidos</div>
            <div class="stat-value">{{ stats()!.total_credits_issued | number }}</div>
          </div>
        </div>
      }

      <!-- TAB: Tenants -->
      @if (activeTab() === 'tenants') {
        <div class="section-title">Tenants</div>
        <div class="filter-row">
          <button class="filter-btn" [class.active]="tenantFilter() === 'all'" (click)="tenantFilter.set('all')">Todos</button>
          <button class="filter-btn" [class.active]="tenantFilter() === 'pending'" (click)="tenantFilter.set('pending')">
            Pendentes @if (pendingCount() > 0) { ({{ pendingCount() }}) }
          </button>
        </div>
        @if (tenantsLoading()) {
          <div class="text-muted mono" style="font-size:12px">Carregando...</div>
        } @else {
          <table>
            <thead>
              <tr>
                <th>Clínica</th>
                <th>Módulo</th>
                <th>Usuários</th>
                <th>Saldo</th>
                <th>Última compra</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              @for (t of filteredTenants(); track t.id) {
                <tr (click)="toggleExpand(t)" style="cursor:pointer">
                  <td>
                    <div style="font-weight:600">{{ t.name }}</div>
                    <div class="mono text-muted" style="font-size:10px">{{ t.created_at | date:'dd/MM/yyyy' }}</div>
                  </td>
                  <td><span class="mono" style="font-size:11px">{{ t.module || t.type }}</span></td>
                  <td>{{ t.user_count }}</td>
                  <td>
                    <span [style.color]="t.balance > 0 ? '#10b981' : '#ffb4ab'">
                      {{ t.balance | number }} cr
                    </span>
                  </td>
                  <td class="mono text-muted" style="font-size:11px">
                    {{ t.last_purchase_at ? (t.last_purchase_at | date:'dd/MM/yy HH:mm') : '—' }}
                  </td>
                  <td>
                    <span class="badge" [class.badge-active]="t.active" [class.badge-inactive]="!t.active">
                      {{ t.active ? 'Ativo' : 'Inativo' }}
                    </span>
                  </td>
                  <td (click)="$event.stopPropagation()">
                    @if (t.active) {
                      <button class="btn btn-sm-red" (click)="toggleTenant(t)">Desativar</button>
                    } @else {
                      <button class="btn btn-sm-green" (click)="toggleTenant(t)">Ativar</button>
                    }
                  </td>
                </tr>
                @if (t._expanded) {
                  <tr>
                    <td colspan="7" style="padding:0;background:#0a1120">
                      <div style="padding:1rem 1rem 1rem 2.5rem">
                        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#6e6d80;margin-bottom:0.625rem">
                          Usuários do tenant
                        </div>
                        @if (!t._users) {
                          <div class="mono text-muted" style="font-size:12px">Carregando usuários...</div>
                        } @else if (t._users.length === 0) {
                          <div class="mono text-muted" style="font-size:12px">Nenhum usuário</div>
                        } @else {
                          @for (u of t._users; track u.id) {
                            <div class="user-row">
                              <span style="flex:1;font-size:12px">{{ u.email }}</span>
                              <span class="mono text-muted" style="font-size:10px;min-width:80px">{{ u.role }}</span>
                              <span class="mono text-muted" style="font-size:10px;min-width:100px">{{ u.specialty || '—' }}</span>
                              <span class="badge" style="min-width:50px;text-align:center"
                                [class.badge-active]="u.active" [class.badge-inactive]="!u.active">
                                {{ u.active ? 'Ativo' : 'Inativo' }}
                              </span>
                              <button class="btn" style="font-size:10px;padding:2px 10px"
                                [class.btn-sm-red]="u.active" [class.btn-sm-green]="!u.active"
                                (click)="toggleUser(t, u)">
                                {{ u.active ? 'Desativar' : 'Ativar' }}
                              </button>
                            </div>
                          }
                        }
                      </div>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        }
      }

      <!-- TAB: Errors -->
      @if (activeTab() === 'errors') {
        <div class="section-title">Log de Erros</div>
        @if (errorsLoading()) {
          <div class="text-muted mono" style="font-size:12px">Carregando...</div>
        } @else {
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Tenant</th>
                <th>Usuário</th>
                <th>Método</th>
                <th>URL</th>
                <th>Status</th>
                <th>Mensagem</th>
              </tr>
            </thead>
            <tbody>
              @for (e of errors(); track e.id) {
                <tr>
                  <td class="mono text-muted" style="font-size:11px;white-space:nowrap">{{ e.created_at | date:'dd/MM HH:mm' }}</td>
                  <td style="font-size:12px">{{ e.tenant_name || '—' }}</td>
                  <td class="mono" style="font-size:11px">{{ e.user_email || '—' }}</td>
                  <td><span class="mono badge" style="font-size:10px;background:rgba(192,193,255,0.08);color:#c0c1ff">{{ e.method || '—' }}</span></td>
                  <td class="mono text-muted" style="font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ e.url || '—' }}</td>
                  <td><span class="mono" [style.color]="(e.status_code||0) >= 500 ? '#ffb4ab' : '#fbbf24'">{{ e.status_code || '?' }}</span></td>
                  <td class="err-msg-cell" [title]="e.error_message">{{ e.error_message }}</td>
                </tr>
              }
            </tbody>
          </table>
          <div class="pager">
            <button (click)="errPage.set(errPage() - 1)" [disabled]="errPage() <= 1">‹ Anterior</button>
            <span>Página {{ errPage() }} · {{ errTotal() }} erros</span>
            <button (click)="errPage.set(errPage() + 1)" [disabled]="errPage() * 50 >= errTotal()">Próxima ›</button>
          </div>
        }
      }

      <!-- TAB: Feedback -->
      @if (activeTab() === 'feedback') {
        <div class="section-title">Feedback dos Clientes</div>
        <div class="filter-row">
          <button class="filter-btn" [class.active]="fbFilter() === ''" (click)="fbFilter.set('')">Todos</button>
          <button class="filter-btn" [class.active]="fbFilter() === 'bug'" (click)="fbFilter.set('bug')">Bugs</button>
          <button class="filter-btn" [class.active]="fbFilter() === 'feature'" (click)="fbFilter.set('feature')">Sugestões</button>
        </div>
        @if (feedbackLoading()) {
          <div class="text-muted mono" style="font-size:12px">Carregando...</div>
        } @else {
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Tenant</th>
                <th>Usuário</th>
                <th>Mensagem</th>
                <th>Print</th>
              </tr>
            </thead>
            <tbody>
              @for (f of feedbackItems(); track f.id) {
                <tr>
                  <td class="mono text-muted" style="font-size:11px;white-space:nowrap">{{ f.created_at | date:'dd/MM HH:mm' }}</td>
                  <td><span class="badge" [class.badge-bug]="f.type==='bug'" [class.badge-feature]="f.type==='feature'">{{ f.type === 'bug' ? 'Bug' : 'Sugestão' }}</span></td>
                  <td style="font-size:12px">{{ f.tenant_name || '—' }}</td>
                  <td class="mono" style="font-size:11px">{{ f.user_email || '—' }}</td>
                  <td class="msg-cell" [title]="f.message">{{ f.message }}</td>
                  <td>
                    @if (f.screenshot_url) {
                      <a [href]="f.screenshot_url" target="_blank" class="btn btn-sm-ghost" style="font-size:10px;padding:2px 10px;text-decoration:none">Ver</a>
                    } @else { <span class="text-muted mono" style="font-size:10px">—</span> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <div class="pager">
            <button (click)="fbPage.set(fbPage() - 1)" [disabled]="fbPage() <= 1">‹ Anterior</button>
            <span>Página {{ fbPage() }} · {{ fbTotal() }} itens</span>
            <button (click)="fbPage.set(fbPage() + 1)" [disabled]="fbPage() * 50 >= fbTotal()">Próxima ›</button>
          </div>
        }
      }

      <!-- TAB: Credits -->
      @if (activeTab() === 'credits') {
        <div class="section-title">Adicionar Créditos Manualmente</div>
        <div class="credit-form">
          @if (creditSuccess()) {
            <div class="success-bar">✓ {{ creditSuccess() }}</div>
          }
          @if (creditError()) {
            <div class="error-bar">{{ creditError() }}</div>
          }
          <div class="field">
            <label>Tenant</label>
            <select [(ngModel)]="creditForm.tenant_id">
              <option value="">Selecione o tenant...</option>
              @for (t of tenants(); track t.id) {
                <option [value]="t.id">{{ t.name }} (saldo: {{ t.balance }} cr)</option>
              }
            </select>
          </div>
          <div class="field">
            <label>Créditos (positivo = adicionar, negativo = remover)</label>
            <input type="number" [(ngModel)]="creditForm.amount" placeholder="Ex: 100 ou -50"/>
          </div>
          <div class="field">
            <label>Descrição</label>
            <input type="text" [(ngModel)]="creditForm.description" placeholder="Ex: Compensação por instabilidade"/>
          </div>
          <button class="submit-btn" [disabled]="!creditForm.tenant_id || !creditForm.amount || creditLoading()"
            (click)="addCredits()">
            {{ creditLoading() ? 'Processando...' : 'Confirmar Ajuste' }}
          </button>
        </div>
      }

    </div><!-- /content -->
  </div><!-- /layout -->
</div>
  `
})
export class MasterComponent implements OnInit {
  private http   = inject(HttpClient);
  private auth   = inject(AuthService);
  private router = inject(Router);

  tabs = [
    { id: 'tenants',  label: 'Tenants',    icon: 'business' },
    { id: 'errors',   label: 'Erros',      icon: 'error_outline' },
    { id: 'feedback', label: 'Feedback',   icon: 'forum' },
    { id: 'credits',  label: 'Créditos',   icon: 'toll' },
  ];

  activeTab = signal<string>('tenants');
  tenantFilter = signal<'all' | 'pending'>('all');

  stats         = signal<Stats | null>(null);
  tenants       = signal<Tenant[]>([]);
  tenantsLoading= signal(true);
  errors        = signal<ErrorLog[]>([]);
  errorsLoading = signal(true);
  errPage       = signal(1);
  errTotal      = signal(0);
  feedbackItems = signal<FeedbackItem[]>([]);
  feedbackLoading = signal(true);
  fbPage        = signal(1);
  fbTotal       = signal(0);
  fbFilter      = signal<string>('');
  creditSuccess = signal('');
  creditError   = signal('');
  creditLoading = signal(false);

  pendingCount  = computed(() => this.tenants().filter(t => !t.active).length);
  filteredTenants = computed(() =>
    this.tenantFilter() === 'pending'
      ? this.tenants().filter(t => !t.active)
      : this.tenants()
  );

  creditForm = { tenant_id: '', amount: null as number | null, description: '' };

  private api(path: string) { return `${environment.apiUrl}/master${path}`; }

  constructor() {
    effect(() => { this.errPage(); this.loadErrors(); }, { allowSignalWrites: true });
    effect(() => { this.fbPage(); this.fbFilter(); this.loadFeedback(); }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    this.loadStats();
    this.loadTenants();
  }

  loadStats(): void {
    this.http.get<Stats>(this.api('/stats')).subscribe({ next: s => this.stats.set(s) });
  }

  loadTenants(): void {
    this.tenantsLoading.set(true);
    this.http.get<Tenant[]>(this.api('/tenants')).subscribe({
      next: ts => { this.tenants.set(ts); this.tenantsLoading.set(false); },
      error: () => this.tenantsLoading.set(false)
    });
  }

  loadErrors(): void {
    this.errorsLoading.set(true);
    this.http.get<{ items: ErrorLog[]; total: number }>(
      this.api(`/errors?page=${this.errPage()}&limit=50`)
    ).subscribe({
      next: r => { this.errors.set(r.items); this.errTotal.set(r.total); this.errorsLoading.set(false); },
      error: () => this.errorsLoading.set(false)
    });
  }

  loadFeedback(): void {
    this.feedbackLoading.set(true);
    const f = this.fbFilter() ? `&type=${this.fbFilter()}` : '';
    this.http.get<{ items: FeedbackItem[]; total: number }>(
      this.api(`/feedback?page=${this.fbPage()}&limit=50${f}`)
    ).subscribe({
      next: r => { this.feedbackItems.set(r.items); this.fbTotal.set(r.total); this.feedbackLoading.set(false); },
      error: () => this.feedbackLoading.set(false)
    });
  }

  toggleTenant(t: Tenant): void {
    const action = t.active ? 'deactivate' : 'activate';
    this.http.patch(this.api(`/tenants/${t.id}/${action}`), {}).subscribe({
      next: () => {
        t.active = !t.active;
        this.tenants.set([...this.tenants()]);
        this.loadStats();
      }
    });
  }

  toggleExpand(t: Tenant): void {
    t._expanded = !t._expanded;
    if (t._expanded && !t._users) {
      this.http.get<TenantUser[]>(this.api(`/tenants/${t.id}/users`)).subscribe({
        next: users => { t._users = users; this.tenants.set([...this.tenants()]); }
      });
    } else {
      this.tenants.set([...this.tenants()]);
    }
  }

  toggleUser(t: Tenant, u: TenantUser): void {
    this.http.patch<{ active: boolean }>(
      this.api(`/tenants/${t.id}/users/${u.id}/toggle`), {}
    ).subscribe({ next: res => { u.active = res.active; this.tenants.set([...this.tenants()]); } });
  }

  addCredits(): void {
    if (!this.creditForm.tenant_id || !this.creditForm.amount) return;
    this.creditLoading.set(true);
    this.creditSuccess.set('');
    this.creditError.set('');
    this.http.post<{ ok: boolean; tenant_name: string; amount: number }>(
      this.api('/credits'),
      { tenant_id: this.creditForm.tenant_id, amount: this.creditForm.amount, description: this.creditForm.description }
    ).subscribe({
      next: res => {
        this.creditLoading.set(false);
        this.creditSuccess.set(`${res.amount > 0 ? '+' : ''}${res.amount} créditos adicionados ao tenant "${res.tenant_name}".`);
        this.creditForm = { tenant_id: '', amount: null, description: '' };
        this.loadTenants();
        this.loadStats();
      },
      error: err => {
        this.creditLoading.set(false);
        this.creditError.set(err.error?.error ?? 'Erro ao adicionar créditos.');
      }
    });
  }

  logout(): void { this.auth.logout(); }
}
