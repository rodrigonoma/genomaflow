import { Component, inject, signal, Inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../../environments/environment';
import { Prescription, PrescriptionItem, Subject, ClinicalResult, ClinicProfile } from '../../../shared/models/api.models';

export interface PrescriptionModalData {
  examId: string;
  subjectId: string;
  subject: Subject;
  result: ClinicalResult;
  module: 'human' | 'veterinary';
  existingPrescription?: Prescription;
}

@Component({
  selector: 'app-prescription-modal',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatSnackBarModule, FormsModule],
  styles: [`
    .modal-wrap { background: #111929; border-radius: 8px; width: 640px; max-width: 95vw; }
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 1.5rem 1.5rem 0; }
    h2 { font-family: 'Space Grotesk', sans-serif; font-size: 1.125rem; font-weight: 700; color: #dae2fd; margin: 0; }
    .modal-body { padding: 1.25rem 1.5rem; max-height: 60vh; overflow-y: auto; }
    .item-row { background: #0b1326; border: 1px solid rgba(70,69,84,0.2); border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem; position: relative; }
    .item-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    .item-full { grid-column: 1 / -1; }
    .delete-btn { position: absolute; top: 0.5rem; right: 0.5rem; }
    .add-btn { width: 100%; margin-top: 0.5rem; }
    .footer { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; border-top: 1px solid rgba(70,69,84,0.15); gap: 0.75rem; }
    .actions { display: flex; gap: 0.5rem; }
    label { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6e6d80; display: block; margin-bottom: 0.25rem; }
    input[type=text] { width: 100%; background: #111929; border: 1px solid rgba(70,69,84,0.3); border-radius: 4px; padding: 0.5rem 0.75rem; color: #dae2fd; font-size: 13px; font-family: 'JetBrains Mono', monospace; box-sizing: border-box; }
    input[type=text]:focus { outline: none; border-color: #c0c1ff; }
    textarea { width: 100%; background: #111929; border: 1px solid rgba(70,69,84,0.3); border-radius: 4px; padding: 0.5rem 0.75rem; color: #dae2fd; font-size: 13px; font-family: 'JetBrains Mono', monospace; resize: vertical; min-height: 80px; box-sizing: border-box; }
  `],
  template: `
    <div class="modal-wrap">
      <div class="modal-header">
        <h2>{{ data.result.agent_type === 'therapeutic' ? 'Gerar Receita Médica' : 'Gerar Prescrição Nutricional' }}</h2>
        <button mat-icon-button (click)="close()"><mat-icon>close</mat-icon></button>
      </div>

      <div class="modal-body">
        @for (item of items; track $index) {
          <div class="item-row">
            <button mat-icon-button class="delete-btn" (click)="removeItem($index)" style="color:#ffb4ab;width:28px;height:28px">
              <mat-icon style="font-size:16px">delete</mat-icon>
            </button>
            <div class="item-fields">
              <div>
                <label>{{ data.result.agent_type === 'therapeutic' ? 'Medicamento' : 'Item' }}</label>
                <input type="text" [(ngModel)]="item.name" placeholder="Nome" />
              </div>
              <div>
                <label>Dose</label>
                <input type="text" [ngModel]="item.dose ?? ''" (ngModelChange)="item.dose = $event || null" placeholder="ex: 500mg" />
              </div>
              <div>
                <label>Frequência</label>
                <input type="text" [(ngModel)]="item.frequency" placeholder="ex: 2x ao dia" />
              </div>
              <div>
                <label>Duração</label>
                <input type="text" [ngModel]="item.duration ?? ''" (ngModelChange)="item.duration = $event || null" placeholder="ex: 30 dias" />
              </div>
              <div class="item-full">
                <label>Observações</label>
                <input type="text" [(ngModel)]="item.notes" placeholder="Observações adicionais" />
              </div>
            </div>
          </div>
        }

        <button mat-stroked-button class="add-btn" (click)="addItem()">
          <mat-icon>add</mat-icon> Adicionar item
        </button>

        <div style="margin-top:1rem;">
          <label>Observações gerais</label>
          <textarea [(ngModel)]="notes" placeholder="Observações gerais da prescrição..."></textarea>
        </div>
      </div>

      @if (pdfReady()) {
        <div style="padding:0.75rem 1.5rem;background:rgba(74,214,160,0.08);border-top:1px solid rgba(74,214,160,0.2);">
          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#4ad6a0;">✓ Receita salva e PDF gerado</span>
        </div>
        <div class="footer">
          <div class="actions">
            <button mat-stroked-button (click)="downloadPdf()"><mat-icon>download</mat-icon> Baixar PDF</button>
            <button mat-stroked-button (click)="shareWhatsApp()"><mat-icon>chat</mat-icon> WhatsApp</button>
            <button mat-stroked-button (click)="shareEmail()"><mat-icon>email</mat-icon> Email</button>
          </div>
          <button mat-button (click)="close()">Fechar</button>
        </div>
      } @else {
        <div class="footer">
          <button mat-button (click)="close()">Cancelar</button>
          <button mat-flat-button color="primary" [disabled]="saving()" (click)="saveAndGeneratePdf()">
            <mat-icon>picture_as_pdf</mat-icon>
            {{ saving() ? 'Gerando...' : 'Salvar e Gerar PDF' }}
          </button>
        </div>
      }
    </div>
  `
})
export class PrescriptionModalComponent {
  data: PrescriptionModalData = inject(MAT_DIALOG_DATA);
  private http      = inject(HttpClient);
  private snack     = inject(MatSnackBar);
  private dialogRef = inject(MatDialogRef<PrescriptionModalComponent>);

  items: PrescriptionItem[] = [];
  notes = '';
  saving   = signal(false);
  pdfReady = signal(false);

  private savedPrescriptionId: string | null = null;
  private pdfBlob: Blob | null = null;
  private clinicProfile: ClinicProfile | null = null;

  constructor() {
    if (this.data.existingPrescription) {
      this.items = [...this.data.existingPrescription.items];
      this.notes = this.data.existingPrescription.notes ?? '';
      this.savedPrescriptionId = this.data.existingPrescription.id;
      return;
    }

    const recs = this.data.result.recommendations ?? [];
    if (this.data.result.agent_type === 'therapeutic') {
      this.items = recs
        .filter(r => r.type === 'medication')
        .map(r => ({
          name: r.name ?? r.description,
          dose: r.dose ?? null,
          frequency: r.frequency ?? '',
          duration: r.duration ?? null,
          notes: ''
        }));
    } else {
      this.items = recs.map(r => ({
        name: r.name ?? r.description,
        dose: r.dose ?? null,
        frequency: r.frequency ?? '',
        duration: r.duration ?? null,
        notes: ''
      }));
    }
  }

  addItem(): void {
    this.items.push({ name: '', dose: null, frequency: '', duration: null, notes: '' });
  }

  removeItem(index: number): void {
    this.items.splice(index, 1);
  }

  saveAndGeneratePdf(): void {
    if (!this.items.length) { this.snack.open('Adicione ao menos um item', '', { duration: 2500 }); return; }
    this.saving.set(true);

    this.http.get<ClinicProfile>(`${environment.apiUrl}/clinic/profile`).subscribe({
      next: (profile) => { this.clinicProfile = profile; this.doSaveAndPdf(); },
      error: () => { this.clinicProfile = null; this.doSaveAndPdf(); }
    });
  }

  private doSaveAndPdf(): void {
    const body = {
      subject_id: this.data.subjectId,
      exam_id: this.data.examId,
      agent_type: this.data.result.agent_type,
      items: this.items,
      notes: this.notes
    };

    const save$ = this.savedPrescriptionId
      ? this.http.put<Prescription>(`${environment.apiUrl}/prescriptions/${this.savedPrescriptionId}`, body)
      : this.http.post<Prescription>(`${environment.apiUrl}/prescriptions`, body);

    save$.subscribe({
      next: (prescription) => { this.savedPrescriptionId = prescription.id; this.generateAndUploadPdf(prescription.id); },
      error: (e) => { this.saving.set(false); this.snack.open(e.error?.error ?? 'Erro ao salvar receita', '', { duration: 3000 }); }
    });
  }

  private async generateAndUploadPdf(prescriptionId: string): Promise<void> {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const profile  = this.clinicProfile;
    const subject  = this.data.subject;
    const isVet    = this.data.module === 'veterinary';
    const dateStr  = new Date().toLocaleDateString('pt-BR');

    // Cabeçalho
    let headerY = 20;
    if (profile?.clinic_logo_url && !profile.clinic_logo_url.startsWith('s3://')) {
      try { doc.addImage(profile.clinic_logo_url, 'PNG', 15, 10, 30, 30); } catch (_) {}
      headerY = 15;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(11, 19, 38);
    doc.text(profile?.name ?? 'Clínica', 105, headerY, { align: 'center' });
    if (profile?.cnpj) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`CNPJ: ${profile.cnpj}`, 105, headerY + 6, { align: 'center' });
    }
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(dateStr, 195, headerY, { align: 'right' });

    doc.setDrawColor(192, 193, 255);
    doc.line(15, 45, 195, 45);

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(27, 27, 100);
    doc.text(isVet ? 'RECEITA VETERINÁRIA' : 'RECEITA MÉDICA', 105, 55, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(50, 50, 80);
    doc.text(`${isVet ? 'Animal' : 'Paciente'}: ${subject.name}`, 15, 65);
    if (isVet && subject.species) {
      doc.text(`Espécie: ${subject.species}${subject.breed ? ' — ' + subject.breed : ''}`, 15, 71);
    }

    let y = isVet && subject.species ? 82 : 76;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Prescrição:', 15, y);
    y += 6;
    doc.setFont('helvetica', 'normal');

    this.items.forEach((item, i) => {
      if (y > 240) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold');
      doc.text(`${i + 1}. ${item.name}`, 15, y);
      doc.setFont('helvetica', 'normal');
      y += 5;
      if (item.dose)      { doc.text(`   Dose: ${item.dose}`, 15, y); y += 5; }
      if (item.frequency) { doc.text(`   Frequência: ${item.frequency}`, 15, y); y += 5; }
      if (item.duration)  { doc.text(`   Duração: ${item.duration}`, 15, y); y += 5; }
      if (item.notes)     { doc.text(`   Obs: ${item.notes}`, 15, y); y += 5; }
      y += 3;
    });

    if (this.notes) {
      y += 4;
      doc.setFont('helvetica', 'bold');
      doc.text('Observações:', 15, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(this.notes, 180);
      doc.text(lines, 15, y);
      y += lines.length * 5 + 5;
    }

    const sigY = Math.max(y + 20, 230);
    doc.line(15, sigY, 95, sigY);
    doc.setFontSize(9);
    doc.text(isVet ? 'Assinatura e CRMV' : 'Assinatura e CRM', 15, sigY + 5);

    doc.setFontSize(7);
    doc.setTextColor(120, 120, 140);
    doc.text(
      isVet
        ? 'Prescrição veterinária. Válida mediante avaliação clínica do profissional responsável.'
        : 'Prescrição médica. Válida mediante avaliação clínica do profissional responsável.',
      105, 280, { align: 'center' }
    );
    doc.text('GenomaFlow Clinical AI', 105, 284, { align: 'center' });

    this.pdfBlob = doc.output('blob');
    const formData = new FormData();
    formData.append('file', this.pdfBlob, `receita-${prescriptionId}.pdf`);

    this.http.post<{ id: string; pdf_url: string }>(
      `${environment.apiUrl}/prescriptions/${prescriptionId}/pdf`, formData
    ).subscribe({
      next: () => { this.saving.set(false); this.pdfReady.set(true); },
      error: () => { this.saving.set(false); this.pdfReady.set(true); }
    });
  }

  downloadPdf(): void {
    if (!this.pdfBlob) return;
    const url = URL.createObjectURL(this.pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receita-${this.data.subject.name.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  shareWhatsApp(): void {
    const name = this.data.subject.name;
    const date = new Date().toLocaleDateString('pt-BR');
    const text = encodeURIComponent(`Receita de ${name} - ${date}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }

  shareEmail(): void {
    this.snack.open('Envio por email será ativado em breve.', '', { duration: 3000 });
  }

  close(): void { this.dialogRef.close(); }
}
