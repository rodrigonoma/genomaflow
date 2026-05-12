import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe, DatePipe, SlicePipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AestheticMasterService,
  AestheticTreatmentSuggestion,
  SuggestionRun,
  TREATMENT_CATEGORIES,
  TreatmentInput,
} from '../../services/aesthetic-master.service';

type TabKey = 'queue' | 'history';

@Component({
  selector: 'app-master-treatment-suggestions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DecimalPipe, DatePipe, SlicePipe, NgClass],
  styles: [`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: #0a0a14;
      color: #dae2fd;
      overflow: auto;
      font-family: 'Space Grotesk', sans-serif;
    }

    /* ── Topbar ── */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 2rem;
      height: 56px;
      background: #0d1525;
      border-bottom: 1px solid rgba(192,193,255,0.08);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .brand { display: flex; align-items: center; gap: 0.75rem; }
    .brand-name { font-weight: 700; font-size: 1.05rem; color: #c0c1ff; letter-spacing: -0.02em; }
    .brand-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      background: rgba(192,193,255,0.12);
      color: #c0c1ff;
      padding: 2px 8px;
      border-radius: 3px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .back-btn {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #a09fb2;
      background: none;
      border: none;
      cursor: pointer;
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 0.375rem;
      transition: color 150ms;
    }
    .back-btn:hover { color: #dae2fd; }

    /* ── Layout ── */
    .content { padding: 2rem; max-width: 1400px; margin: 0 auto; }
    .page-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }
    .page-title { font-size: 1.25rem; font-weight: 700; color: #c0c1ff; }
    .page-subtitle { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #6e6d80; margin-top: 2px; }

    /* ── Tabs ── */
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid rgba(192,193,255,0.08);
      margin-bottom: 1.25rem;
    }
    .tab-btn {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      padding: 0.625rem 1.25rem;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: #6e6d80;
      cursor: pointer;
      transition: all 150ms;
      margin-bottom: -1px;
    }
    .tab-btn:hover { color: #c0c1ff; }
    .tab-btn.active { color: #c0c1ff; border-bottom-color: #c0c1ff; }

    /* ── Filters ── */
    .filter-row { display: flex; gap: 0.75rem; margin-bottom: 1.25rem; flex-wrap: wrap; align-items: center; }
    .filter-row select {
      background: #060d1a;
      color: #dae2fd;
      border: 1px solid rgba(192,193,255,0.12);
      border-radius: 5px;
      padding: 0.5rem 0.75rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      outline: none;
      cursor: pointer;
    }
    .filter-row select:focus { border-color: rgba(192,193,255,0.4); }

    /* ── Buttons ── */
    .btn {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      border: none;
      transition: all 150ms;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: #c0c1ff; color: #1000a9; font-weight: 700; }
    .btn-primary:not(:disabled):hover { background: #d4d5ff; }
    .btn-ghost { background: rgba(192,193,255,0.08); color: #c0c1ff; }
    .btn-ghost:not(:disabled):hover { background: rgba(192,193,255,0.15); }
    .btn-green { background: rgba(16,185,129,0.15); color: #10b981; }
    .btn-green:not(:disabled):hover { background: rgba(16,185,129,0.25); }
    .btn-red { background: rgba(255,180,171,0.12); color: #ffb4ab; }
    .btn-red:not(:disabled):hover { background: rgba(255,180,171,0.22); }
    .btn-yellow { background: rgba(250,204,21,0.12); color: #facc15; }
    .btn-yellow:not(:disabled):hover { background: rgba(250,204,21,0.22); }
    .btn-sm { padding: 4px 10px; font-size: 10px; }

    /* ── Table ── */
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #6e6d80;
      padding: 0.5rem 0.75rem;
      text-align: left;
      border-bottom: 1px solid rgba(192,193,255,0.08);
      white-space: nowrap;
    }
    td { padding: 0.75rem; border-bottom: 1px solid rgba(192,193,255,0.05); vertical-align: middle; }
    tr:hover td { background: rgba(192,193,255,0.02); }

    .badge {
      display: inline-block;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 3px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-pending { background: rgba(250,204,21,0.15); color: #facc15; }
    .badge-approved { background: rgba(16,185,129,0.15); color: #10b981; }
    .badge-rejected { background: rgba(255,180,171,0.12); color: #ffb4ab; }
    .badge-superseded { background: rgba(192,193,255,0.10); color: #a09fb2; }
    .badge-ev { background: rgba(192,193,255,0.10); color: #c0c1ff; }

    .category-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      text-transform: uppercase;
      color: #a09fb2;
    }
    .truncate { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cost-range { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #10b981; }
    .text-muted { color: #6e6d80; }
    .mono { font-family: 'JetBrains Mono', monospace; }

    .actions-cell { display: flex; gap: 4px; flex-wrap: nowrap; }

    /* ── Empty / Loading ── */
    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: #6e6d80;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }

    /* ── Alert bars ── */
    .error-bar {
      background: rgba(255,180,171,0.1);
      border: 1px solid rgba(255,180,171,0.2);
      color: #ffb4ab;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      padding: 0.75rem;
      border-radius: 5px;
      margin-bottom: 1rem;
    }
    .field-error {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: #ffb4ab;
      margin-top: 0.25rem;
    }

    /* ── Modal overlay ── */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 1.5rem;
    }
    .modal {
      background: #0b1326;
      border: 1px solid rgba(192,193,255,0.15);
      border-radius: 8px;
      width: 100%;
      max-width: 640px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 8px 40px rgba(0,0,0,0.6);
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid rgba(192,193,255,0.08);
      position: sticky;
      top: 0;
      background: #0b1326;
      z-index: 1;
    }
    .modal-title { font-size: 1rem; font-weight: 700; color: #c0c1ff; }
    .modal-subtitle { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #6e6d80; margin-top: 2px; }
    .modal-close {
      background: none;
      border: none;
      color: #6e6d80;
      cursor: pointer;
      font-size: 1.1rem;
      padding: 0;
      line-height: 1;
      transition: color 150ms;
    }
    .modal-close:hover { color: #ffb4ab; }
    .modal-body { padding: 1.5rem; }
    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.625rem;
      padding: 1rem 1.5rem;
      border-top: 1px solid rgba(192,193,255,0.08);
      position: sticky;
      bottom: 0;
      background: #0b1326;
    }

    /* ── Form fields ── */
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .form-full { grid-column: 1 / -1; }
    .field { margin-bottom: 0; }
    .field label {
      display: block;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #6e6d80;
      margin-bottom: 0.375rem;
    }
    .field input,
    .field select,
    .field textarea {
      width: 100%;
      background: #060d1a;
      color: #dae2fd;
      border: 1px solid rgba(192,193,255,0.12);
      border-radius: 5px;
      padding: 0.625rem 0.75rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      outline: none;
      box-sizing: border-box;
      transition: border-color 150ms;
    }
    .field input:focus, .field select:focus, .field textarea:focus {
      border-color: rgba(192,193,255,0.4);
    }
    .field input.invalid, .field select.invalid, .field textarea.invalid {
      border-color: rgba(255,180,171,0.5);
    }
    .field textarea { resize: vertical; min-height: 80px; }
    .toggle-row {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      font-size: 13px;
      color: #dae2fd;
      cursor: pointer;
      user-select: none;
    }
    .toggle-row input[type="checkbox"] { width: auto; accent-color: #c0c1ff; cursor: pointer; }

    /* ── History run card ── */
    .run-stat { font-family: 'JetBrains Mono', monospace; font-size: 11px; }
    .run-stat-num { font-size: 1rem; font-weight: 700; }
    .run-stat-label { color: #6e6d80; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }

    @media (max-width: 640px) {
      .form-grid { grid-template-columns: 1fr; }
      .content { padding: 1rem; }
      .modal-overlay { padding: 0; align-items: flex-end; }
      .modal { max-width: none; max-height: 95vh; border-radius: 12px 12px 0 0; }
    }
  `],
  template: `
    <!-- Topbar -->
    <div class="topbar">
      <div class="brand">
        <span class="brand-name">GenomaFlow</span>
        <span class="brand-badge">Master Panel</span>
      </div>
      <a class="back-btn" routerLink="/master">
        ← Voltar ao painel
      </a>
    </div>

    <div class="content">
      <!-- Page header -->
      <div class="page-header">
        <div>
          <div class="page-title">Sugestões IA — Tratamentos Estéticos</div>
          <div class="page-subtitle">Fila de revisão de tratamentos gerados automaticamente pela IA</div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        <button class="tab-btn" [class.active]="tab() === 'queue'" (click)="setTab('queue')">
          Fila de revisão
        </button>
        <button class="tab-btn" [class.active]="tab() === 'history'" (click)="setTab('history')">
          Histórico de execuções
        </button>
      </div>

      <!-- Error -->
      @if (errorMsg()) {
        <div class="error-bar">{{ errorMsg() }}</div>
      }

      <!-- ── TAB: Queue ── -->
      @if (tab() === 'queue') {
        <!-- Filter row -->
        <div class="filter-row">
          <select [value]="filterStatus()" (change)="onStatusChange($event)">
            <option value="pending_review">Aguardando revisão</option>
            <option value="approved">Aprovados</option>
            <option value="rejected">Rejeitados</option>
            <option value="superseded">Vinculados a existente</option>
            <option value="">Todos</option>
          </select>
          <span class="mono text-muted" style="font-size:11px; margin-left:auto">
            {{ suggestions().length }} sugestão{{ suggestions().length !== 1 ? 'ões' : '' }}
          </span>
        </div>

        @if (loading()) {
          <div class="empty-state">Carregando...</div>
        } @else if (suggestions().length === 0) {
          <div class="empty-state">Nenhuma sugestão encontrada.</div>
        } @else {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Categoria</th>
                  <th>Run de origem</th>
                  <th>Gerado em</th>
                  <th>Evidência</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                @for (s of suggestions(); track s.id) {
                  <tr>
                    <td style="font-weight:600; max-width:200px">
                      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" [title]="s.name">{{ s.name }}</div>
                    </td>
                    <td><span class="category-label">{{ formatCategory(s.category) }}</span></td>
                    <td>
                      <span class="mono text-muted" style="font-size:10px">{{ s.source_run_id | slice:0:8 }}…</span>
                    </td>
                    <td class="mono text-muted" style="font-size:11px; white-space:nowrap">
                      {{ s.generated_at | date:'dd/MM/yy HH:mm' }}
                    </td>
                    <td>
                      @if (s.evidence_level) {
                        <span class="badge badge-ev">{{ s.evidence_level }}</span>
                      } @else {
                        <span class="text-muted mono" style="font-size:11px">—</span>
                      }
                    </td>
                    <td>
                      <span class="badge" [ngClass]="statusBadgeClass(s.status)">
                        {{ statusLabel(s.status) }}
                      </span>
                    </td>
                    <td>
                      @if (s.status === 'pending_review') {
                        <div class="actions-cell">
                          <button
                            class="btn btn-sm btn-green"
                            [disabled]="actioning() === s.id"
                            (click)="openApprove(s)">
                            Aprovar
                          </button>
                          <button
                            class="btn btn-sm btn-red"
                            [disabled]="actioning() === s.id"
                            (click)="openReject(s)">
                            Rejeitar
                          </button>
                          <button
                            class="btn btn-sm btn-yellow"
                            [disabled]="actioning() === s.id"
                            (click)="openSupersede(s)">
                            Vincular
                          </button>
                        </div>
                      } @else {
                        <span class="mono text-muted" style="font-size:10px">
                          @if (s.reviewed_at) {
                            {{ s.reviewed_at | date:'dd/MM/yy' }}
                          }
                          @if (s.reviewed_by_email) {
                            · {{ s.reviewed_by_email }}
                          }
                        </span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }

      <!-- ── TAB: History ── -->
      @if (tab() === 'history') {
        @if (loading()) {
          <div class="empty-state">Carregando...</div>
        } @else if (runs().length === 0) {
          <div class="empty-state">Nenhuma execução encontrada.</div>
        } @else {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Iniciado em</th>
                  <th>Modelo</th>
                  <th>Total</th>
                  <th>Pendentes</th>
                  <th>Aprovados</th>
                  <th>Rejeitados</th>
                  <th>Vinculados</th>
                </tr>
              </thead>
              <tbody>
                @for (r of runs(); track r.source_run_id) {
                  <tr>
                    <td class="mono" style="font-size:11px; color:#c0c1ff">{{ r.source_run_id | slice:0:12 }}…</td>
                    <td class="mono text-muted" style="font-size:11px; white-space:nowrap">
                      {{ r.started_at | date:'dd/MM/yy HH:mm' }}
                    </td>
                    <td class="mono text-muted" style="font-size:11px">{{ r.generation_model || '—' }}</td>
                    <td class="mono" style="font-size:13px; font-weight:600; text-align:center">{{ r.total }}</td>
                    <td style="text-align:center">
                      <span class="badge badge-pending" style="font-size:10px">{{ r.pending }}</span>
                    </td>
                    <td style="text-align:center">
                      <span class="badge badge-approved" style="font-size:10px">{{ r.approved }}</span>
                    </td>
                    <td style="text-align:center">
                      <span class="badge badge-rejected" style="font-size:10px">{{ r.rejected }}</span>
                    </td>
                    <td style="text-align:center">
                      <span class="badge badge-superseded" style="font-size:10px">{{ r.superseded }}</span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </div>

    <!-- ── Modal: Approve ── -->
    @if (approveModal()) {
      <div class="modal-overlay" (click)="onOverlayClick($event, 'approve')">
        <div class="modal">
          <div class="modal-header">
            <div>
              <div class="modal-title">Aprovar e adicionar ao catálogo</div>
              <div class="modal-subtitle">Revise os campos antes de publicar</div>
            </div>
            <button class="modal-close" (click)="closeApprove()" title="Fechar">✕</button>
          </div>
          <div class="modal-body">
            @if (approveError()) {
              <div class="error-bar">{{ approveError() }}</div>
            }
            <div class="form-grid">
              <!-- Nome -->
              <div class="field form-full">
                <label>Nome *</label>
                <input type="text" [(ngModel)]="approveForm.name" maxlength="120"/>
              </div>
              <!-- Categoria -->
              <div class="field">
                <label>Categoria *</label>
                <select [(ngModel)]="approveForm.category">
                  <option value="">Selecione...</option>
                  @for (cat of categories; track cat) {
                    <option [value]="cat">{{ formatCategory(cat) }}</option>
                  }
                </select>
              </div>
              <!-- Evidência -->
              <div class="field">
                <label>Nível de evidência</label>
                <select [(ngModel)]="approveForm.evidence_level">
                  <option value="">Não informado</option>
                  <option value="A">A — Forte</option>
                  <option value="B">B — Moderado</option>
                  <option value="C">C — Limitado</option>
                  <option value="D">D — Muito limitado</option>
                </select>
              </div>
              <!-- Custo min -->
              <div class="field">
                <label>Custo mín (R$)</label>
                <input type="number" [(ngModel)]="approveForm.cost_min" min="0"/>
              </div>
              <!-- Custo max -->
              <div class="field">
                <label>Custo máx (R$)</label>
                <input type="number" [(ngModel)]="approveForm.cost_max" min="0"/>
              </div>
              <!-- Requer médico -->
              <div class="field form-full">
                <label class="toggle-row">
                  <input type="checkbox" [(ngModel)]="approveForm.requires_medico"/>
                  Requer médico
                </label>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" (click)="closeApprove()" [disabled]="actioning() != null">Cancelar</button>
            <button
              class="btn btn-primary"
              (click)="submitApprove()"
              [disabled]="actioning() != null || !approveFormValid()">
              {{ actioning() != null ? 'Aprovando...' : 'Aprovar e adicionar ao catálogo' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ── Modal: Reject ── -->
    @if (rejectModal()) {
      <div class="modal-overlay" (click)="onOverlayClick($event, 'reject')">
        <div class="modal">
          <div class="modal-header">
            <div>
              <div class="modal-title">Rejeitar sugestão</div>
              <div class="modal-subtitle" style="max-width:380px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
                {{ rejectTarget()?.name }}
              </div>
            </div>
            <button class="modal-close" (click)="closeReject()" title="Fechar">✕</button>
          </div>
          <div class="modal-body">
            @if (rejectError()) {
              <div class="error-bar">{{ rejectError() }}</div>
            }
            <div class="field">
              <label>Motivo da rejeição *</label>
              <textarea
                [(ngModel)]="rejectReason"
                rows="4"
                [class.invalid]="rejectSubmitAttempted() && !rejectReason.trim()"
                placeholder="Descreva por que esta sugestão não deve ser adicionada ao catálogo...">
              </textarea>
              @if (rejectSubmitAttempted() && !rejectReason.trim()) {
                <div class="field-error">O motivo é obrigatório.</div>
              }
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" (click)="closeReject()" [disabled]="actioning() != null">Cancelar</button>
            <button
              class="btn btn-red"
              (click)="submitReject()"
              [disabled]="actioning() != null">
              {{ actioning() != null ? 'Rejeitando...' : 'Confirmar rejeição' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ── Modal: Supersede ── -->
    @if (supersedeModal()) {
      <div class="modal-overlay" (click)="onOverlayClick($event, 'supersede')">
        <div class="modal">
          <div class="modal-header">
            <div>
              <div class="modal-title">Vincular a tratamento existente</div>
              <div class="modal-subtitle">Esta sugestão já existe no catálogo com outro ID</div>
            </div>
            <button class="modal-close" (click)="closeSupersede()" title="Fechar">✕</button>
          </div>
          <div class="modal-body">
            @if (supersedeError()) {
              <div class="error-bar">{{ supersedeError() }}</div>
            }
            <div class="field">
              <label>ID do tratamento existente *</label>
              <input
                type="text"
                [(ngModel)]="supersedeId"
                [class.invalid]="supersedeSubmitAttempted() && !supersedeId.trim()"
                placeholder="UUID do tratamento no catálogo"/>
              @if (supersedeSubmitAttempted() && !supersedeId.trim()) {
                <div class="field-error">O ID do tratamento existente é obrigatório.</div>
              }
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" (click)="closeSupersede()" [disabled]="actioning() != null">Cancelar</button>
            <button
              class="btn btn-yellow"
              (click)="submitSupersede()"
              [disabled]="actioning() != null">
              {{ actioning() != null ? 'Vinculando...' : 'Confirmar vínculo' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class MasterTreatmentSuggestionsComponent implements OnInit {
  private svc = inject(AestheticMasterService);

  readonly categories = TREATMENT_CATEGORIES;

  // ── Core state ────────────────────────────────────────────────────────────
  suggestions = signal<AestheticTreatmentSuggestion[]>([]);
  runs = signal<SuggestionRun[]>([]);
  loading = signal(false);
  errorMsg = signal<string | null>(null);
  tab = signal<TabKey>('queue');
  filterStatus = signal('pending_review');
  actioning = signal<string | null>(null);

  // ── Approve modal ─────────────────────────────────────────────────────────
  approveModal = signal(false);
  approveTarget = signal<AestheticTreatmentSuggestion | null>(null);
  approveError = signal<string | null>(null);
  approveForm: {
    name: string;
    category: string;
    evidence_level: string;
    cost_min: number | null;
    cost_max: number | null;
    requires_medico: boolean;
  } = this.emptyApproveForm();

  // ── Reject modal ──────────────────────────────────────────────────────────
  rejectModal = signal(false);
  rejectTarget = signal<AestheticTreatmentSuggestion | null>(null);
  rejectReason = '';
  rejectError = signal<string | null>(null);
  rejectSubmitAttempted = signal(false);

  // ── Supersede modal ───────────────────────────────────────────────────────
  supersedeModal = signal(false);
  supersedeTarget = signal<AestheticTreatmentSuggestion | null>(null);
  supersedeId = '';
  supersedeError = signal<string | null>(null);
  supersedeSubmitAttempted = signal(false);

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.loadQueue();
  }

  // ── Tab navigation ────────────────────────────────────────────────────────
  setTab(t: TabKey): void {
    this.tab.set(t);
    this.errorMsg.set(null);
    if (t === 'queue') {
      this.loadQueue();
    } else {
      this.loadRuns();
    }
  }

  onStatusChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.filterStatus.set(val);
    this.loadQueue();
  }

  // ── Data loading ──────────────────────────────────────────────────────────
  loadQueue(): void {
    this.loading.set(true);
    this.errorMsg.set(null);
    const status = this.filterStatus();
    this.svc.listSuggestions({ status: status || undefined }).subscribe({
      next: (res) => {
        this.suggestions.set(res.items);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err.error?.error || 'Erro ao carregar sugestões');
        this.loading.set(false);
      },
    });
  }

  loadRuns(): void {
    this.loading.set(true);
    this.errorMsg.set(null);
    this.svc.listRuns().subscribe({
      next: (res) => {
        this.runs.set(res.items);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err.error?.error || 'Erro ao carregar execuções');
        this.loading.set(false);
      },
    });
  }

  // ── Approve ───────────────────────────────────────────────────────────────
  openApprove(s: AestheticTreatmentSuggestion): void {
    this.approveTarget.set(s);
    this.approveForm = {
      name: s.name,
      category: s.category,
      evidence_level: s.evidence_level ?? '',
      cost_min: s.cost_estimate_brl_min,
      cost_max: s.cost_estimate_brl_max,
      requires_medico: false,
    };
    this.approveError.set(null);
    this.approveModal.set(true);
  }

  closeApprove(): void {
    this.approveModal.set(false);
    this.approveTarget.set(null);
    this.approveError.set(null);
    this.approveForm = this.emptyApproveForm();
  }

  approveFormValid(): boolean {
    return !!(this.approveForm.name?.trim() && this.approveForm.category);
  }

  submitApprove(): void {
    if (!this.approveFormValid()) {
      this.approveError.set('Nome e categoria são obrigatórios.');
      return;
    }
    const target = this.approveTarget();
    if (!target) return;

    this.actioning.set(target.id);
    this.approveError.set(null);

    const overrides: Partial<TreatmentInput> = {
      name: this.approveForm.name.trim(),
      category: this.approveForm.category,
      evidence_level: (this.approveForm.evidence_level as 'A' | 'B' | 'C' | 'D' | null) || null,
      cost_estimate_brl_min: this.approveForm.cost_min ?? null,
      cost_estimate_brl_max: this.approveForm.cost_max ?? null,
      requires_medico: this.approveForm.requires_medico,
    };

    this.svc.approveSuggestion(target.id, overrides).subscribe({
      next: () => {
        this.actioning.set(null);
        this.closeApprove();
        this.loadQueue();
      },
      error: (err) => {
        this.actioning.set(null);
        this.approveError.set(err.error?.error || 'Erro ao aprovar sugestão');
      },
    });
  }

  // ── Reject ────────────────────────────────────────────────────────────────
  openReject(s: AestheticTreatmentSuggestion): void {
    this.rejectTarget.set(s);
    this.rejectReason = '';
    this.rejectSubmitAttempted.set(false);
    this.rejectError.set(null);
    this.rejectModal.set(true);
  }

  closeReject(): void {
    this.rejectModal.set(false);
    this.rejectTarget.set(null);
    this.rejectReason = '';
    this.rejectSubmitAttempted.set(false);
    this.rejectError.set(null);
  }

  submitReject(): void {
    this.rejectSubmitAttempted.set(true);
    if (!this.rejectReason.trim()) return;

    const target = this.rejectTarget();
    if (!target) return;

    this.actioning.set(target.id);
    this.rejectError.set(null);

    this.svc.rejectSuggestion(target.id, this.rejectReason.trim()).subscribe({
      next: () => {
        this.actioning.set(null);
        this.closeReject();
        this.loadQueue();
      },
      error: (err) => {
        this.actioning.set(null);
        this.rejectError.set(err.error?.error || 'Erro ao rejeitar sugestão');
      },
    });
  }

  // ── Supersede ─────────────────────────────────────────────────────────────
  openSupersede(s: AestheticTreatmentSuggestion): void {
    this.supersedeTarget.set(s);
    this.supersedeId = '';
    this.supersedeSubmitAttempted.set(false);
    this.supersedeError.set(null);
    this.supersedeModal.set(true);
  }

  closeSupersede(): void {
    this.supersedeModal.set(false);
    this.supersedeTarget.set(null);
    this.supersedeId = '';
    this.supersedeSubmitAttempted.set(false);
    this.supersedeError.set(null);
  }

  submitSupersede(): void {
    this.supersedeSubmitAttempted.set(true);
    if (!this.supersedeId.trim()) return;

    const target = this.supersedeTarget();
    if (!target) return;

    this.actioning.set(target.id);
    this.supersedeError.set(null);

    this.svc.supersedeSuggestion(target.id, this.supersedeId.trim()).subscribe({
      next: () => {
        this.actioning.set(null);
        this.closeSupersede();
        this.loadQueue();
      },
      error: (err) => {
        this.actioning.set(null);
        this.supersedeError.set(err.error?.error || 'Erro ao vincular sugestão');
      },
    });
  }

  // ── Overlay click handler ─────────────────────────────────────────────────
  onOverlayClick(event: MouseEvent, modal: 'approve' | 'reject' | 'supersede'): void {
    if (!(event.target as HTMLElement).classList.contains('modal-overlay')) return;
    if (modal === 'approve') this.closeApprove();
    else if (modal === 'reject') this.closeReject();
    else this.closeSupersede();
  }

  // ── Display helpers ───────────────────────────────────────────────────────
  formatCategory(cat: string): string {
    return cat
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  statusLabel(status: AestheticTreatmentSuggestion['status']): string {
    const map: Record<string, string> = {
      pending_review: 'Pendente',
      approved: 'Aprovado',
      rejected: 'Rejeitado',
      superseded: 'Vinculado',
    };
    return map[status] ?? status;
  }

  statusBadgeClass(status: AestheticTreatmentSuggestion['status']): string {
    const map: Record<string, string> = {
      pending_review: 'badge-pending',
      approved: 'badge-approved',
      rejected: 'badge-rejected',
      superseded: 'badge-superseded',
    };
    return map[status] ?? '';
  }

  // ── Private helpers ───────────────────────────────────────────────────────
  private emptyApproveForm() {
    return {
      name: '',
      category: '',
      evidence_level: '',
      cost_min: null as number | null,
      cost_max: null as number | null,
      requires_medico: false,
    };
  }
}
