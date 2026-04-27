import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatRadioModule } from '@angular/material/radio';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { AgendaService } from './agenda.service';
import { VALID_SLOT_MINUTES, AppointmentStatus } from './agenda.models';

interface SubjectModel {
  id: string;
  name: string;
  subject_type: 'human' | 'animal';
  species?: string;
  breed?: string;
  owner_name?: string;
}

export interface QuickCreateDialogData {
  start_at: string;          // ISO
  default_duration_minutes: number;
}

export type QuickCreateDialogResult = { created: true; subject_name?: string } | null;

@Component({
  selector: 'app-quick-create-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatAutocompleteModule, MatRadioModule,
  ],
  styles: [`
    :host { display:flex; flex-direction:column; max-height:85vh; color:#dae2fd; width:100%; max-width:420px; }
    @media (max-width: 639px) {
      :host { max-width: none; max-height: 100vh; height: 100vh; }
      .body { padding: 0.5rem 1rem 1rem; }
      .header { padding: 0.875rem 1rem 0.5rem; }
      .footer { padding: 0.625rem 1rem; flex-wrap: wrap; }
      .submit-btn { flex: 1; }
      .mode-row mat-radio-group { display: flex; flex-direction: column; gap: 0.25rem; }
      .mode-row mat-radio-button { margin-left: 0 !important; }
    }
    .header { padding:1rem 1.25rem 0.5rem; }
    h2 { font-family:'Space Grotesk',sans-serif; font-size:1rem; font-weight:700; margin:0; color:#c0c1ff; }
    .when { font-family:'JetBrains Mono',monospace; font-size:11px; color:#908fa0; margin-top:4px; letter-spacing:0.05em; }
    .body { padding:0.5rem 1.25rem 1rem; display:flex; flex-direction:column; gap:0.875rem; flex:1; min-height:0; overflow-y:auto; }
    .mode-row { display:flex; gap:0.75rem; padding:0.25rem 0 0.25rem; }
    .mode-row ::ng-deep .mdc-radio + label { color:#dae2fd !important; }
    .row-label { font-family:'JetBrains Mono',monospace; font-size:10px; text-transform:uppercase; color:#908fa0; letter-spacing:0.08em; margin-bottom:4px; }
    .full { width:100%; }
    .footer { display:flex; justify-content:flex-end; gap:0.5rem; padding:0.75rem 1.25rem; border-top:1px solid rgba(70,69,84,0.2); background:#0b1326; }
    .submit-btn {
      background:#c0c1ff; color:#1000a9; border:none; border-radius:6px;
      padding:0.5rem 1rem; font-size:0.75rem; font-weight:700;
      letter-spacing:0.06em; text-transform:uppercase; cursor:pointer;
    }
    .submit-btn:disabled { opacity:0.4; cursor:not-allowed; }
    .error { color:#ef4444; font-size:0.75rem; font-family:'JetBrains Mono',monospace; padding:0.5rem 0; }
    .autocomplete-result { display:flex; align-items:center; gap:0.5rem; }
    .autocomplete-result mat-icon { font-size:18px; width:18px; height:18px; color:#7c7b8f; }
  `],
  template: `
    <div class="header">
      <h2>{{ mode() === 'block' ? 'Bloquear horário' : (isVet() ? 'Novo atendimento' : 'Nova consulta') }}</h2>
      <div class="when">{{ formatStart() }}</div>
    </div>
    <div class="body">
      <div class="mode-row">
        <mat-radio-group [(ngModel)]="modeValue" (ngModelChange)="setMode($event)">
          <mat-radio-button value="appointment" color="primary">
            {{ isVet() ? 'Atendimento' : 'Consulta' }}
          </mat-radio-button>
          <mat-radio-button value="block" color="primary" style="margin-left:1rem">
            Bloquear horário
          </mat-radio-button>
        </mat-radio-group>
      </div>

      @if (mode() === 'appointment') {
        <div>
          <div class="row-label">{{ isVet() ? 'Animal' : 'Paciente' }}</div>
          <mat-form-field appearance="outline" class="full">
            <input matInput
                   [(ngModel)]="searchText"
                   (ngModelChange)="onSearch($event)"
                   [matAutocomplete]="auto"
                   [placeholder]="isVet() ? 'Buscar animal...' : 'Buscar paciente...'"/>
            <mat-autocomplete #auto="matAutocomplete"
                              [displayWith]="displayWith"
                              (optionSelected)="onSelectSubject($event.option.value)">
              @for (s of filtered(); track s.id) {
                <mat-option [value]="s">
                  <div class="autocomplete-result">
                    <mat-icon>{{ s.subject_type === 'animal' ? 'pets' : 'person' }}</mat-icon>
                    <span>{{ s.name }}</span>
                    @if (s.owner_name) { <small style="color:#7c7b8f">· Dono: {{ s.owner_name }}</small> }
                  </div>
                </mat-option>
              }
            </mat-autocomplete>
          </mat-form-field>
        </div>
      } @else {
        <div>
          <div class="row-label">Motivo do bloqueio</div>
          <mat-form-field appearance="outline" class="full">
            <input matInput [(ngModel)]="reason" placeholder="Ex: Congresso SBC, almoço, atestado..."/>
          </mat-form-field>
        </div>
      }

      <div>
        <div class="row-label">Duração</div>
        <mat-form-field appearance="outline" class="full">
          <mat-select [(ngModel)]="durationMinutes">
            @for (m of validSlots; track m) {
              <mat-option [value]="m">{{ m }} min</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      <div>
        <div class="row-label">Notas (opcional)</div>
        <mat-form-field appearance="outline" class="full">
          <textarea matInput [(ngModel)]="notes" rows="2"></textarea>
        </mat-form-field>
      </div>

      @if (errorMsg()) { <div class="error">{{ errorMsg() }}</div> }
    </div>
    <div class="footer">
      <button mat-button (click)="cancel()" [disabled]="submitting()">Cancelar</button>
      <button class="submit-btn" [disabled]="!canSubmit() || submitting()" (click)="submit()">
        {{ submitting() ? 'Salvando...' : 'Salvar' }}
      </button>
    </div>
  `,
})
export class QuickCreateDialogComponent {
  private ref = inject(MatDialogRef<QuickCreateDialogComponent, QuickCreateDialogResult>);
  private agenda = inject(AgendaService);
  private http = inject(HttpClient);
  auth = inject(AuthService);
  data: QuickCreateDialogData = inject(MAT_DIALOG_DATA);

  readonly validSlots = VALID_SLOT_MINUTES;

  mode = signal<'appointment' | 'block'>('appointment');
  modeValue = 'appointment';
  searchText = '';
  selectedSubject: SubjectModel | null = null;
  reason = '';
  notes = '';
  durationMinutes = this.data.default_duration_minutes;
  errorMsg = signal('');
  submitting = signal(false);

  private allSubjects = signal<SubjectModel[]>([]);

  filtered = computed<SubjectModel[]>(() => {
    const q = this.searchText.toLowerCase().trim();
    if (!q || typeof this.searchText !== 'string') return this.allSubjects().slice(0, 8);
    return this.allSubjects()
      .filter(p => p.name.toLowerCase().includes(q) || (p.owner_name ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  });

  isVet(): boolean { return this.auth.currentUser?.module === 'veterinary'; }

  constructor() {
    // Pré-carrega subjects pra autocomplete (mesma lógica do quick-search global)
    this.http.get<SubjectModel[]>(`${environment.apiUrl}/patients`).subscribe({
      next: list => this.allSubjects.set(list || []),
      error: () => {},
    });
  }

  setMode(m: 'appointment' | 'block') {
    this.mode.set(m);
    this.errorMsg.set('');
  }

  onSearch(text: string | SubjectModel) {
    if (typeof text !== 'string') {
      this.selectedSubject = text;
    } else {
      this.searchText = text;
      // Se digitou texto novo, invalida seleção anterior
      if (this.selectedSubject && text !== this.selectedSubject.name) {
        this.selectedSubject = null;
      }
    }
  }

  onSelectSubject(s: SubjectModel) {
    this.selectedSubject = s;
    this.searchText = s.name;
  }

  displayWith = (s: SubjectModel | null) => (s && typeof s !== 'string' ? s.name : (s as any) || '');

  formatStart(): string {
    const d = new Date(this.data.start_at);
    return d.toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  canSubmit(): boolean {
    if (this.mode() === 'block') return this.reason.trim().length > 0;
    return !!this.selectedSubject;
  }

  cancel() { this.ref.close(null); }

  submit() {
    if (!this.canSubmit()) return;
    this.submitting.set(true);
    this.errorMsg.set('');

    const body = this.mode() === 'block'
      ? {
          start_at: this.data.start_at,
          duration_minutes: this.durationMinutes,
          status: 'blocked' as AppointmentStatus,
          reason: this.reason.trim(),
          notes: this.notes.trim() || null,
        }
      : {
          start_at: this.data.start_at,
          duration_minutes: this.durationMinutes,
          status: 'scheduled' as AppointmentStatus,
          subject_id: this.selectedSubject!.id,
          notes: this.notes.trim() || null,
        };

    this.agenda.create(body).subscribe({
      next: () => {
        this.ref.close({
          created: true,
          subject_name: this.selectedSubject?.name,
        });
      },
      error: (err) => {
        this.submitting.set(false);
        const e = err.error || {};
        if (e.code === 'OVERLAP') {
          this.errorMsg.set('Esse horário já está ocupado por outro agendamento.');
        } else {
          this.errorMsg.set(e.error || 'Erro ao criar agendamento. Tente novamente.');
        }
      }
    });
  }
}
