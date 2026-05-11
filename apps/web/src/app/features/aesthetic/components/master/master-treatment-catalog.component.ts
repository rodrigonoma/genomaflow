import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AestheticMasterService,
  AestheticTreatment,
  TREATMENT_CATEGORIES,
  TreatmentInput,
} from '../../services/aesthetic-master.service';

@Component({
  selector: 'app-master-treatment-catalog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DecimalPipe],
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
    .content { padding: 2rem; max-width: 1300px; margin: 0 auto; }
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }
    .page-title { font-size: 1.25rem; font-weight: 700; color: #c0c1ff; }
    .page-subtitle { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #6e6d80; margin-top: 2px; }

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
    .btn-primary { background: #c0c1ff; color: #1000a9; font-weight: 700; }
    .btn-primary:hover { background: #d4d5ff; }
    .btn-ghost { background: rgba(192,193,255,0.08); color: #c0c1ff; }
    .btn-ghost:hover { background: rgba(192,193,255,0.15); }
    .btn-red { background: rgba(255,180,171,0.12); color: #ffb4ab; }
    .btn-red:hover { background: rgba(255,180,171,0.22); }

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
    .badge-active { background: rgba(16,185,129,0.15); color: #10b981; }
    .badge-inactive { background: rgba(255,180,171,0.12); color: #ffb4ab; }
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
      max-width: 680px;
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
    .field textarea { resize: vertical; min-height: 64px; }
    .field-hint {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: #6e6d80;
      margin-top: 0.25rem;
    }
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
          <div class="page-title">Catálogo de Tratamentos Estéticos</div>
          <div class="page-subtitle">Tratamentos globais disponíveis para clínicas de estética</div>
        </div>
        <button class="btn btn-primary" (click)="openCreate()">+ Novo tratamento</button>
      </div>

      <!-- Filters -->
      <div class="filter-row">
        <select [(ngModel)]="filterCategory" (ngModelChange)="loadList()">
          <option value="">Todas as categorias</option>
          @for (cat of categories; track cat) {
            <option [value]="cat">{{ formatCategory(cat) }}</option>
          }
        </select>
        <select [(ngModel)]="filterActive" (ngModelChange)="loadList()">
          <option value="all">Todos (ativo/inativo)</option>
          <option value="true">Apenas ativos</option>
          <option value="false">Apenas inativos</option>
        </select>
        <span class="mono text-muted" style="font-size:11px; margin-left:auto">
          {{ treatments().length }} tratamento{{ treatments().length !== 1 ? 's' : '' }}
        </span>
      </div>

      <!-- Error -->
      @if (errorMsg()) {
        <div class="error-bar">{{ errorMsg() }}</div>
      }

      <!-- Table -->
      @if (loading()) {
        <div class="empty-state">Carregando...</div>
      } @else if (treatments().length === 0) {
        <div class="empty-state">Nenhum tratamento encontrado.</div>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Categoria</th>
                <th>Indicações</th>
                <th>Sessões</th>
                <th>Custo estimado (R$)</th>
                <th>Evidência</th>
                <th>Médico?</th>
                <th>Status</th>
                <th>Uso 30d</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              @for (t of treatments(); track t.id) {
                <tr>
                  <td style="font-weight:600; max-width:180px">
                    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ t.name }}</div>
                    @if (t.requires_medico) {
                      <div class="mono text-muted" style="font-size:10px; margin-top:2px">req. médico</div>
                    }
                  </td>
                  <td><span class="category-label">{{ formatCategory(t.category) }}</span></td>
                  <td>
                    <div class="truncate text-muted" style="font-size:12px">
                      {{ t.indications?.join(', ') || '—' }}
                    </div>
                  </td>
                  <td class="mono" style="font-size:12px; text-align:center">
                    @if (t.typical_sessions != null) {
                      {{ t.typical_sessions }}
                      @if (t.interval_days != null) {
                        <span class="text-muted">/{{ t.interval_days }}d</span>
                      }
                    } @else {
                      <span class="text-muted">—</span>
                    }
                  </td>
                  <td>
                    @if (t.cost_estimate_brl_min != null || t.cost_estimate_brl_max != null) {
                      <span class="cost-range">
                        {{ t.cost_estimate_brl_min | number:'1.0-0' }} – {{ t.cost_estimate_brl_max | number:'1.0-0' }}
                      </span>
                    } @else {
                      <span class="text-muted mono" style="font-size:11px">—</span>
                    }
                  </td>
                  <td>
                    @if (t.evidence_level) {
                      <span class="badge badge-ev">{{ t.evidence_level }}</span>
                    } @else {
                      <span class="text-muted mono" style="font-size:11px">—</span>
                    }
                  </td>
                  <td class="mono" style="font-size:12px; text-align:center">
                    {{ t.requires_medico ? 'Sim' : 'Não' }}
                  </td>
                  <td>
                    <span class="badge" [class.badge-active]="t.is_active" [class.badge-inactive]="!t.is_active">
                      {{ t.is_active ? 'Ativo' : 'Inativo' }}
                    </span>
                  </td>
                  <td class="mono text-muted" style="font-size:12px; text-align:center">{{ t.usage_count_30d }}</td>
                  <td>
                    <button class="btn btn-ghost" style="margin-right:4px" (click)="openEdit(t)">Editar</button>
                    <button class="btn btn-red" (click)="deleteOne(t)">Excluir</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    <!-- Modal create / edit -->
    @if (showModal()) {
      <div class="modal-overlay" (click)="onOverlayClick($event)">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">{{ editing() ? 'Editar tratamento' : 'Novo tratamento' }}</span>
            <button class="modal-close" (click)="closeModal()" title="Fechar">✕</button>
          </div>
          <div class="modal-body">
            @if (modalError()) {
              <div class="error-bar" style="margin-bottom:1rem">{{ modalError() }}</div>
            }
            <div class="form-grid">
              <!-- Nome -->
              <div class="field form-full">
                <label>Nome *</label>
                <input type="text" [(ngModel)]="form.name" maxlength="120" placeholder="Ex: Radiofrequência Facial"/>
              </div>

              <!-- Categoria -->
              <div class="field">
                <label>Categoria *</label>
                <select [(ngModel)]="form.category">
                  <option value="">Selecione...</option>
                  @for (cat of categories; track cat) {
                    <option [value]="cat">{{ formatCategory(cat) }}</option>
                  }
                </select>
              </div>

              <!-- Nível de evidência -->
              <div class="field">
                <label>Nível de evidência</label>
                <select [(ngModel)]="form.evidence_level">
                  <option value="">Não informado</option>
                  <option value="A">A — Forte</option>
                  <option value="B">B — Moderado</option>
                  <option value="C">C — Limitado</option>
                  <option value="D">D — Muito limitado</option>
                </select>
              </div>

              <!-- Sessões típicas -->
              <div class="field">
                <label>Sessões típicas</label>
                <input type="number" [(ngModel)]="form.typical_sessions" min="1" max="999" placeholder="Ex: 6"/>
              </div>

              <!-- Intervalo dias -->
              <div class="field">
                <label>Intervalo (dias)</label>
                <input type="number" [(ngModel)]="form.interval_days" min="1" max="365" placeholder="Ex: 7"/>
              </div>

              <!-- Custo min -->
              <div class="field">
                <label>Custo mín (R$)</label>
                <input type="number" [(ngModel)]="form.cost_min" min="0" placeholder="Ex: 200"/>
              </div>

              <!-- Custo max -->
              <div class="field">
                <label>Custo máx (R$)</label>
                <input type="number" [(ngModel)]="form.cost_max" min="0" placeholder="Ex: 800"/>
              </div>

              <!-- Indicações -->
              <div class="field form-full">
                <label>Indicações</label>
                <textarea [(ngModel)]="form.indications" rows="3"
                  placeholder="Separe por vírgula: flacidez, envelhecimento, manchas..."></textarea>
                <div class="field-hint">Separar por vírgula</div>
              </div>

              <!-- Contraindicações -->
              <div class="field form-full">
                <label>Contraindicações</label>
                <textarea [(ngModel)]="form.contraindications" rows="3"
                  placeholder="Separe por vírgula: gravidez, marcapasso, infecção ativa..."></textarea>
                <div class="field-hint">Separar por vírgula</div>
              </div>

              <!-- Descrição -->
              <div class="field form-full">
                <label>Descrição</label>
                <textarea [(ngModel)]="form.description" rows="3"
                  placeholder="Breve descrição do tratamento..."></textarea>
              </div>

              <!-- Notas de protocolo -->
              <div class="field form-full">
                <label>Notas de protocolo</label>
                <textarea [(ngModel)]="form.protocol_notes" rows="3"
                  placeholder="Instruções de aplicação, cuidados, equipamentos..."></textarea>
              </div>

              <!-- Checkboxes -->
              <div class="field form-full" style="display:flex; gap:2rem; flex-wrap:wrap">
                <label class="toggle-row">
                  <input type="checkbox" [(ngModel)]="form.requires_medico"/>
                  Requer médico
                </label>
                @if (editing()) {
                  <label class="toggle-row">
                    <input type="checkbox" [(ngModel)]="form.is_active"/>
                    Ativo
                  </label>
                }
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" (click)="closeModal()" [disabled]="saving()">Cancelar</button>
            <button class="btn btn-primary" (click)="save()" [disabled]="saving() || !formValid()">
              {{ saving() ? 'Salvando...' : (editing() ? 'Salvar alterações' : 'Criar tratamento') }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class MasterTreatmentCatalogComponent implements OnInit {
  private svc = inject(AestheticMasterService);

  readonly categories = TREATMENT_CATEGORIES;

  treatments = signal<AestheticTreatment[]>([]);
  loading = signal(false);
  errorMsg = signal<string | null>(null);
  filterCategory = '';
  filterActive: 'true' | 'false' | 'all' = 'all';

  showModal = signal(false);
  editing = signal<AestheticTreatment | null>(null);
  saving = signal(false);
  modalError = signal<string | null>(null);

  form = this.emptyForm();

  ngOnInit(): void {
    this.loadList();
  }

  loadList(): void {
    this.loading.set(true);
    this.errorMsg.set(null);
    this.svc.list({
      category: this.filterCategory || undefined,
      active: this.filterActive,
    }).subscribe({
      next: (res) => {
        this.treatments.set(res.items);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err.error?.error || 'Erro ao carregar tratamentos');
        this.loading.set(false);
      },
    });
  }

  openCreate(): void {
    this.editing.set(null);
    this.form = this.emptyForm();
    this.modalError.set(null);
    this.showModal.set(true);
  }

  openEdit(t: AestheticTreatment): void {
    this.editing.set(t);
    this.form = {
      name: t.name,
      category: t.category,
      evidence_level: t.evidence_level ?? '',
      typical_sessions: t.typical_sessions,
      interval_days: t.interval_days,
      cost_min: t.cost_estimate_brl_min,
      cost_max: t.cost_estimate_brl_max,
      indications: t.indications?.join(', ') ?? '',
      contraindications: t.contraindications?.join(', ') ?? '',
      description: t.description ?? '',
      protocol_notes: t.protocol_notes ?? '',
      requires_medico: t.requires_medico,
      is_active: t.is_active,
    };
    this.modalError.set(null);
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
    this.editing.set(null);
    this.form = this.emptyForm();
    this.modalError.set(null);
  }

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.closeModal();
    }
  }

  formValid(): boolean {
    return !!(this.form.name?.trim() && this.form.category);
  }

  save(): void {
    if (!this.formValid()) {
      this.modalError.set('Nome e categoria são obrigatórios.');
      return;
    }
    this.saving.set(true);
    this.modalError.set(null);

    const body: TreatmentInput = {
      name: this.form.name.trim(),
      category: this.form.category,
      evidence_level: (this.form.evidence_level as 'A' | 'B' | 'C' | 'D' | null) || null,
      typical_sessions: this.form.typical_sessions ?? null,
      interval_days: this.form.interval_days ?? null,
      cost_estimate_brl_min: this.form.cost_min ?? null,
      cost_estimate_brl_max: this.form.cost_max ?? null,
      indications: this.splitCsv(this.form.indications),
      contraindications: this.splitCsv(this.form.contraindications),
      description: this.form.description?.trim() || null,
      protocol_notes: this.form.protocol_notes?.trim() || null,
      requires_medico: this.form.requires_medico,
    };

    const current = this.editing();
    const req$ = current
      ? this.svc.update(current.id, { ...body, is_active: this.form.is_active })
      : this.svc.create(body);

    req$.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        this.loadList();
      },
      error: (err) => {
        this.saving.set(false);
        this.modalError.set(err.error?.error || 'Erro ao salvar tratamento');
      },
    });
  }

  deleteOne(t: AestheticTreatment): void {
    const confirmed = window.confirm(
      `Excluir "${t.name}"?\n\nEssa ação remove o tratamento do catálogo global.`
    );
    if (!confirmed) return;

    this.svc.remove(t.id).subscribe({
      next: () => this.loadList(),
      error: (err) => this.errorMsg.set(err.error?.error || 'Erro ao excluir tratamento'),
    });
  }

  formatCategory(cat: string): string {
    return cat
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private emptyForm(): {
    name: string;
    category: string;
    evidence_level: string;
    typical_sessions: number | null;
    interval_days: number | null;
    cost_min: number | null;
    cost_max: number | null;
    indications: string;
    contraindications: string;
    description: string;
    protocol_notes: string;
    requires_medico: boolean;
    is_active: boolean;
  } {
    return {
      name: '',
      category: '',
      evidence_level: '',
      typical_sessions: null,
      interval_days: null,
      cost_min: null,
      cost_max: null,
      indications: '',
      contraindications: '',
      description: '',
      protocol_notes: '',
      requires_medico: false,
      is_active: true,
    };
  }

  private splitCsv(val: string): string[] {
    if (!val?.trim()) return [];
    return val
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}
