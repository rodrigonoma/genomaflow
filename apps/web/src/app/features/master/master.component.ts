import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe, JsonPipe } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { environment } from '../../../environments/environment';

interface Tenant {
  id: string; name: string; type: string; module: string; plan: string;
  active: boolean; created_at: string;
  user_count: number; balance: number;
  last_purchase_at: string | null; specialties: string[];
  _expanded?: boolean; _users?: TenantUser[]; _exams?: TenantExam[];
}
interface TenantExam {
  id: string; status: string; file_path: string; created_at: string;
  patient_name: string; species: string;
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
  imports: [FormsModule, DatePipe, DecimalPipe, JsonPipe],
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
    .badge-analyzing { background:rgba(251,191,36,0.15); color:#fbbf24; }
    .badge-done { background:rgba(16,185,129,0.15); color:#10b981; }
    .badge-error { background:rgba(255,180,171,0.12); color:#ffb4ab; }
    .badge-pending { background:rgba(192,193,255,0.1); color:#a09fb2; }
    .exam-row { display:flex; align-items:center; gap:1rem; padding:0.375rem 0;
      font-size:12px; border-bottom:1px solid rgba(192,193,255,0.04); }
    .exam-row:last-child { border-bottom:none; }
    .err-msg-cell { max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      font-family:'JetBrains Mono',monospace; font-size:11px; color:#ffb4ab; }
    .msg-cell { max-width:400px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    @media(max-width:900px) {
      .stats-row { grid-template-columns:1fr 1fr; }
      .sidebar { display:none; }
    }

    /* Modais inline (Comunicados detail + conversation viewer) */
    .modal-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000;
      padding: 1.5rem;
    }
    .modal {
      background: #0b1326;
      border: 1px solid rgba(192,193,255,0.15);
      border-radius: 8px;
      padding: 1.25rem;
      width: 100%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    @media (max-width: 639px) {
      .modal-overlay { padding: 0; align-items: stretch; }
      .modal {
        max-width: none !important;
        max-height: none !important;
        height: 100vh !important;
        border-radius: 0;
        border: none;
        padding: 1rem;
      }
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
                        <!-- Exams section -->
                        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#6e6d80;margin:1rem 0 0.625rem">
                          Exames
                          @if (!t._exams) {
                            <button class="btn btn-sm-ghost" style="font-size:9px;padding:1px 8px;margin-left:0.5rem;text-transform:none" (click)="loadExams(t)">carregar</button>
                          }
                        </div>
                        @if (t._exams) {
                          @if (t._exams.length === 0) {
                            <div class="mono text-muted" style="font-size:12px">Nenhum exame</div>
                          } @else {
                            @for (ex of t._exams; track ex.id) {
                              <div class="exam-row">
                                <span style="flex:1;font-size:12px">{{ ex.patient_name }}</span>
                                <span class="mono text-muted" style="font-size:10px;min-width:80px">{{ ex.species || '—' }}</span>
                                <span class="mono text-muted" style="font-size:10px;min-width:110px">{{ ex.created_at | date:'dd/MM/yy HH:mm' }}</span>
                                <span class="badge" style="min-width:70px;text-align:center"
                                  [class.badge-analyzing]="ex.status==='analyzing'"
                                  [class.badge-done]="ex.status==='done'"
                                  [class.badge-error]="ex.status==='error'"
                                  [class.badge-pending]="ex.status==='pending'">
                                  {{ ex.status }}
                                </span>
                                @if (ex.status === 'analyzing' || ex.status === 'pending') {
                                  <button class="btn btn-sm-red" style="font-size:9px;padding:2px 8px" (click)="resetExam(t, ex)">Reset</button>
                                } @else {
                                  <span style="width:58px"></span>
                                }
                              </div>
                            }
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

      @if (activeTab() === 'help') {
        <div class="section-title">Perguntas do Copilot (últimos 30 dias)</div>
        @if (helpAnalytics(); as ha) {
          <h3 style="font-size:0.8rem;color:#a09fb2;margin:1rem 0 0.5rem;text-transform:uppercase;letter-spacing:0.05em">Top rotas (possíveis problemas de UX)</h3>
          @if (ha.top_routes.length === 0) {
            <div class="text-muted mono" style="font-size:12px">Nenhuma pergunta ainda.</div>
          } @else {
            <table>
              <thead>
                <tr><th>Rota</th><th>Perguntas</th><th>Latência média</th><th>Não ajudou</th></tr>
              </thead>
              <tbody>
                @for (r of ha.top_routes; track r.route) {
                  <tr>
                    <td class="mono" style="font-size:11px">{{ r.route }}</td>
                    <td>{{ r.n }}</td>
                    <td class="mono text-muted" style="font-size:11px">{{ r.avg_latency_ms }}ms</td>
                    <td [style.color]="r.unhelpful_count > 0 ? '#ffb4ab' : '#908fa0'">{{ r.unhelpful_count }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }

          <h3 style="font-size:0.8rem;color:#a09fb2;margin:1.5rem 0 0.5rem;text-transform:uppercase;letter-spacing:0.05em">Últimas 100 perguntas</h3>
          @if (ha.recent.length === 0) {
            <div class="text-muted mono" style="font-size:12px">Sem histórico ainda.</div>
          } @else {
            <table>
              <thead>
                <tr><th>Data</th><th>Tenant</th><th>Rota</th><th>Pergunta</th><th>Útil?</th></tr>
              </thead>
              <tbody>
                @for (q of ha.recent; track q.id) {
                  <tr>
                    <td class="mono text-muted" style="font-size:11px;white-space:nowrap">{{ q.created_at | date:'dd/MM HH:mm' }}</td>
                    <td style="font-size:12px">{{ q.tenant_name || '—' }}</td>
                    <td class="mono text-muted" style="font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ q.route }}</td>
                    <td class="msg-cell" [title]="q.question">{{ q.question }}</td>
                    <td>
                      @if (q.was_helpful === true) { <span style="color:#10b981">✓</span> }
                      @else if (q.was_helpful === false) { <span style="color:#ffb4ab">✗</span> }
                      @else { <span class="text-muted">—</span> }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        } @else if (helpAnalyticsLoading()) {
          <div class="text-muted mono" style="font-size:12px">Carregando...</div>
        }
      }

      @if (activeTab() === 'audit') {
        <div class="section-title">Auditoria — quem fez o quê</div>
        <p style="color:#908fa0;font-size:12px;margin:0 0 1rem">
          Todas as mutações em agendamentos, pacientes, exames e receitas — UI manual e Copilot.
          Filtros aplicam imediatamente.
        </p>

        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;align-items:center;">
          <select [value]="auditFilterValue('entity_type')"
                  (change)="setAuditFilter('entity_type', $any($event.target).value)"
                  style="background:#0b1326;color:#dae2fd;border:1px solid #2c2c44;padding:0.375rem 0.5rem;border-radius:4px;font-size:12px;">
            <option value="">Todas as tabelas</option>
            <option value="appointments">Agendamentos</option>
            <option value="subjects">Pacientes</option>
            <option value="prescriptions">Receitas</option>
            <option value="exams">Exames</option>
          </select>
          <select [value]="auditFilterValue('actor_channel')"
                  (change)="setAuditFilter('actor_channel', $any($event.target).value)"
                  style="background:#0b1326;color:#dae2fd;border:1px solid #2c2c44;padding:0.375rem 0.5rem;border-radius:4px;font-size:12px;">
            <option value="">Todos os canais</option>
            <option value="ui">UI (manual)</option>
            <option value="copilot">Copilot</option>
            <option value="system">Sistema</option>
            <option value="worker">Worker</option>
          </select>
          <select [value]="auditFilterValue('action')"
                  (change)="setAuditFilter('action', $any($event.target).value)"
                  style="background:#0b1326;color:#dae2fd;border:1px solid #2c2c44;padding:0.375rem 0.5rem;border-radius:4px;font-size:12px;">
            <option value="">Todas ações</option>
            <option value="insert">Criação</option>
            <option value="update">Edição</option>
            <option value="delete">Exclusão</option>
          </select>
          <button (click)="loadAudit()"
                  style="background:#1a2540;color:#dae2fd;border:1px solid #2c2c44;padding:0.375rem 0.75rem;border-radius:4px;font-size:12px;cursor:pointer;">
            ⟳ Recarregar
          </button>
        </div>

        @if (auditLoading()) {
          <div class="text-muted mono" style="font-size:12px">Carregando...</div>
        } @else if (auditEntries().length === 0) {
          <div class="text-muted mono" style="font-size:12px">Sem registros de auditoria pra esses filtros.</div>
        } @else {
          <table>
            <thead>
              <tr>
                <th>Data/hora</th><th>Tenant</th><th>Quem</th><th>Canal</th>
                <th>Tabela</th><th>Ação</th><th>Campos alterados</th><th></th>
              </tr>
            </thead>
            <tbody>
              @for (a of auditEntries(); track a.id) {
                <tr>
                  <td class="mono text-muted" style="font-size:11px;white-space:nowrap">{{ formatDateTime(a.created_at) }}</td>
                  <td style="font-size:12px">{{ a.tenant_name || '—' }}</td>
                  <td style="font-size:12px">{{ a.actor_email || '(sistema)' }}</td>
                  <td>
                    <span class="mono" style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;padding:2px 6px;border-radius:3px"
                          [style.background]="a.actor_channel === 'copilot' ? 'rgba(192,193,255,0.15)' : a.actor_channel === 'ui' ? 'rgba(96,125,139,0.15)' : 'rgba(255,180,171,0.15)'"
                          [style.color]="a.actor_channel === 'copilot' ? '#c0c1ff' : a.actor_channel === 'ui' ? '#90a4ae' : '#ffb4ab'">
                      {{ a.actor_channel }}
                    </span>
                  </td>
                  <td class="mono" style="font-size:11px">{{ a.entity_type }}</td>
                  <td>
                    <span class="mono" style="font-size:10px;text-transform:uppercase;padding:2px 6px;border-radius:3px"
                          [style.background]="a.action === 'insert' ? 'rgba(16,185,129,0.15)' : a.action === 'update' ? 'rgba(99,102,241,0.15)' : 'rgba(255,180,171,0.15)'"
                          [style.color]="a.action === 'insert' ? '#10b981' : a.action === 'update' ? '#818cf8' : '#ffb4ab'">
                      {{ a.action }}
                    </span>
                  </td>
                  <td class="mono text-muted" style="font-size:10px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                      [title]="(a.changed_fields || []).join(', ')">
                    {{ a.changed_fields ? a.changed_fields.join(', ') : '—' }}
                  </td>
                  <td>
                    <button (click)="openAuditDetail(a.id)"
                            style="background:transparent;color:#c0c1ff;border:1px solid #2c2c44;padding:2px 8px;border-radius:3px;font-size:10px;cursor:pointer;">
                      Diff
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }

        @if (auditDetail(); as d) {
          <div style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:2rem;"
               (click)="closeAuditDetail()">
            <div style="background:#0b1326;border:1px solid #2c2c44;border-radius:8px;padding:1.5rem;max-width:1000px;width:100%;max-height:80vh;overflow:auto;color:#dae2fd"
                 (click)="$event.stopPropagation()">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
                <h3 style="margin:0;font-size:1rem">{{ d.entity_type }} · {{ d.action }} · {{ formatDateTime(d.created_at) }}</h3>
                <button (click)="closeAuditDetail()" style="background:transparent;color:#dae2fd;border:none;font-size:1.5rem;cursor:pointer">×</button>
              </div>
              <p style="font-size:12px;color:#908fa0;margin:0 0 1rem">
                <strong>Quem:</strong> {{ d.actor_email || '(sistema)' }} ·
                <strong>Canal:</strong> {{ d.actor_channel }} ·
                <strong>Tenant:</strong> {{ d.tenant_name || d.tenant_id }} ·
                <strong>Entity ID:</strong> <span class="mono">{{ d.entity_id }}</span>
              </p>
              @if (d.changed_fields && d.changed_fields.length > 0) {
                <p style="font-size:12px;color:#a09fb2;margin:0 0 0.5rem">
                  <strong>Campos alterados:</strong> {{ d.changed_fields.join(', ') }}
                </p>
              }
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem">
                <div>
                  <h4 style="font-size:11px;color:#908fa0;text-transform:uppercase;margin:0 0 0.5rem">Antes (old_data)</h4>
                  <pre style="background:#060d1a;padding:0.75rem;border-radius:4px;font-size:10px;line-height:1.45;color:#dae2fd;white-space:pre-wrap;overflow-x:auto;max-height:50vh;overflow-y:auto">{{ d.old_data ? (d.old_data | json) : '(novo registro)' }}</pre>
                </div>
                <div>
                  <h4 style="font-size:11px;color:#908fa0;text-transform:uppercase;margin:0 0 0.5rem">Depois (new_data)</h4>
                  <pre style="background:#060d1a;padding:0.75rem;border-radius:4px;font-size:10px;line-height:1.45;color:#dae2fd;white-space:pre-wrap;overflow-x:auto;max-height:50vh;overflow-y:auto">{{ d.new_data ? (d.new_data | json) : '(deletado)' }}</pre>
                </div>
              </div>
            </div>
          </div>
        }
      }

      @if (activeTab() === 'broadcasts') {
        <div class="grid" style="grid-template-columns: 1fr; gap: 1.5rem">
          <!-- Composer -->
          <div class="card">
            <h3>Compor comunicado</h3>
            <div style="display:flex;gap:1rem;margin-bottom:0.75rem;flex-wrap:wrap">
              <select [(ngModel)]="broadcastDraft.segmentKind" style="background:#0a1224;border:1px solid #1f2842;color:#dae2fd;padding:0.5rem;border-radius:4px">
                <option value="all">Todos os tenants</option>
                <option value="module">Por módulo</option>
                <option value="tenant">Tenant específico</option>
              </select>
              @if (broadcastDraft.segmentKind === 'module') {
                <select [(ngModel)]="broadcastDraft.segmentValue" style="background:#0a1224;border:1px solid #1f2842;color:#dae2fd;padding:0.5rem;border-radius:4px">
                  <option value="human">Humano</option>
                  <option value="veterinary">Veterinário</option>
                </select>
              }
              @if (broadcastDraft.segmentKind === 'tenant') {
                <select [(ngModel)]="broadcastDraft.segmentValue" style="background:#0a1224;border:1px solid #1f2842;color:#dae2fd;padding:0.5rem;border-radius:4px;min-width:280px">
                  <option value="">— Escolher tenant —</option>
                  @for (t of tenantOptions(); track t.id) {
                    <option [value]="t.id">{{ t.name }} ({{ t.module }})</option>
                  }
                </select>
              }
            </div>
            <textarea [(ngModel)]="broadcastDraft.body"
                      placeholder="Texto da mensagem (markdown — **negrito**, _itálico_, ## títulos, listas, links)"
                      rows="8"
                      style="width:100%;background:#0a1224;border:1px solid #1f2842;color:#dae2fd;padding:0.75rem;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:0.875rem;resize:vertical"></textarea>
            <div style="margin-top:0.75rem;display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
              <input type="file" #fileInput accept="image/jpeg,image/png,application/pdf" style="display:none" (change)="onBroadcastFilePicked($event)"/>
              <button (click)="fileInput.click()" style="background:#1f2842;color:#c0c1ff;border:none;padding:0.5rem 1rem;border-radius:4px;cursor:pointer">
                📎 Anexar (imagem ou PDF)
              </button>
              @for (a of broadcastDraft.attachments; track $index) {
                <span style="background:#0a1224;border:1px solid #1f2842;padding:0.25rem 0.5rem;border-radius:4px;font-size:11px">
                  {{ a.kind === 'pdf' ? '📄' : '🖼' }} {{ a.filename }}
                  ({{ (a.size_bytes / 1024).toFixed(0) }}KB)
                  <button (click)="removeBroadcastAttachment($index)" style="background:none;border:none;color:#ffb4ab;cursor:pointer;margin-left:0.25rem">×</button>
                </span>
              }
            </div>
            <div style="margin-top:1rem;display:flex;justify-content:space-between;align-items:center">
              <div>
                @if (broadcastError()) { <span style="color:#ffb4ab;font-size:12px">{{ broadcastError() }}</span> }
                @if (broadcastSuccess()) { <span style="color:#7cffaf;font-size:12px">✓ {{ broadcastSuccess() }}</span> }
              </div>
              <button (click)="sendBroadcast()" [disabled]="broadcastSending() || !broadcastDraft.body.trim()"
                      style="background:#494bd6;color:#fff;border:none;padding:0.6rem 1.5rem;border-radius:4px;cursor:pointer;font-weight:600">
                {{ broadcastSending() ? 'Enviando...' : 'Enviar comunicado' }}
              </button>
            </div>
          </div>

          <!-- Histórico de envios -->
          <div class="card">
            <h3>Histórico de envios</h3>
            @if (broadcastHistoryLoading()) {
              <p style="color:#7c7b8f">Carregando...</p>
            } @else if (broadcastHistory().length === 0) {
              <p style="color:#7c7b8f">Nenhum comunicado enviado nos últimos 90 dias.</p>
            } @else {
              <table class="data-table">
                <thead><tr>
                  <th>Quando</th><th>Segmento</th><th>Mensagem</th>
                  <th>Anexos</th><th>Lidos / Enviados</th><th></th>
                </tr></thead>
                <tbody>
                  @for (b of broadcastHistory(); track b.id) {
                    <tr>
                      <td class="mono">{{ b.created_at | date:'dd/MM HH:mm' }}</td>
                      <td>{{ segmentLabel(b.segment_kind, b.segment_value) }}</td>
                      <td style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ b.body }}</td>
                      <td>{{ b.attachment_count > 0 ? b.attachment_count + ' anexo(s)' : '—' }}</td>
                      <td><strong>{{ b.read_count }}</strong> / {{ b.recipient_count }}</td>
                      <td><button (click)="openBroadcastDetail(b.id)" style="background:none;border:none;color:#7c7dff;cursor:pointer">detalhes</button></td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>

          <!-- Inbox de respostas -->
          <div class="card">
            <h3>Caixa de respostas</h3>
            @if (broadcastInboxLoading()) {
              <p style="color:#7c7b8f">Carregando...</p>
            } @else if (broadcastInbox().length === 0) {
              <p style="color:#7c7b8f">Nenhuma conversa ativa.</p>
            } @else {
              <div style="display:flex;flex-direction:column;gap:0.5rem">
                @for (c of broadcastInbox(); track c.conversation_id) {
                  <div (click)="openConversation(c.conversation_id)"
                       style="background:#0a1224;padding:0.75rem;border-radius:4px;cursor:pointer;border-left:3px solid {{ c.unread_count > 0 ? '#ffb74d' : '#1f2842' }}">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                      <strong style="color:#dae2fd">{{ c.tenant_name }}</strong>
                      <span style="font-size:10px;color:#7c7b8f">{{ c.last_message_at | date:'dd/MM HH:mm' }}</span>
                    </div>
                    <div style="font-size:12px;color:#908fa0;margin-top:0.25rem;display:flex;justify-content:space-between">
                      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80%">
                        {{ isMasterMessage(c.last_sender_tenant_id || '') ? '↗ você: ' : '↙ ' }}{{ c.last_message_preview }}
                      </span>
                      @if (c.unread_count > 0) {
                        <span style="background:#494bd6;color:#fff;font-size:10px;padding:1px 6px;border-radius:8px">{{ c.unread_count }}</span>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        </div>

        <!-- Modal: detalhe do broadcast -->
        @if (broadcastDetail(); as bd) {
          <div class="modal-overlay" (click)="closeBroadcastDetail()">
            <div class="modal" (click)="$event.stopPropagation()" style="max-width:900px;max-height:85vh;overflow-y:auto">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
                <h3 style="margin:0">Detalhe do comunicado</h3>
                <button (click)="closeBroadcastDetail()" style="background:none;border:none;color:#7c7b8f;font-size:24px;cursor:pointer">×</button>
              </div>
              <p style="font-size:12px;color:#908fa0;margin:0 0 1rem">
                <strong>Quando:</strong> {{ bd.created_at | date:'dd/MM/yyyy HH:mm' }} ·
                <strong>Por:</strong> {{ bd.sender_email }} ·
                <strong>Segmento:</strong> {{ segmentLabel(bd.segment_kind, bd.segment_value) }}
              </p>
              <pre style="background:#060d1a;padding:0.75rem;border-radius:4px;font-size:12px;color:#dae2fd;white-space:pre-wrap;margin:0 0 1rem">{{ bd.body }}</pre>
              @if (bd.attachments?.length) {
                <h4 style="font-size:11px;color:#908fa0;text-transform:uppercase;margin:1rem 0 0.5rem">Anexos</h4>
                <ul style="font-size:12px;color:#dae2fd;margin:0 0 1rem;padding-left:1rem">
                  @for (a of bd.attachments; track a.id) {
                    <li>{{ a.kind === 'pdf' ? '📄' : '🖼' }} {{ a.filename }} ({{ (a.size_bytes/1024).toFixed(0) }}KB)</li>
                  }
                </ul>
              }
              <h4 style="font-size:11px;color:#908fa0;text-transform:uppercase;margin:1rem 0 0.5rem">
                Lido por {{ readCount(bd.deliveries) }} de {{ bd.deliveries.length }}
              </h4>
              <table class="data-table">
                <thead><tr><th>Tenant</th><th>Módulo</th><th>Entregue</th><th>Leu?</th></tr></thead>
                <tbody>
                  @for (d of bd.deliveries; track d.tenant_id) {
                    <tr>
                      <td>{{ d.tenant_name }}</td>
                      <td>{{ d.module }}</td>
                      <td class="mono">{{ d.delivered_at | date:'dd/MM HH:mm' }}</td>
                      <td>{{ d.read_by_tenant ? '✓' : '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }

        <!-- Modal: conversation viewer -->
        @if (selectedConvId()) {
          <div class="modal-overlay" (click)="closeConversation()">
            <div class="modal" (click)="$event.stopPropagation()" style="max-width:700px;height:80vh;display:flex;flex-direction:column">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
                <h3 style="margin:0">Conversa</h3>
                <button (click)="closeConversation()" style="background:none;border:none;color:#7c7b8f;font-size:24px;cursor:pointer">×</button>
              </div>
              <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:0.5rem;padding:0.5rem">
                @for (m of selectedConvMessages(); track m.id) {
                  <div [style.align-self]="isMasterMessage(m.sender_tenant_id) ? 'flex-end' : 'flex-start'"
                       [style.background]="isMasterMessage(m.sender_tenant_id) ? '#494bd6' : '#171f33'"
                       style="padding:0.6rem 0.875rem;border-radius:8px;max-width:75%">
                    <div style="font-size:13px;color:#dae2fd;white-space:pre-wrap">{{ m.body }}</div>
                    <div style="font-size:10px;color:rgba(255,255,255,0.5);margin-top:0.25rem">
                      {{ isMasterMessage(m.sender_tenant_id) ? 'você' : 'tenant' }} · {{ m.created_at | date:'dd/MM HH:mm' }}
                    </div>
                  </div>
                }
              </div>
              <div style="display:flex;gap:0.5rem;margin-top:1rem">
                <textarea [(ngModel)]="broadcastReplyDraft" rows="3" placeholder="Responder..."
                          style="flex:1;background:#0a1224;border:1px solid #1f2842;color:#dae2fd;padding:0.5rem;border-radius:4px;resize:vertical"></textarea>
                <button (click)="sendBroadcastReply()" [disabled]="broadcastReplySending() || !broadcastReplyDraft.trim()"
                        style="background:#494bd6;color:#fff;border:none;padding:0.5rem 1rem;border-radius:4px;cursor:pointer">
                  {{ broadcastReplySending() ? '...' : 'Enviar' }}
                </button>
              </div>
            </div>
          </div>
        }
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
    { id: 'tenants',     label: 'Tenants',    icon: 'business' },
    { id: 'errors',      label: 'Erros',      icon: 'error_outline' },
    { id: 'feedback',    label: 'Feedback',   icon: 'forum' },
    { id: 'credits',     label: 'Créditos',   icon: 'toll' },
    { id: 'help',        label: 'Ajuda',      icon: 'support_agent' },
    { id: 'audit',       label: 'Auditoria',  icon: 'history' },
    { id: 'broadcasts',  label: 'Comunicados', icon: 'campaign' },
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

  helpAnalytics = signal<{
    top_routes: Array<{route: string; n: number; avg_latency_ms: number; unhelpful_count: number}>;
    recent: Array<{id: string; route: string; component: string|null; user_role: string; question: string; answer_preview: string; was_helpful: boolean|null; created_at: string; tenant_name: string|null; user_email: string|null}>;
  } | null>(null);
  helpAnalyticsLoading = signal(false);

  // Auditoria — todas mutações UI + Copilot + sistema
  auditEntries = signal<Array<{
    id: string; tenant_id: string; entity_type: string; entity_id: string;
    action: 'insert'|'update'|'delete';
    actor_user_id: string|null; actor_channel: string;
    changed_fields: string[]|null; created_at: string;
    tenant_name: string|null; actor_email: string|null;
  }>>([]);
  auditLoading = signal(false);
  auditFilter = signal<{
    entity_type?: string; actor_channel?: string; action?: string; days: number;
  }>({ days: 30 });
  auditDetail = signal<any | null>(null);

  // Comunicados (master broadcasts) — composer + histórico + inbox de respostas
  broadcastDraft = {
    body: '',
    segmentKind: 'all' as 'all' | 'module' | 'tenant',
    segmentValue: '',
    attachments: [] as Array<{ kind: 'image'|'pdf'; filename: string; mime_type: string; data_base64: string; size_bytes: number }>,
  };
  broadcastSending = signal(false);
  broadcastError = signal('');
  broadcastSuccess = signal('');

  broadcastHistory = signal<Array<{
    id: string; body: string; segment_kind: string; segment_value: string|null;
    recipient_count: number; read_count: number; attachment_count: number;
    sender_email: string; created_at: string;
  }>>([]);
  broadcastHistoryLoading = signal(false);

  broadcastInbox = signal<Array<{
    conversation_id: string; tenant_id: string; tenant_name: string; module: string;
    last_message_at: string|null; last_message_preview: string|null;
    last_sender_tenant_id: string|null; unread_count: number;
  }>>([]);
  broadcastInboxLoading = signal(false);

  broadcastDetail = signal<any | null>(null);
  broadcastReplyDraft = '';
  broadcastReplySending = signal(false);

  // Lista de tenants pra dropdown segment=tenant — reusa `tenants()` carregada na tab Tenants
  tenantOptions = computed(() =>
    this.tenants().filter(t => t.active).map(t => ({ id: t.id, name: t.name, module: t.module }))
  );

  private api(path: string) { return `${environment.apiUrl}/master${path}`; }

  constructor() {
    effect(() => { this.errPage(); this.loadErrors(); }, { allowSignalWrites: true });
    effect(() => { this.fbPage(); this.fbFilter(); this.loadFeedback(); }, { allowSignalWrites: true });
    effect(() => {
      if (this.activeTab() !== 'help') return;
      this.helpAnalyticsLoading.set(true);
      this.http.get<any>(this.api('/help-analytics?days=30')).subscribe({
        next: (r) => { this.helpAnalytics.set(r); this.helpAnalyticsLoading.set(false); },
        error: () => this.helpAnalyticsLoading.set(false),
      });
    }, { allowSignalWrites: true });
    effect(() => {
      if (this.activeTab() !== 'audit') return;
      this.loadAudit();
    }, { allowSignalWrites: true });
    // recarrega audit ao mudar filtros
    effect(() => {
      this.auditFilter();
      if (this.activeTab() === 'audit') this.loadAudit();
    }, { allowSignalWrites: true });
    // Comunicados — carrega histórico e inbox ao ativar a tab
    effect(() => {
      if (this.activeTab() !== 'broadcasts') return;
      this.loadBroadcastHistory();
      this.loadBroadcastInbox();
      // garante tenants carregados pro dropdown
      if (this.tenants().length === 0) this.loadTenants();
    }, { allowSignalWrites: true });
  }

  // ── Comunicados (master broadcasts) ──────────────────────────────────────
  loadBroadcastHistory(): void {
    this.broadcastHistoryLoading.set(true);
    this.http.get<any>(this.api('/broadcasts?days=90&limit=50')).subscribe({
      next: (r) => { this.broadcastHistory.set(r.results || []); this.broadcastHistoryLoading.set(false); },
      error: () => this.broadcastHistoryLoading.set(false),
    });
  }

  loadBroadcastInbox(): void {
    this.broadcastInboxLoading.set(true);
    this.http.get<any>(this.api('/conversations')).subscribe({
      next: (r) => { this.broadcastInbox.set(r.results || []); this.broadcastInboxLoading.set(false); },
      error: () => this.broadcastInboxLoading.set(false),
    });
  }

  onBroadcastFilePicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      this.broadcastError.set('Anexo excede 10MB');
      input.value = '';
      return;
    }
    if (this.broadcastDraft.attachments.length >= 5) {
      this.broadcastError.set('Máximo 5 anexos por comunicado');
      input.value = '';
      return;
    }
    const isImage = ['image/jpeg', 'image/png'].includes(file.type);
    const isPdf = file.type === 'application/pdf';
    if (!isImage && !isPdf) {
      this.broadcastError.set('Apenas JPG, PNG ou PDF');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const data_base64 = dataUrl.split(',')[1] || '';
      this.broadcastDraft.attachments.push({
        kind: isImage ? 'image' : 'pdf',
        filename: file.name,
        mime_type: file.type,
        data_base64,
        size_bytes: file.size,
      });
      this.broadcastError.set('');
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  removeBroadcastAttachment(idx: number): void {
    this.broadcastDraft.attachments.splice(idx, 1);
  }

  sendBroadcast(): void {
    const body = this.broadcastDraft.body.trim();
    if (!body) { this.broadcastError.set('Mensagem vazia'); return; }

    const segment: any = { kind: this.broadcastDraft.segmentKind };
    if (this.broadcastDraft.segmentKind === 'module') segment.value = this.broadcastDraft.segmentValue || 'human';
    if (this.broadcastDraft.segmentKind === 'tenant') {
      if (!this.broadcastDraft.segmentValue) { this.broadcastError.set('Escolha um tenant'); return; }
      segment.value = this.broadcastDraft.segmentValue;
    }

    this.broadcastSending.set(true);
    this.broadcastError.set('');
    this.broadcastSuccess.set('');

    const payload: any = { body, segment };
    if (this.broadcastDraft.attachments.length > 0) {
      payload.attachments = this.broadcastDraft.attachments.map(a => ({
        kind: a.kind, filename: a.filename, mime_type: a.mime_type, data_base64: a.data_base64,
      }));
    }

    this.http.post<any>(this.api('/broadcasts'), payload).subscribe({
      next: (r) => {
        this.broadcastSending.set(false);
        this.broadcastSuccess.set(`Enviado pra ${r.recipient_count} de ${r.target_count} tenants`);
        this.broadcastDraft = { body: '', segmentKind: 'all', segmentValue: '', attachments: [] };
        this.loadBroadcastHistory();
      },
      error: (err) => {
        this.broadcastSending.set(false);
        this.broadcastError.set(err.error?.error || 'Falha ao enviar comunicado');
      },
    });
  }

  openBroadcastDetail(id: string): void {
    this.http.get<any>(this.api(`/broadcasts/${id}`)).subscribe({
      next: (r) => this.broadcastDetail.set(r),
      error: () => this.broadcastDetail.set({ error: 'Falha ao carregar detalhe' }),
    });
  }

  closeBroadcastDetail(): void { this.broadcastDetail.set(null); }

  selectedConvId = signal<string | null>(null);
  selectedConvMessages = signal<Array<{ id: string; sender_tenant_id: string; body: string; created_at: string; has_attachment: boolean; }>>([]);

  openConversation(convId: string): void {
    this.selectedConvId.set(convId);
    this.broadcastReplyDraft = '';
    this.http.get<any>(this.api(`/conversations/${convId}/messages`)).subscribe({
      next: (r) => this.selectedConvMessages.set(r.results || []),
    });
  }

  closeConversation(): void {
    this.selectedConvId.set(null);
    this.selectedConvMessages.set([]);
  }

  sendBroadcastReply(): void {
    const body = this.broadcastReplyDraft.trim();
    const convId = this.selectedConvId();
    if (!body || !convId) return;

    this.broadcastReplySending.set(true);
    this.http.post<any>(this.api(`/conversations/${convId}/reply`), { body }).subscribe({
      next: () => {
        this.broadcastReplySending.set(false);
        this.broadcastReplyDraft = '';
        this.openConversation(convId); // recarrega thread
        this.loadBroadcastInbox();
      },
      error: () => { this.broadcastReplySending.set(false); },
    });
  }

  isMasterMessage(senderTenantId: string): boolean {
    return senderTenantId === '00000000-0000-0000-0000-000000000001';
  }

  segmentLabel(kind: string, value: string|null): string {
    if (kind === 'all') return 'Todos os tenants';
    if (kind === 'module') return value === 'veterinary' ? 'Veterinário' : 'Humano';
    if (kind === 'tenant') return `Tenant: ${value?.slice(0,8)}…`;
    return kind;
  }

  readCount(deliveries: Array<{ read_by_tenant: boolean }>): number {
    return deliveries.filter(d => d.read_by_tenant).length;
  }

  loadAudit(): void {
    this.auditLoading.set(true);
    const f = this.auditFilter();
    const params: string[] = [`days=${f.days}`, 'limit=200'];
    if (f.entity_type) params.push(`entity_type=${encodeURIComponent(f.entity_type)}`);
    if (f.actor_channel) params.push(`actor_channel=${encodeURIComponent(f.actor_channel)}`);
    if (f.action) params.push(`action=${encodeURIComponent(f.action)}`);
    this.http.get<any>(this.api(`/audit-log?${params.join('&')}`)).subscribe({
      next: (r) => { this.auditEntries.set(r.results || []); this.auditLoading.set(false); },
      error: () => this.auditLoading.set(false),
    });
  }

  openAuditDetail(id: string): void {
    this.http.get<any>(this.api(`/audit-log/${id}`)).subscribe({
      next: (r) => this.auditDetail.set(r),
      error: () => {},
    });
  }
  closeAuditDetail(): void { this.auditDetail.set(null); }

  formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString('pt-BR');
  }

  setAuditFilter(key: 'entity_type' | 'actor_channel' | 'action' | 'days', value: string | number): void {
    const cur = this.auditFilter();
    const next: any = { ...cur };
    if (value === '' || value === null || value === undefined) delete next[key];
    else next[key] = value;
    this.auditFilter.set(next);
  }
  auditFilterValue(key: 'entity_type' | 'actor_channel' | 'action'): string {
    const f = this.auditFilter() as any;
    return f[key] || '';
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

  loadExams(t: Tenant): void {
    this.http.get<TenantExam[]>(this.api(`/tenants/${t.id}/exams`)).subscribe({
      next: exams => { t._exams = exams; this.tenants.set([...this.tenants()]); }
    });
  }

  resetExam(t: Tenant, ex: TenantExam): void {
    this.http.patch(this.api(`/exams/${ex.id}/reset`), {}).subscribe({
      next: () => { ex.status = 'error'; this.tenants.set([...this.tenants()]); }
    });
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
