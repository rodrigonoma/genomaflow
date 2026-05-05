import { Component, Input, OnInit, OnChanges, signal, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VaccinesService, Vaccine, VaccineProtocol } from './vaccines.service';

/**
 * Aba "Vacinas" do patient-detail (vet only).
 * Lista vacinas aplicadas + form pra registrar nova.
 *
 * Spec: docs/superpowers/specs/2026-05-05-clinical-pms-expansion-design.md (Fase 2)
 */
@Component({
  selector: 'app-vaccines-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  template: `
    <div class="vaccines-wrap">
      @if (showForm()) {
        <form class="vaccine-form" (submit)="onSubmit($event)">
          <h3>Registrar vacina aplicada</h3>
          <div class="grid">
            <label>
              Vacina
              <input type="text" [(ngModel)]="form.vaccine_name" name="vaccine_name" required />
            </label>
            <label>
              Protocolo
              <select [(ngModel)]="form.protocol_id" name="protocol_id">
                <option [ngValue]="null">— sem protocolo —</option>
                @for (p of protocols(); track p.id) {
                  <option [ngValue]="p.id">{{ p.name }} ({{ p.species }})</option>
                }
              </select>
            </label>
            <label>
              Aplicada em
              <input type="date" [(ngModel)]="form.applied_at" name="applied_at" required />
            </label>
            <label>
              Próxima dose
              <input type="date" [(ngModel)]="form.next_dose_date" name="next_dose_date" />
            </label>
            <label>
              Fabricante
              <input type="text" [(ngModel)]="form.manufacturer" name="manufacturer" />
            </label>
            <label>
              Lote
              <input type="text" [(ngModel)]="form.lot_number" name="lot_number" />
            </label>
          </div>
          <label class="full">
            Observações
            <textarea rows="2" [(ngModel)]="form.notes" name="notes"></textarea>
          </label>
          @if (errorMsg()) { <p class="error">{{ errorMsg() }}</p> }
          <div class="actions">
            <button type="button" (click)="cancelForm()" [disabled]="saving()">Cancelar</button>
            <button type="submit" [disabled]="saving()">{{ saving() ? 'Salvando…' : 'Registrar' }}</button>
          </div>
        </form>
      } @else {
        <div class="vaccines-actions">
          <button class="primary" (click)="showForm.set(true)">+ Registrar vacina</button>
        </div>
      }

      <h3 style="margin-top:16px;">Carteira de vacinação</h3>
      @if (loading()) {
        <p class="muted">Carregando…</p>
      } @else if (vaccines().length === 0) {
        <p class="muted">Sem vacinas registradas para este animal.</p>
      } @else {
        <ul class="list">
          @for (v of vaccines(); track v.id) {
            <li class="vaccine">
              <div class="head">
                <strong>{{ v.vaccine_name }}</strong>
                @if (v.protocol_name) {
                  <span class="proto">{{ v.protocol_name }}</span>
                }
              </div>
              <div class="meta">
                <span>Aplicada {{ v.applied_at | date:'dd/MM/yyyy' }}</span>
                @if (v.next_dose_date) {
                  <span class="next" [class.overdue]="isOverdue(v.next_dose_date)">
                    Próxima: {{ v.next_dose_date | date:'dd/MM/yyyy' }}
                  </span>
                }
                @if (v.manufacturer) { <span>{{ v.manufacturer }}</span> }
                @if (v.lot_number) { <span>Lote {{ v.lot_number }}</span> }
              </div>
              @if (v.notes) { <p class="notes">{{ v.notes }}</p> }
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .vaccines-wrap { padding: 16px 0; }
    .muted { color: #c7c5d0; font-size: 0.875rem; }
    h3 { color: #c0c1ff; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.1em;
         font-family: 'JetBrains Mono', monospace; margin: 0 0 12px 0; }
    .vaccines-actions button.primary, .actions button[type="submit"] {
      padding: 8px 16px; background: #c0c1ff; color: #4b4d83;
      font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 0.75rem;
      letter-spacing: 0.1em; text-transform: uppercase; border: none; border-radius: 4px;
      cursor: pointer;
    }
    .actions button[type="button"] { padding: 8px 16px; background: #2a3148; color: #c7c5d0;
      border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem;
      text-transform: uppercase; letter-spacing: 0.1em; font-family: 'Space Grotesk', sans-serif; }
    .vaccine-form { background: #171f33; border-radius: 6px; padding: 16px; margin-bottom: 16px; }
    .vaccine-form .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-top: 8px; }
    label { display: flex; flex-direction: column; gap: 3px; font-size: 0.75rem; color: #c7c5d0; }
    label.full { grid-column: 1 / -1; margin-top: 8px; }
    input, select, textarea { padding: 8px; background: #060d20; border: 1px solid #2a3148;
      color: #dbe2fd; border-radius: 4px; font-family: inherit; font-size: 0.875rem; }
    .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; }
    .error { color: #ffb4ab; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; }
    .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .vaccine { background: #171f33; border-left: 2px solid #88d8b0; padding: 12px 16px; border-radius: 0 4px 4px 0; }
    .head { display: flex; gap: 12px; align-items: center; }
    .head strong { color: #dbe2fd; }
    .proto { font-size: 0.625rem; color: #c0c1ff; text-transform: uppercase; letter-spacing: 0.1em;
             font-family: 'JetBrains Mono', monospace; padding: 2px 6px; background: rgba(192,193,255,0.1); border-radius: 3px; }
    .meta { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px; font-size: 0.75rem;
            color: #c7c5d0; font-family: 'JetBrains Mono', monospace; }
    .next.overdue { color: #ff6b6b; }
    .notes { margin-top: 6px; font-size: 0.875rem; color: #dbe2fd; }
  `]
})
export class VaccinesTabComponent implements OnInit, OnChanges {
  @Input({ required: true }) subjectId!: string;
  @Input() species: string | null = null;

  private vaccinesService = inject(VaccinesService);

  vaccines = signal<Vaccine[]>([]);
  protocols = signal<VaccineProtocol[]>([]);
  loading = signal(false);
  saving = signal(false);
  showForm = signal(false);
  errorMsg = signal('');

  form: any = {
    vaccine_name: '',
    protocol_id: null,
    applied_at: new Date().toISOString().slice(0, 10),
    next_dose_date: '',
    manufacturer: '',
    lot_number: '',
    notes: '',
  };

  ngOnInit() { this.refresh(); this.loadProtocols(); }
  ngOnChanges() { this.refresh(); this.loadProtocols(); }

  refresh() {
    if (!this.subjectId) return;
    this.loading.set(true);
    this.vaccinesService.listForSubject(this.subjectId).subscribe({
      next: r => { this.vaccines.set(r.items); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  loadProtocols() {
    this.vaccinesService.listProtocols(this.species || undefined).subscribe({
      next: r => this.protocols.set(r.items),
      error: () => {},
    });
  }

  isOverdue(iso: string): boolean {
    return new Date(iso) < new Date();
  }

  cancelForm() {
    this.showForm.set(false);
    this.errorMsg.set('');
    this.form = {
      vaccine_name: '', protocol_id: null,
      applied_at: new Date().toISOString().slice(0, 10),
      next_dose_date: '', manufacturer: '', lot_number: '', notes: '',
    };
  }

  onSubmit(ev: Event) {
    ev.preventDefault();
    this.errorMsg.set('');
    this.saving.set(true);
    const payload = {
      subject_id: this.subjectId,
      vaccine_name: this.form.vaccine_name,
      applied_at: this.form.applied_at,
      next_dose_date: this.form.next_dose_date || null,
      manufacturer: this.form.manufacturer || null,
      lot_number: this.form.lot_number || null,
      protocol_id: this.form.protocol_id,
      notes: this.form.notes || null,
    };
    this.vaccinesService.create(payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelForm();
        this.refresh();
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMsg.set(err?.error?.error ?? 'Erro ao registrar vacina');
      },
    });
  }
}
