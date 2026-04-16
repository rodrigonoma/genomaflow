import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../../environments/environment';
import { Patient } from '../../../shared/models/api.models';

@Component({
  selector: 'app-patient-list',
  standalone: true,
  imports: [
    RouterModule, FormsModule,
    MatTableModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule
  ],
  template: `
    <div class="patients-page">
      <div class="page-header">
        <h1 class="page-title">Pacientes</h1>
      </div>

      <mat-form-field appearance="outline" class="search-field">
        <mat-label>Buscar paciente</mat-label>
        <input matInput [(ngModel)]="search" (ngModelChange)="applyFilter()" placeholder="Nome..." />
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>

      <div class="patients-grid">
        @for (p of filtered; track p.id) {
          <div class="patient-card">
            <div class="card-body">
              <h3 class="patient-name">{{ p.name }}</h3>
              <p class="patient-meta">
                <span>{{ p.sex }}</span>
                @if (p.birth_date) {
                  <span> · {{ p.birth_date }}</span>
                }
              </p>
              @if (p.cpf_hash) {
                <p class="patient-cpf">{{ p.cpf_hash }}</p>
              }
            </div>
            <div class="card-actions">
              <a mat-button class="detail-btn" [routerLink]="['/doctor/patients', p.id]">Ver detalhes</a>
              <a mat-stroked-button class="exam-btn" [routerLink]="['/doctor/patients', p.id, 'exams']">Novo exame</a>
            </div>
          </div>
        }
        @if (filtered.length === 0) {
          <p class="empty-state">Nenhum paciente encontrado.</p>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      background: #0b1326;
      min-height: 100vh;
      padding: 2rem;
    }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }

    .page-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 1.5rem;
      color: #dae2fd;
      margin: 0;
    }

    .search-field {
      width: 100%;
      margin-bottom: 1.5rem;
    }

    .patients-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }

    .patient-card {
      background: #131b2e;
      border: 1px solid rgba(70, 69, 84, 0.15);
      border-left: 4px solid #c0c1ff;
      border-radius: 8px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .card-body {
      flex: 1;
    }

    .patient-name {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 1rem;
      color: #dae2fd;
      margin: 0 0 0.25rem 0;
    }

    .patient-meta {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #908fa0;
      margin: 0 0 0.25rem 0;
    }

    .patient-cpf {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: #464554;
      margin: 0;
    }

    .card-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .detail-btn {
      border: 1px solid rgba(70, 69, 84, 0.3) !important;
      color: #c0c1ff !important;
      font-size: 0.8rem;
      transition: background 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .detail-btn:hover {
      background: #222a3d !important;
    }

    .exam-btn {
      border-color: rgba(70, 69, 84, 0.3) !important;
      color: #908fa0 !important;
      font-size: 0.8rem;
    }

    .empty-state {
      grid-column: 1 / -1;
      text-align: center;
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      color: #908fa0;
      padding: 2rem;
    }
  `]
})
export class PatientListComponent implements OnInit {
  private http = inject(HttpClient);
  patients: Patient[] = [];
  filtered: Patient[] = [];
  search = '';
  columns = ['name', 'sex', 'actions'];

  ngOnInit(): void {
    this.http.get<Patient[]>(`${environment.apiUrl}/patients`).subscribe(p => {
      this.patients = p;
      this.filtered = p;
    });
  }

  applyFilter(): void {
    this.filtered = this.patients.filter(p =>
      p.name.toLowerCase().includes(this.search.toLowerCase())
    );
  }
}
