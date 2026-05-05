import { Component, Inject, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  ClinicalDocumentsService,
  ClinicalDocumentTemplate,
  DocType,
  DOC_TYPE_LABELS,
} from './clinical-documents.service';
import { environment } from '../../../environments/environment';

interface DialogData {
  subject_id: string;
  subject_name: string;
  subject_type?: 'human' | 'animal';
  initial_doc_type?: DocType;
  professional_name?: string | null;
  professional_crm?: string | null;
}

interface ClinicProfile {
  name?: string;
  cnpj?: string | null;
  address?: string | null;
  phone?: string | null;
  clinic_logo_url?: string | null;
}

const DEFAULTS: Record<DocType, string> = {
  atestado:
    'Atesto, para os devidos fins, que o(a) paciente {{paciente}} foi atendido(a) nesta data e necessita de afastamento de suas atividades por {{dias}} dia(s), a partir de {{data_inicio}}.\n\nCID-10: ____\n\nObservações:',
  pedido_exame:
    'Solicito, para o(a) paciente {{paciente}}, a realização dos seguintes exames:\n\n- \n- \n- \n\nIndicação clínica:\n\n',
  encaminhamento:
    'Encaminho o(a) paciente {{paciente}} para avaliação especializada com Dr(a). _________________ — especialidade _________________.\n\nMotivo do encaminhamento:\n\nResumo clínico:\n\n',
  relatorio:
    'Relatório clínico do(a) paciente {{paciente}}.\n\nHistória clínica:\n\nAchados relevantes:\n\nConclusão:\n\nConduta:\n\n',
  termo_consentimento:
    'TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO\n\nEu, {{paciente}}, declaro que fui devidamente informado(a) pelo(a) profissional sobre o procedimento a ser realizado, seus riscos, benefícios e alternativas, e CONSINTO com sua realização nas seguintes condições:\n\n- \n- \n\nEstou ciente de que posso revogar este consentimento a qualquer tempo.',
};

@Component({
  selector: 'app-clinical-document-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe,
    MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>description</mat-icon>
      Novo documento — {{ data.subject_name }}
    </h2>

    <mat-dialog-content>
      <div class="row">
        <mat-form-field appearance="outline" class="col">
          <mat-label>Tipo de documento</mat-label>
          <mat-select [(ngModel)]="docType" (ngModelChange)="onDocTypeChange()">
            @for (t of docTypes; track t.value) {
              <mat-option [value]="t.value">{{ t.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="col">
          <mat-label>Modelo</mat-label>
          <mat-select [(ngModel)]="templateId" (ngModelChange)="onTemplateChange()">
            <mat-option [value]="null">— Sem modelo —</mat-option>
            @for (t of filteredTemplates(); track t.id) {
              <mat-option [value]="t.id">{{ t.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      <mat-form-field appearance="outline" class="full">
        <mat-label>Título</mat-label>
        <input matInput [(ngModel)]="title" maxlength="300" required />
      </mat-form-field>

      <mat-form-field appearance="outline" class="full">
        <mat-label>Conteúdo</mat-label>
        <textarea matInput [(ngModel)]="body" rows="14" maxlength="100000" required></textarea>
        <mat-hint>Placeholders: {{ '{{paciente}}' }}, {{ '{{data}}' }}, {{ '{{profissional}}' }}, {{ '{{crm}}' }} — substituídos no PDF.</mat-hint>
      </mat-form-field>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="close()" [disabled]="saving()">Cancelar</button>
      <button mat-stroked-button (click)="generatePdfOnly()" [disabled]="saving() || !body || !title">
        <mat-icon>print</mat-icon> Apenas PDF
      </button>
      <button mat-flat-button color="primary" (click)="saveAndGenerate()" [disabled]="saving() || !body || !title">
        <mat-icon>save</mat-icon>
        {{ saving() ? 'Salvando...' : 'Salvar e gerar PDF' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; color: #dae2fd; }
    h2 { display: flex; align-items: center; gap: 8px; color: #dae2fd; margin-bottom: 0; }
    h2 mat-icon { color: #c0c1ff; }
    /* padding 1.25rem pra cima evita clip do floating label do mat-form-field outline.
       Lição aprendida em feedback_material_modal_padding.md (incidente 2026-04-24). */
    mat-dialog-content { padding: 1.25rem 1.5rem 0.5rem !important; max-height: 70vh; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; }
    .col { flex: 1 1 240px; min-width: 0; }
    .full { width: 100%; }
    mat-form-field { width: 100%; }
    textarea { font-family: 'JetBrains Mono', monospace; font-size: 0.875rem; line-height: 1.5; color: #dae2fd; }
    mat-dialog-actions { flex-wrap: wrap; gap: 8px; padding: 0.75rem 1.5rem 1rem; }
    ::ng-deep .mat-mdc-form-field-hint { color: #a09fb2 !important; }
  `],
})
export class ClinicalDocumentDialogComponent implements OnInit {
  private service = inject(ClinicalDocumentsService);
  private snack = inject(MatSnackBar);
  private dialogRef = inject(MatDialogRef<ClinicalDocumentDialogComponent>);
  private http = inject(HttpClient);

  docTypes = (Object.keys(DOC_TYPE_LABELS) as DocType[]).map(value => ({
    value, label: DOC_TYPE_LABELS[value],
  }));

  docType: DocType = 'atestado';
  templateId: string | null = null;
  title = '';
  body = '';

  saving = signal(false);
  templates = signal<ClinicalDocumentTemplate[]>([]);
  clinicProfile: ClinicProfile | null = null;

  constructor(@Inject(MAT_DIALOG_DATA) public data: DialogData) {}

  ngOnInit() {
    this.docType = this.data.initial_doc_type ?? 'atestado';
    this.applyDefault();
    this.loadTemplates();
    this.http.get<ClinicProfile>(`${environment.apiUrl}/clinic/profile`).subscribe({
      next: p => this.clinicProfile = p,
      error: () => this.clinicProfile = null,
    });
  }

  filteredTemplates = computed(() =>
    this.templates().filter(t => t.doc_type === this.docType)
  );

  loadTemplates() {
    this.service.listTemplates().subscribe({
      next: r => this.templates.set(r.items),
      error: () => this.templates.set([]),
    });
  }

  onDocTypeChange() {
    this.templateId = null;
    this.applyDefault();
  }

  onTemplateChange() {
    if (!this.templateId) {
      this.applyDefault();
      return;
    }
    const tpl = this.templates().find(t => t.id === this.templateId);
    if (tpl) {
      this.title = tpl.name;
      this.body = this.applyPlaceholders(tpl.body);
    }
  }

  applyDefault() {
    const tpl = DEFAULTS[this.docType] ?? '';
    this.title = `${DOC_TYPE_LABELS[this.docType]} — ${this.data.subject_name}`;
    this.body = this.applyPlaceholders(tpl);
  }

  applyPlaceholders(text: string): string {
    const today = new Date().toLocaleDateString('pt-BR');
    return text
      .replace(/\{\{paciente\}\}/g, this.data.subject_name)
      .replace(/\{\{data\}\}/g, today)
      .replace(/\{\{profissional\}\}/g, this.data.professional_name ?? '')
      .replace(/\{\{crm\}\}/g, this.data.professional_crm ?? '');
  }

  async generatePdfOnly() {
    await this.renderPdf({ download: true });
  }

  async saveAndGenerate() {
    if (!this.title || !this.body) {
      this.snack.open('Preencha título e conteúdo', 'Fechar', { duration: 3000 });
      return;
    }
    this.saving.set(true);
    this.service.createDocument({
      subject_id: this.data.subject_id,
      doc_type: this.docType,
      title: this.title.trim(),
      body: this.body,
      template_id: this.templateId ?? undefined,
    }).subscribe({
      next: async (doc) => {
        this.saving.set(false);
        this.snack.open('Documento salvo.', 'OK', { duration: 2000 });
        await this.renderPdf({ download: true, docId: doc.id });
        this.dialogRef.close({ created: true, doc });
      },
      error: (err) => {
        this.saving.set(false);
        this.snack.open(err?.error?.error ?? 'Erro ao salvar documento', 'Fechar', { duration: 4000 });
      },
    });
  }

  private async renderPdf(opts: { download: boolean; docId?: string }) {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const profile = this.clinicProfile;
    const dateStr = new Date().toLocaleDateString('pt-BR');

    let headerY = 20;
    if (profile?.clinic_logo_url && !profile.clinic_logo_url.startsWith('s3://')) {
      try { doc.addImage(profile.clinic_logo_url, 'PNG', 15, 10, 30, 30); } catch (_) {}
      headerY = 15;
    }
    doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(11, 19, 38);
    doc.text(profile?.name ?? 'Clínica', 105, headerY, { align: 'center' });
    if (profile?.cnpj) {
      doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(80, 80, 100);
      doc.text(`CNPJ: ${profile.cnpj}`, 105, headerY + 6, { align: 'center' });
    }
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(120, 120, 140);
    doc.text(dateStr, 195, headerY, { align: 'right' });
    doc.setDrawColor(192, 193, 255).line(15, 45, 195, 45);

    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(27, 27, 100);
    doc.text(this.title.toUpperCase(), 105, 55, { align: 'center' });

    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40, 40, 60);
    let y = 70;
    const lines = doc.splitTextToSize(this.body, 180);
    for (const line of lines) {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.text(line, 15, y);
      y += 6;
    }

    y = Math.max(y + 20, 240);
    doc.line(15, y, 95, y);
    doc.setFontSize(9).setTextColor(80, 80, 100);
    doc.text(this.data.professional_name || 'Profissional responsável', 15, y + 5);
    if (this.data.professional_crm) doc.text(this.data.professional_crm, 15, y + 10);

    doc.setFontSize(7).setTextColor(120, 120, 140);
    doc.text(
      `${DOC_TYPE_LABELS[this.docType]} · GenomaFlow Clinical AI · ${dateStr}`,
      105, 285, { align: 'center' }
    );

    if (opts.download) {
      const fileName = `${this.docType}-${this.data.subject_name.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(fileName);
    }
  }

  close() { this.dialogRef.close(); }
}
