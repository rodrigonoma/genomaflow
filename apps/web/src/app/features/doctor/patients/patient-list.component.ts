import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { environment } from '../../../../environments/environment';
import { Subject, Owner } from '../../../shared/models/api.models';
import { AuthService } from '../../../core/auth/auth.service';
import { formatCpf, formatPhone, formatCep, unmask } from '../../../shared/utils/mask';
import { lookupCep } from '../../../shared/utils/viacep';

@Component({
  selector: 'app-patient-list',
  standalone: true,
  imports: [
    RouterModule, FormsModule, AsyncPipe,
    MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule, MatTooltipModule
  ],
  styles: [`
    :host { display: block; background: #0b1326; min-height: 100vh; padding: 2rem; }

    .page-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 1.75rem;
    }
    .page-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.5rem; color: #dae2fd; margin: 0;
    }
    .header-actions { display: flex; gap: 8px; }

    .search-field { width: 100%; margin-bottom: 1.5rem; }

    .patients-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }

    .patient-card {
      background: #111929; border: 1px solid rgba(70,69,84,0.2);
      border-left: 3px solid rgba(192,193,255,0.4); border-radius: 8px;
      padding: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem;
      transition: border-color 150ms ease, background 150ms ease, transform 150ms ease;
      cursor: pointer;
    }
    .patient-card:hover {
      background: #131b2e;
      border-color: rgba(70,69,84,0.35);
      border-left-color: #c0c1ff;
      transform: translateY(-1px);
    }
    .patient-card.animal { border-left-color: rgba(74,214,160,0.4); }
    .patient-card.animal:hover { border-left-color: #4ad6a0; }

    .patient-name {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 0.9375rem; color: #dae2fd; margin: 0 0 0.25rem;
    }
    .patient-meta {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #7c7b8f; margin: 0; line-height: 1.6;
    }
    .cpf-tag {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #a09fb2; margin-top: 4px; letter-spacing: 0.04em;
    }
    .owner-tag {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #4ad6a0; margin-top: 4px; opacity: 0.9;
    }
    .weight-tag {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #f5c14a; opacity: 0.9;
    }

    .card-actions { display: flex; gap: 0.5rem; align-items: center; }
    .delete-btn { color: rgba(255,100,80,0.6) !important; margin-left: auto; transition: color 150ms ease !important; }
    .delete-btn:hover { color: #ff6450 !important; }
    .exam-btn { border-color: rgba(70,69,84,0.3) !important; color: #a09fb2 !important; font-size: 0.8rem; }

    .empty-state {
      grid-column: 1/-1; text-align: center;
      font-size: 14px; color: #7c7b8f; padding: 4rem 2rem;
    }

    /* ── FORM PANEL ── */
    .form-panel {
      background: #0e1420; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;
      animation: slideDown 180ms cubic-bezier(0.4,0,0.2,1);
    }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .form-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 0.9375rem; color: #dae2fd; margin-bottom: 1.25rem;
    }
    .field-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
    .field-trio { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
    .field-full { margin-bottom: 1rem; }
    mat-form-field { width: 100%; }
    .form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 0.5rem; }

    .section-divider {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.18em; color: #6e6d80;
      margin: 1rem 0 0.75rem; border-bottom: 1px solid rgba(70,69,84,0.18);
      padding-bottom: 0.5rem;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
  `],
  template: `
    <div class="patients-page">
      <div class="page-header">
        @if ((auth.currentUser$ | async); as user) {
          <h1 class="page-title">{{ user.module === 'veterinary' ? 'Animais' : 'Pacientes' }}</h1>
          <div class="header-actions">
            @if (user.module === 'veterinary') {
              <button mat-stroked-button (click)="toggleOwnerForm()">
                <mat-icon>person_add</mat-icon> Novo dono
              </button>
            }
            <button mat-flat-button style="background:#c0c1ff;color:#1000a9;font-weight:700"
                    (click)="togglePatientForm()">
              <mat-icon>add</mat-icon> {{ user.module === 'veterinary' ? 'Novo animal' : 'Novo paciente' }}
            </button>
          </div>
        }
      </div>

      <!-- ── NEW OWNER FORM ── -->
      @if (showOwnerForm()) {
        <div class="form-panel">
          <div class="form-title">Cadastrar dono / tutor</div>
          <div class="field-pair">
            <mat-form-field appearance="outline">
              <mat-label>Nome completo *</mat-label>
              <input matInput [(ngModel)]="ownerForm.name"/>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>CPF</mat-label>
              <input matInput [ngModel]="ownerForm.cpf ?? ''"
                     (ngModelChange)="ownerForm.cpf = onCpfInput($event)"
                     placeholder="000.000.000-00" inputmode="numeric"/>
            </mat-form-field>
          </div>
          <div class="field-pair">
            <mat-form-field appearance="outline">
              <mat-label>Telefone</mat-label>
              <input matInput [ngModel]="ownerForm.phone ?? ''"
                     (ngModelChange)="ownerForm.phone = onPhoneInput($event)"
                     placeholder="(00) 00000-0000" inputmode="tel"/>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>E-mail</mat-label>
              <input matInput [(ngModel)]="ownerForm.email" type="email"/>
            </mat-form-field>
          </div>

          <div class="section-divider">Endereço</div>
          <div class="field-trio">
            <mat-form-field appearance="outline">
              <mat-label>CEP</mat-label>
              <input matInput [ngModel]="ownerForm.cep ?? ''"
                     (ngModelChange)="ownerForm.cep = onCepInput($event)"
                     (blur)="onCepBlur()"
                     placeholder="00000-000" inputmode="numeric"/>
              @if (cepLoading()) {
                <mat-icon matSuffix style="animation: spin 1s linear infinite">sync</mat-icon>
              }
            </mat-form-field>
            <mat-form-field appearance="outline" style="grid-column: span 2">
              <mat-label>Logradouro</mat-label>
              <input matInput [(ngModel)]="ownerForm.street" readonly/>
            </mat-form-field>
          </div>
          <div class="field-trio">
            <mat-form-field appearance="outline">
              <mat-label>Número</mat-label>
              <input matInput [(ngModel)]="ownerForm.number" placeholder="123 ou s/n"/>
            </mat-form-field>
            <mat-form-field appearance="outline" style="grid-column: span 2">
              <mat-label>Complemento</mat-label>
              <input matInput [(ngModel)]="ownerForm.complement" placeholder="Apto 4, bloco B..."/>
            </mat-form-field>
          </div>
          <div class="field-trio">
            <mat-form-field appearance="outline">
              <mat-label>Bairro</mat-label>
              <input matInput [(ngModel)]="ownerForm.neighborhood" readonly/>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Cidade</mat-label>
              <input matInput [(ngModel)]="ownerForm.city" readonly/>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>UF</mat-label>
              <input matInput [(ngModel)]="ownerForm.state" maxlength="2" readonly/>
            </mat-form-field>
          </div>

          @if (cepError()) {
            <p style="color:#ffb4ab;font-size:12px;margin:0.25rem 0 0.75rem 0;">{{ cepError() }}</p>
          }

          <div class="form-actions">
            <button mat-button (click)="showOwnerForm.set(false)">Cancelar</button>
            <button mat-flat-button style="background:#4ad6a0;color:#0b1326;font-weight:700"
                    (click)="saveOwner()">
              Salvar dono
            </button>
          </div>
        </div>
      }

      <!-- ── NEW PATIENT FORM ── -->
      @if (showPatientForm()) {
        @if ((auth.currentUser$ | async); as user) {
          <div class="form-panel">
            <div class="form-title">
              {{ user.module === 'veterinary' ? 'Cadastrar animal' : 'Cadastrar paciente' }}
            </div>

            @if (user.module === 'human') {
              <div class="field-pair">
                <mat-form-field appearance="outline">
                  <mat-label>Nome completo *</mat-label>
                  <input matInput [(ngModel)]="patientForm.name"/>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Data de nascimento *</mat-label>
                  <input matInput type="date" [(ngModel)]="patientForm.birth_date"/>
                </mat-form-field>
              </div>
              <div class="field-trio">
                <mat-form-field appearance="outline">
                  <mat-label>Sexo *</mat-label>
                  <mat-select [(ngModel)]="patientForm.sex">
                    <mat-option value="M">Masculino</mat-option>
                    <mat-option value="F">Feminino</mat-option>
                    <mat-option value="other">Outro</mat-option>
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Telefone</mat-label>
                  <input matInput [ngModel]="patientForm.phone ?? ''"
                         (ngModelChange)="patientForm.phone = onPhoneInput($event)"
                         placeholder="(00) 00000-0000" inputmode="tel"/>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>CPF</mat-label>
                  <input matInput [ngModel]="patientForm.cpf ?? ''"
                         (ngModelChange)="patientForm.cpf = onCpfInput($event)"
                         placeholder="000.000.000-00" inputmode="numeric"/>
                </mat-form-field>
              </div>
              <div class="section-divider">Dados clínicos (opcional)</div>
              <div class="field-trio">
                <mat-form-field appearance="outline">
                  <mat-label>Peso (kg)</mat-label>
                  <input matInput type="number" step="0.1" [(ngModel)]="patientForm.weight"/>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Altura (cm)</mat-label>
                  <input matInput type="number" [(ngModel)]="patientForm.height"/>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Tipo sanguíneo</mat-label>
                  <mat-select [(ngModel)]="patientForm.blood_type">
                    @for (t of bloodTypes; track t) {
                      <mat-option [value]="t">{{ t }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              </div>
              <div class="field-pair">
                <mat-form-field appearance="outline">
                  <mat-label>Alergias</mat-label>
                  <textarea matInput rows="2" [(ngModel)]="patientForm.allergies"></textarea>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Comorbidades</mat-label>
                  <textarea matInput rows="2" [(ngModel)]="patientForm.comorbidities"></textarea>
                </mat-form-field>
              </div>
            }

            @if (user.module === 'veterinary') {
              <div class="field-pair">
                <mat-form-field appearance="outline">
                  <mat-label>Nome do animal *</mat-label>
                  <input matInput [(ngModel)]="patientForm.name"/>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Espécie *</mat-label>
                  <mat-select [(ngModel)]="patientForm.species">
                    <mat-option value="dog">Cão</mat-option>
                    <mat-option value="cat">Gato</mat-option>
                    <mat-option value="equine">Equino</mat-option>
                    <mat-option value="bovine">Bovino</mat-option>
                    <mat-option value="bird">Ave</mat-option>
                    <mat-option value="reptile">Réptil</mat-option>
                    <mat-option value="other">Outro</mat-option>
                  </mat-select>
                </mat-form-field>
              </div>
              <div class="field-trio">
                <mat-form-field appearance="outline">
                  <mat-label>Sexo *</mat-label>
                  <mat-select [(ngModel)]="patientForm.sex">
                    <mat-option value="M">Macho</mat-option>
                    <mat-option value="F">Fêmea</mat-option>
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Raça</mat-label>
                  <input matInput [(ngModel)]="patientForm.breed"/>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Data de nascimento</mat-label>
                  <input matInput type="date" [(ngModel)]="patientForm.birth_date"/>
                </mat-form-field>
              </div>
              <div class="field-trio">
                <mat-form-field appearance="outline">
                  <mat-label>Dono / tutor</mat-label>
                  <mat-select [(ngModel)]="patientForm.owner_id">
                    <mat-option [value]="null">— sem vínculo —</mat-option>
                    @for (o of owners(); track o.id) {
                      <mat-option [value]="o.id">{{ o.name }}{{ o.cpf_last4 ? ' (***' + o.cpf_last4 + ')' : '' }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Peso (kg)</mat-label>
                  <input matInput type="number" step="0.1" [(ngModel)]="patientForm.weight"/>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Microchip</mat-label>
                  <input matInput [(ngModel)]="patientForm.microchip"/>
                </mat-form-field>
              </div>
              <div class="field-pair">
                <mat-form-field appearance="outline">
                  <mat-label>Alergias</mat-label>
                  <textarea matInput rows="2" [(ngModel)]="patientForm.allergies"></textarea>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Observações</mat-label>
                  <textarea matInput rows="2" [(ngModel)]="patientForm.notes"></textarea>
                </mat-form-field>
              </div>
            }

            @if (formError()) {
              <p style="color:#ffb4ab;font-size:13px;margin-bottom:0.5rem">{{ formError() }}</p>
            }
            <div class="form-actions">
              <button mat-button (click)="showPatientForm.set(false)">Cancelar</button>
              <button mat-flat-button style="background:#c0c1ff;color:#1000a9;font-weight:700"
                      (click)="savePatient()">
                Salvar
              </button>
            </div>
          </div>
        }
      }

      <!-- ── SEARCH ── -->
      <mat-form-field appearance="outline" class="search-field">
        <mat-label>Buscar por nome</mat-label>
        <input matInput [(ngModel)]="search" (ngModelChange)="applyFilter()" placeholder="Nome..."/>
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>

      <!-- ── LIST ── -->
      <div class="patients-grid">
        @for (p of filtered; track p.id) {
          <div class="patient-card" [class.animal]="p.subject_type === 'animal'"
               [routerLink]="['/doctor/patients', p.id]" role="link" tabindex="0">
            <div>
              <h3 class="patient-name">{{ p.name }}</h3>
              <p class="patient-meta">
                {{ p.sex }}
                @if (p.species) { · {{ speciesLabel(p.species) }} }
                @if (p.breed) { · {{ p.breed }} }
                @if (p.birth_date) { · {{ p.birth_date }} }
              </p>
              @if (p.cpf_last4) {
                <div class="cpf-tag">CPF ***{{ p.cpf_last4 }}</div>
              }
              @if (p.weight) {
                <div class="weight-tag">{{ p.weight }} kg</div>
              }
              @if (p.owner_name) {
                <div class="owner-tag">
                  Dono: {{ p.owner_name }}
                  @if (p.owner_cpf_last4) { · CPF ***{{ p.owner_cpf_last4 }} }
                </div>
              }
            </div>
            <div class="card-actions" (click)="$event.stopPropagation()">
              <a mat-stroked-button class="exam-btn" [routerLink]="['/doctor/patients', p.id, 'exams']">Novo exame</a>
              <button mat-icon-button class="delete-btn" (click)="deletePatient(p.id, p.name, $event)" matTooltip="Excluir">
                <mat-icon>delete_outline</mat-icon>
              </button>
            </div>
          </div>
        }
        @if (filtered.length === 0) {
          <p class="empty-state">Nenhum registro encontrado.</p>
        }
      </div>
    </div>
  `
})
export class PatientListComponent implements OnInit {
  private http = inject(HttpClient);
  auth = inject(AuthService);

  subjects: Subject[] = [];
  filtered: Subject[] = [];
  owners   = signal<Owner[]>([]);
  search   = '';

  showPatientForm = signal(false);
  showOwnerForm   = signal(false);
  formError       = signal('');
  cepLoading      = signal(false);
  cepError        = signal('');

  readonly bloodTypes = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];

  patientForm: {
    name?: string; birth_date?: string; sex?: string; phone?: string; cpf?: string;
    weight?: number; height?: number; blood_type?: string; allergies?: string;
    comorbidities?: string; notes?: string;
    species?: string; breed?: string; microchip?: string; owner_id?: string | null;
  } = {};

  ownerForm: {
    name?: string; cpf?: string; phone?: string; email?: string; notes?: string;
    cep?: string; street?: string; number?: string; complement?: string;
    neighborhood?: string; city?: string; state?: string;
  } = {};

  ngOnInit(): void {
    this.loadSubjects();
    this.loadOwners();
  }

  private loadSubjects(): void {
    this.http.get<Subject[]>(`${environment.apiUrl}/patients`).subscribe({
      next: s => { this.subjects = s; this.filtered = s; },
      error: () => {}
    });
  }

  private loadOwners(): void {
    this.http.get<Owner[]>(`${environment.apiUrl}/patients/owners`).subscribe(
      o => this.owners.set(o),
      () => {}
    );
  }

  applyFilter(): void {
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const q = norm(this.search);
    this.filtered = this.subjects.filter(s =>
      norm(s.name).includes(q) || norm(s.owner_name ?? '').includes(q)
    );
  }

  togglePatientForm(): void {
    this.showPatientForm.update(v => !v);
    this.patientForm = {};
    this.formError.set('');
  }

  toggleOwnerForm(): void {
    this.showOwnerForm.update(v => !v);
    this.ownerForm = {};
    this.cepError.set('');
    this.cepLoading.set(false);
  }

  onCpfInput(v: string): string   { return formatCpf(v); }
  onPhoneInput(v: string): string { return formatPhone(v); }
  onCepInput(v: string): string   { return formatCep(v); }

  onCepBlur(): void {
    const digits = unmask(this.ownerForm.cep);
    if (digits.length !== 8) return;
    this.cepError.set('');
    this.cepLoading.set(true);
    lookupCep(this.http, digits).subscribe(addr => {
      this.cepLoading.set(false);
      if (!addr) {
        this.cepError.set('CEP não encontrado. Preencha manualmente ou verifique o número.');
        return;
      }
      this.ownerForm.street       = addr.street;
      this.ownerForm.neighborhood = addr.neighborhood;
      this.ownerForm.city         = addr.city;
      this.ownerForm.state        = addr.state;
    });
  }

  saveOwner(): void {
    if (!this.ownerForm.name) { return; }
    const payload = {
      ...this.ownerForm,
      cpf:   this.ownerForm.cpf   ? unmask(this.ownerForm.cpf)   : null,
      phone: this.ownerForm.phone ? unmask(this.ownerForm.phone) : null,
      cep:   this.ownerForm.cep   ? unmask(this.ownerForm.cep)   : null,
    };
    this.http.post<Owner>(`${environment.apiUrl}/patients/owners`, payload)
      .subscribe(o => {
        this.owners.update(list => [...list, o]);
        this.showOwnerForm.set(false);
      });
  }

  savePatient(): void {
    this.formError.set('');
    const payload = {
      ...this.patientForm,
      cpf:   this.patientForm.cpf   ? unmask(this.patientForm.cpf)   : null,
      phone: this.patientForm.phone ? unmask(this.patientForm.phone) : null,
    };
    this.http.post<Subject>(`${environment.apiUrl}/patients`, payload)
      .subscribe({
        next: s => {
          this.subjects = [s, ...this.subjects];
          this.filtered = [s, ...this.filtered];
          this.showPatientForm.set(false);
          this.patientForm = {};
        },
        error: (err: any) => this.formError.set(err.error?.error ?? 'Erro ao salvar')
      });
  }

  deletePatient(id: string, name: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm(`Arquivar "${name}"? O registro será desativado e não aparecerá mais na lista. O histórico clínico é preservado.`)) return;
    this.http.delete(`${environment.apiUrl}/patients/${id}`).subscribe({
      next: () => {
        this.subjects = this.subjects.filter(s => s.id !== id);
        this.filtered = this.filtered.filter(s => s.id !== id);
      },
      error: (err: any) => alert(err.error?.error ?? 'Erro ao excluir paciente')
    });
  }

  speciesLabel(species: string): string {
    const labels: Record<string, string> = {
      dog: 'Cão', cat: 'Gato', equine: 'Equino',
      bovine: 'Bovino', bird: 'Ave', reptile: 'Réptil', other: 'Outro'
    };
    return labels[species] ?? species;
  }
}
