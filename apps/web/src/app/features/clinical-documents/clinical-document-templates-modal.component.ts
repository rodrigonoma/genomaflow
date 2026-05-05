import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  ClinicalDocumentsService,
  ClinicalDocumentTemplate,
  DocType,
  DOC_TYPE_LABELS,
} from './clinical-documents.service';

/**
 * Admin-only modal pra CRUD de templates de documentos clínicos.
 * Templates são por tenant — backend já enforce role admin/master.
 */
@Component({
  selector: 'app-clinical-document-templates-modal',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe,
    MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>library_books</mat-icon>
      Modelos de documentos clínicos
    </h2>

    <mat-dialog-content class="content">
      <p class="muted">
        Crie modelos reutilizáveis com placeholders {{ '{{paciente}}' }}, {{ '{{data}}' }}, {{ '{{profissional}}' }}, {{ '{{crm}}' }}.
        Eles aparecerão no diálogo de geração de documentos.
      </p>

      <div class="layout">
        <div class="list-pane">
          <div class="filters">
            <mat-form-field appearance="outline" class="full">
              <mat-label>Filtrar por tipo</mat-label>
              <mat-select [(ngModel)]="filterType" (ngModelChange)="resetSelection()">
                <mat-option [value]="null">Todos</mat-option>
                @for (t of docTypeOptions; track t.value) {
                  <mat-option [value]="t.value">{{ t.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <button mat-flat-button color="primary" (click)="newTemplate()">
              <mat-icon>add</mat-icon> Novo
            </button>
          </div>

          @if (loading()) {
            <p class="muted center">Carregando...</p>
          } @else if (filteredTemplates().length === 0) {
            <p class="muted center">Nenhum modelo cadastrado.</p>
          } @else {
            <ul class="template-list">
              @for (t of filteredTemplates(); track t.id) {
                <li [class.selected]="selected()?.id === t.id" (click)="select(t)">
                  <div class="t-name">{{ t.name }}</div>
                  <div class="t-type">{{ docLabel(t.doc_type) }}</div>
                </li>
              }
            </ul>
          }
        </div>

        <div class="edit-pane">
          @if (!editing()) {
            <div class="empty">
              <mat-icon>chrome_reader_mode</mat-icon>
              <p>Selecione um modelo à esquerda ou clique em <strong>Novo</strong>.</p>
            </div>
          } @else {
            <mat-form-field appearance="outline" class="full">
              <mat-label>Tipo</mat-label>
              <mat-select [(ngModel)]="editing()!.doc_type" [disabled]="!isNew()">
                @for (t of docTypeOptions; track t.value) {
                  <mat-option [value]="t.value">{{ t.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full">
              <mat-label>Nome do modelo</mat-label>
              <input matInput [(ngModel)]="editing()!.name" maxlength="200" required />
            </mat-form-field>

            <mat-form-field appearance="outline" class="full">
              <mat-label>Conteúdo</mat-label>
              <textarea matInput [(ngModel)]="editing()!.body" rows="14" maxlength="50000" required></textarea>
            </mat-form-field>

            <div class="actions">
              @if (!isNew()) {
                <button mat-stroked-button color="warn" (click)="remove()">
                  <mat-icon>delete</mat-icon> Excluir
                </button>
              }
              <span class="spacer"></span>
              <button mat-button (click)="cancel()">Cancelar</button>
              <button mat-flat-button color="primary" (click)="save()" [disabled]="saving()">
                <mat-icon>save</mat-icon>
                {{ saving() ? 'Salvando...' : 'Salvar' }}
              </button>
            </div>
          }
        </div>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Fechar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; color: #dae2fd; }
    h2 { display: flex; align-items: center; gap: 8px; color: #dae2fd; margin-bottom: 0; }
    h2 mat-icon { color: #c0c1ff; }
    .muted { color: #a09fb2; font-size: 0.875rem; }
    .center { text-align: center; padding: 24px; }
    .full { width: 100%; }
    /* padding 1.25rem pra cima evita clip do floating label (feedback_material_modal_padding.md) */
    mat-dialog-content.content { padding: 1.25rem 1.5rem 0.5rem !important; max-height: 70vh; }

    .layout { display: grid; grid-template-columns: minmax(220px, 320px) 1fr; gap: 16px; min-height: 460px; }
    @media (max-width: 720px) { .layout { grid-template-columns: 1fr; } }

    .list-pane { border: 1px solid rgba(70,69,84,0.25); background: #0b1326; border-radius: 4px; padding: 12px; display: flex; flex-direction: column; }
    .filters { display: flex; gap: 8px; align-items: flex-end; margin-bottom: 8px; }
    .filters mat-form-field { flex: 1; }
    .template-list { list-style: none; padding: 0; margin: 0; overflow-y: auto; }
    .template-list li { padding: 10px 12px; border-radius: 4px; cursor: pointer; transition: background 0.15s; border: 1px solid transparent; color: #dae2fd; }
    .template-list li:hover { background: rgba(192, 193, 255, 0.08); }
    .template-list li.selected { background: rgba(192, 193, 255, 0.16); border-color: #c0c1ff; }
    .t-name { font-weight: 500; font-size: 0.875rem; color: #dae2fd; }
    .t-type { font-size: 0.75rem; color: #a09fb2; margin-top: 2px; }

    .edit-pane { padding: 12px; border: 1px solid rgba(70,69,84,0.25); background: #0b1326; border-radius: 4px; display: flex; flex-direction: column; }
    .edit-pane .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #7c7b8f; }
    .edit-pane .empty mat-icon { font-size: 56px; width: 56px; height: 56px; }
    .actions { display: flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 12px; }
    .spacer { flex: 1; }
    textarea { font-family: 'JetBrains Mono', monospace; font-size: 0.875rem; line-height: 1.5; color: #dae2fd; }
  `],
})
export class ClinicalDocumentTemplatesModalComponent implements OnInit {
  private service = inject(ClinicalDocumentsService);
  private snack = inject(MatSnackBar);
  private dialogRef = inject(MatDialogRef<ClinicalDocumentTemplatesModalComponent>);

  docTypeOptions = (Object.keys(DOC_TYPE_LABELS) as DocType[]).map(value => ({
    value, label: DOC_TYPE_LABELS[value],
  }));

  templates = signal<ClinicalDocumentTemplate[]>([]);
  selected = signal<ClinicalDocumentTemplate | null>(null);
  editing = signal<Partial<ClinicalDocumentTemplate> | null>(null);
  loading = signal(true);
  saving = signal(false);
  filterType: DocType | null = null;

  filteredTemplates = computed(() =>
    this.filterType
      ? this.templates().filter(t => t.doc_type === this.filterType)
      : this.templates()
  );

  ngOnInit() { this.refresh(); }

  refresh() {
    this.loading.set(true);
    this.service.listTemplates().subscribe({
      next: r => { this.templates.set(r.items); this.loading.set(false); },
      error: () => {
        this.loading.set(false);
        this.snack.open('Erro ao carregar modelos', 'Fechar', { duration: 4000 });
      },
    });
  }

  resetSelection() {
    this.selected.set(null);
    this.editing.set(null);
  }

  docLabel(t: DocType) { return DOC_TYPE_LABELS[t]; }

  isNew(): boolean { return !this.editing()?.id; }

  select(t: ClinicalDocumentTemplate) {
    this.selected.set(t);
    this.editing.set({ ...t });
  }

  newTemplate() {
    this.selected.set(null);
    this.editing.set({
      doc_type: this.filterType ?? 'atestado',
      name: '',
      body: '',
    });
  }

  cancel() {
    this.selected.set(null);
    this.editing.set(null);
  }

  save() {
    const e = this.editing();
    if (!e || !e.name?.trim() || !e.body?.trim() || !e.doc_type) {
      this.snack.open('Preencha tipo, nome e conteúdo.', 'Fechar', { duration: 3000 });
      return;
    }
    this.saving.set(true);
    const op$ = e.id
      ? this.service.updateTemplate(e.id, { name: e.name.trim(), body: e.body, active: true })
      : this.service.createTemplate({ doc_type: e.doc_type, name: e.name.trim(), body: e.body });

    op$.subscribe({
      next: t => {
        this.saving.set(false);
        this.snack.open('Modelo salvo.', 'OK', { duration: 2000 });
        this.refresh();
        this.selected.set(t);
        this.editing.set({ ...t });
      },
      error: (err) => {
        this.saving.set(false);
        this.snack.open(err?.error?.error ?? 'Erro ao salvar modelo', 'Fechar', { duration: 4000 });
      },
    });
  }

  remove() {
    const e = this.editing();
    if (!e?.id) return;
    if (!confirm(`Excluir modelo "${e.name}"? Documentos já emitidos não são afetados.`)) return;
    this.service.deleteTemplate(e.id).subscribe({
      next: () => {
        this.snack.open('Modelo excluído.', 'OK', { duration: 2000 });
        this.cancel();
        this.refresh();
      },
      error: () => this.snack.open('Erro ao excluir modelo', 'Fechar', { duration: 4000 }),
    });
  }

  close() { this.dialogRef.close(); }
}
