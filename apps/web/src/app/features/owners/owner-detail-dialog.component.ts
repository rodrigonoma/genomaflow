import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { OwnersService, Owner, OwnerUpdatePayload } from './owners.service';
import { formatPhone, formatCep, unmask, isValidPhoneBR } from '../../shared/utils/mask';

export interface OwnerDetailDialogData {
  owner_id: string;
}

/**
 * Dialog para visualizar e editar dados completos de um tutor (módulo veterinary).
 *
 * Comportamento:
 * - Carrega dados via GET /patients/owners/:id em ngOnInit (loading state)
 * - Modo "view" inicial; clique em "Editar" troca pra modo "edit"
 * - CPF é read-only (não muda; backend não atualiza CPF no PUT)
 * - Salvar valida telefone (DDD obrigatório) e dá PUT /patients/owners/:id
 * - Fecha com `true` se salvou (consumer pode refresh), `false` se cancelou
 *
 * Uso típico:
 *   this.dialog.open(OwnerDetailDialogComponent, { data: { owner_id }, width: '560px' })
 *     .afterClosed().subscribe(saved => { if (saved) this.refresh(); });
 */
@Component({
  selector: 'app-owner-detail-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule,
    MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatProgressSpinnerModule, MatSnackBarModule,
  ],
  styles: [`
    :host { color:#dae2fd; display:block; max-height:88vh; overflow:hidden; display:flex; flex-direction:column; }
    .header { padding:1rem 1.25rem; display:flex; align-items:center; gap:.75rem; border-bottom:1px solid rgba(70,69,84,.25); }
    h2 { margin:0; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:1.05rem; color:#c0c1ff; flex:1; }
    .close-btn { color:#a09fb2; }

    .body { padding:1rem 1.25rem; overflow-y:auto; flex:1; }

    .loading { display:flex; align-items:center; justify-content:center; gap:.75rem; padding:2rem; color:#6e6d80; }
    .error { color:#fca5a5; padding:1rem; font-family:'JetBrains Mono',monospace; font-size:.8rem; }

    .section { margin-bottom:1.25rem; }
    .section-label {
      font-family:'JetBrains Mono',monospace; font-size:10px;
      text-transform:uppercase; letter-spacing:.12em; color:#7c7b8f;
      margin-bottom:.5rem; padding-bottom:.25rem;
      border-bottom:1px solid rgba(70,69,84,.2);
    }

    .row { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; margin-bottom:.5rem; }
    .row-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:.75rem; margin-bottom:.5rem; }
    .row-cep { display:grid; grid-template-columns:140px 1fr; gap:.75rem; margin-bottom:.5rem; }
    .row-num { display:grid; grid-template-columns:120px 1fr; gap:.75rem; margin-bottom:.5rem; }
    .full { grid-column:1/-1; }

    /* View mode */
    .view-grid { display:grid; grid-template-columns:1fr 1fr; gap:.75rem 1.25rem; }
    .view-row { display:flex; flex-direction:column; gap:.125rem; }
    .view-row.full { grid-column:1/-1; }
    .view-label { font-family:'JetBrains Mono',monospace; font-size:9px; text-transform:uppercase;
                  letter-spacing:.12em; color:#7c7b8f; }
    .view-value { font-size:.85rem; color:#dae2fd; word-break:break-word; }
    .view-value.empty { color:#6e6d80; font-style:italic; }
    .view-value.address { line-height:1.5; }

    .footer {
      padding:.75rem 1.25rem; display:flex; justify-content:flex-end; gap:.75rem;
      border-top:1px solid rgba(70,69,84,.25);
    }
    .submit-btn {
      background:#c0c1ff; color:#1000a9; border:none; border-radius:6px;
      padding:.5rem 1.25rem; font-size:.75rem; font-weight:700;
      letter-spacing:.06em; text-transform:uppercase; cursor:pointer;
      display:inline-flex; align-items:center; gap:.375rem;
    }
    .submit-btn:disabled { opacity:.4; cursor:not-allowed; }
    .secondary-btn {
      background:transparent; color:#a09fb2;
      border:1px solid rgba(70,69,84,.4); border-radius:6px;
      padding:.5rem 1rem; cursor:pointer; font-size:.75rem;
    }
    .secondary-btn:hover { color:#dae2fd; border-color:rgba(192,193,255,.4); }

    .form-error {
      color:#fca5a5; font-size:.75rem; padding:.5rem .75rem;
      background:rgba(220,38,38,.12); border:1px solid rgba(239,68,68,.3);
      border-radius:4px; margin-bottom:.75rem;
    }
  `],
  template: `
    <div class="header">
      <mat-icon style="color:#c0c1ff;">person</mat-icon>
      <h2>{{ mode() === 'edit' ? 'Editar dados do tutor' : 'Dados do tutor' }}</h2>
      <button mat-icon-button class="close-btn" (click)="cancel()" aria-label="Fechar">
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <div class="body">
      @if (loading()) {
        <div class="loading">
          <mat-spinner diameter="28"></mat-spinner>
          <span>Carregando dados do tutor…</span>
        </div>
      } @else if (loadError()) {
        <div class="error">{{ loadError() }}</div>
      } @else if (owner()) {
        @if (formError()) {
          <div class="form-error">{{ formError() }}</div>
        }

        @if (mode() === 'view') {
          <!-- VIEW -->
          <div class="section">
            <div class="section-label">Dados pessoais</div>
            <div class="view-grid">
              <div class="view-row full">
                <span class="view-label">Nome</span>
                <span class="view-value">{{ owner()!.name }}</span>
              </div>
              <div class="view-row">
                <span class="view-label">CPF / CNPJ</span>
                <span class="view-value" [class.empty]="!owner()!.cpf_last4">
                  {{ owner()!.cpf_last4 ? '••••••••' + owner()!.cpf_last4 : '— não informado —' }}
                </span>
              </div>
              <div class="view-row">
                <span class="view-label">Telefone</span>
                <span class="view-value" [class.empty]="!owner()!.phone">
                  {{ owner()!.phone ? formatPhoneFn(owner()!.phone!) : '— não informado —' }}
                </span>
              </div>
              <div class="view-row full">
                <span class="view-label">Email</span>
                <span class="view-value" [class.empty]="!owner()!.email">
                  {{ owner()!.email || '— não informado —' }}
                </span>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-label">Endereço</div>
            <div class="view-grid">
              <div class="view-row full">
                <span class="view-label">Logradouro completo</span>
                <span class="view-value address" [class.empty]="!hasAddress()">
                  @if (hasAddress()) {
                    {{ formatAddress() }}
                  } @else { — não informado — }
                </span>
              </div>
              <div class="view-row">
                <span class="view-label">CEP</span>
                <span class="view-value" [class.empty]="!owner()!.cep">
                  {{ owner()!.cep ? formatCepFn(owner()!.cep!) : '—' }}
                </span>
              </div>
              <div class="view-row">
                <span class="view-label">UF</span>
                <span class="view-value" [class.empty]="!owner()!.state">
                  {{ owner()!.state || '—' }}
                </span>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-label">Observações</div>
            <div class="view-grid">
              <div class="view-row full">
                <span class="view-label">Notas internas</span>
                <span class="view-value" [class.empty]="!owner()!.notes">
                  {{ owner()!.notes || '— sem notas —' }}
                </span>
              </div>
              <div class="view-row full">
                <span class="view-label">Observações clínicas</span>
                <span class="view-value" [class.empty]="!owner()!.observations">
                  {{ owner()!.observations || '— sem observações —' }}
                </span>
              </div>
            </div>
          </div>
        } @else {
          <!-- EDIT -->
          <div class="section">
            <div class="section-label">Dados pessoais</div>
            <div class="row">
              <mat-form-field appearance="outline" class="full" style="grid-column:1/-1;">
                <mat-label>Nome</mat-label>
                <input matInput [(ngModel)]="form.name" required maxlength="120"/>
              </mat-form-field>
            </div>
            <div class="row">
              <mat-form-field appearance="outline">
                <mat-label>CPF / CNPJ</mat-label>
                <input matInput [value]="owner()!.cpf_last4 ? '••••••••' + owner()!.cpf_last4 : '— não informado —'" disabled/>
                <mat-hint>CPF não pode ser alterado</mat-hint>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Telefone (com DDD)</mat-label>
                <input matInput [(ngModel)]="form.phone" (input)="onPhoneInput($event)" placeholder="(11) 99999-9999"/>
              </mat-form-field>
            </div>
            <div class="row">
              <mat-form-field appearance="outline" class="full" style="grid-column:1/-1;">
                <mat-label>Email</mat-label>
                <input matInput type="email" [(ngModel)]="form.email" maxlength="240"/>
              </mat-form-field>
            </div>
          </div>

          <div class="section">
            <div class="section-label">Endereço</div>
            <div class="row-cep">
              <mat-form-field appearance="outline">
                <mat-label>CEP</mat-label>
                <input matInput [(ngModel)]="form.cep" (input)="onCepInput($event)" placeholder="00000-000"/>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Logradouro</mat-label>
                <input matInput [(ngModel)]="form.street" maxlength="200"/>
              </mat-form-field>
            </div>
            <div class="row-num">
              <mat-form-field appearance="outline">
                <mat-label>Número</mat-label>
                <input matInput [(ngModel)]="form.number" maxlength="20"/>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Complemento</mat-label>
                <input matInput [(ngModel)]="form.complement" maxlength="100"/>
              </mat-form-field>
            </div>
            <div class="row-3">
              <mat-form-field appearance="outline">
                <mat-label>Bairro</mat-label>
                <input matInput [(ngModel)]="form.neighborhood" maxlength="100"/>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Cidade</mat-label>
                <input matInput [(ngModel)]="form.city" maxlength="100"/>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>UF</mat-label>
                <input matInput [(ngModel)]="form.state" maxlength="2" placeholder="SP"/>
              </mat-form-field>
            </div>
          </div>

          <div class="section">
            <div class="section-label">Observações</div>
            <div class="row">
              <mat-form-field appearance="outline" style="grid-column:1/-1;">
                <mat-label>Notas internas (curtas)</mat-label>
                <textarea matInput rows="2" [(ngModel)]="form.notes" maxlength="500"></textarea>
              </mat-form-field>
            </div>
            <div class="row">
              <mat-form-field appearance="outline" style="grid-column:1/-1;">
                <mat-label>Observações clínicas</mat-label>
                <textarea matInput rows="3" [(ngModel)]="form.observations" maxlength="2000"></textarea>
              </mat-form-field>
            </div>
          </div>
        }
      }
    </div>

    <div class="footer">
      @if (mode() === 'view') {
        <button class="secondary-btn" (click)="cancel()">Fechar</button>
        <button class="submit-btn" (click)="enterEdit()" [disabled]="loading() || !owner()">
          <mat-icon style="font-size:16px;width:16px;height:16px;">edit</mat-icon>
          Editar
        </button>
      } @else {
        <button class="secondary-btn" (click)="cancelEdit()" [disabled]="saving()">Cancelar</button>
        <button class="submit-btn" (click)="save()" [disabled]="saving() || !form.name?.trim()">
          @if (saving()) { <mat-spinner diameter="14" style="display:inline-block;margin-right:6px;"></mat-spinner> }
          Salvar
        </button>
      }
    </div>
  `,
})
export class OwnerDetailDialogComponent implements OnInit {
  data: OwnerDetailDialogData = inject(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<OwnerDetailDialogComponent, boolean>);
  private svc = inject(OwnersService);
  private snack = inject(MatSnackBar);

  loading = signal(true);
  saving = signal(false);
  loadError = signal<string | null>(null);
  formError = signal<string | null>(null);
  mode = signal<'view' | 'edit'>('view');
  owner = signal<Owner | null>(null);

  form: OwnerUpdatePayload & { name: string } = {
    name: '',
    phone: '', email: '', notes: '', observations: '',
    cep: '', street: '', number: '', complement: '',
    neighborhood: '', city: '', state: '',
  };

  formatPhoneFn = formatPhone;
  formatCepFn = formatCep;

  ngOnInit() {
    this.svc.get(this.data.owner_id).subscribe({
      next: (o) => {
        this.owner.set(o);
        this.populateForm(o);
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(err.error?.error || 'Não foi possível carregar os dados do tutor.');
        this.loading.set(false);
      },
    });
  }

  private populateForm(o: Owner) {
    this.form = {
      name: o.name || '',
      phone: o.phone ? formatPhone(o.phone) : '',
      email: o.email || '',
      notes: o.notes || '',
      observations: o.observations || '',
      cep: o.cep ? formatCep(o.cep) : '',
      street: o.street || '',
      number: o.number || '',
      complement: o.complement || '',
      neighborhood: o.neighborhood || '',
      city: o.city || '',
      state: o.state || '',
    };
  }

  enterEdit() {
    const o = this.owner();
    if (!o) return;
    this.populateForm(o);
    this.formError.set(null);
    this.mode.set('edit');
  }

  cancelEdit() {
    this.formError.set(null);
    this.mode.set('view');
  }

  onPhoneInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.form.phone = formatPhone(target.value);
  }

  onCepInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.form.cep = formatCep(target.value);
  }

  hasAddress(): boolean {
    const o = this.owner();
    if (!o) return false;
    return !!(o.cep || o.street || o.number || o.neighborhood || o.city || o.state);
  }

  formatAddress(): string {
    const o = this.owner();
    if (!o) return '';
    const parts: string[] = [];
    if (o.street) {
      let line = o.street;
      if (o.number) line += `, ${o.number}`;
      if (o.complement) line += ` — ${o.complement}`;
      parts.push(line);
    }
    if (o.neighborhood) parts.push(o.neighborhood);
    const cityState = [o.city, o.state].filter(Boolean).join(' / ');
    if (cityState) parts.push(cityState);
    return parts.join(' · ');
  }

  save() {
    if (!this.form.name?.trim()) {
      this.formError.set('Nome é obrigatório.');
      return;
    }
    if (this.form.phone && !isValidPhoneBR(this.form.phone)) {
      this.formError.set('Telefone inválido. Use formato com DDD: (11) 99999-9999.');
      return;
    }

    this.formError.set(null);
    this.saving.set(true);

    const payload: OwnerUpdatePayload = {
      name: this.form.name.trim(),
      phone: this.form.phone ? unmask(this.form.phone) : null,
      email: this.form.email?.trim() || null,
      notes: this.form.notes?.trim() || null,
      observations: this.form.observations?.trim() || null,
      cep: this.form.cep ? unmask(this.form.cep) : null,
      street: this.form.street?.trim() || null,
      number: this.form.number?.trim() || null,
      complement: this.form.complement?.trim() || null,
      neighborhood: this.form.neighborhood?.trim() || null,
      city: this.form.city?.trim() || null,
      state: this.form.state?.trim().toUpperCase() || null,
    };

    this.svc.update(this.data.owner_id, payload).subscribe({
      next: (updated) => {
        this.owner.set({ ...this.owner()!, ...updated });
        this.saving.set(false);
        this.mode.set('view');
        this.snack.open('Dados do tutor atualizados.', '', { duration: 3000 });
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(err.error?.error || 'Erro ao salvar. Tente novamente.');
      },
    });
  }

  cancel() {
    this.ref.close(false);
  }
}
