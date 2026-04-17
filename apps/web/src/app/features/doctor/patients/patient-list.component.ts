import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../../environments/environment';
import { Subject } from '../../../shared/models/api.models';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-patient-list',
  standalone: true,
  imports: [
    RouterModule, FormsModule, AsyncPipe,
    MatTableModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule
  ],
  template: `
    <div class="patients-page">
      <div class="page-header">
        @if ((auth.currentUser$ | async); as user) {
          <h1 class="page-title">{{ user.module === 'veterinary' ? 'Animais' : 'Pacientes' }}</h1>
        }
      </div>

      <mat-form-field appearance="outline" class="search-field">
        <mat-label>Buscar {{ (auth.currentUser$ | async)?.module === 'veterinary' ? 'animal' : 'paciente' }}</mat-label>
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
                @if (p.species) {
                  <span> · {{ speciesLabel(p.species) }}</span>
                }
                @if (p.birth_date) {
                  <span> · {{ p.birth_date }}</span>
                }
              </p>
            </div>
            <div class="card-actions">
              <a mat-button class="detail-btn" [routerLink]="['/doctor/patients', p.id]">Ver detalhes</a>
              <a mat-stroked-button class="exam-btn" [routerLink]="['/doctor/patients', p.id, 'exams']">Novo exame</a>
            </div>
          </div>
        }
        @if (filtered.length === 0) {
          <p class="empty-state">Nenhum registro encontrado.</p>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; background: #0b1326; min-height: 100vh; padding: 2rem; }
    .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
    .page-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 1.5rem; color: #dae2fd; margin: 0; }
    .search-field { width: 100%; margin-bottom: 1.5rem; }
    .patients-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
    .patient-card { background: #131b2e; border: 1px solid rgba(70,69,84,0.15); border-left: 4px solid #c0c1ff; border-radius: 8px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .patient-name { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 1rem; color: #dae2fd; margin: 0 0 0.25rem 0; }
    .patient-meta { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #908fa0; margin: 0; }
    .card-actions { display: flex; gap: 0.5rem; }
    .detail-btn { border: 1px solid rgba(70,69,84,0.3) !important; color: #c0c1ff !important; font-size: 0.8rem; }
    .exam-btn { border-color: rgba(70,69,84,0.3) !important; color: #908fa0 !important; font-size: 0.8rem; }
    .empty-state { grid-column: 1/-1; text-align: center; font-family: 'Inter', sans-serif; font-size: 14px; color: #908fa0; padding: 2rem; }
  `]
})
export class PatientListComponent implements OnInit {
  private http = inject(HttpClient);
  auth = inject(AuthService);
  subjects: Subject[] = [];
  filtered: Subject[] = [];
  search = '';

  ngOnInit(): void {
    this.http.get<Subject[]>(`${environment.apiUrl}/patients`).subscribe(s => {
      this.subjects = s;
      this.filtered = s;
    });
  }

  applyFilter(): void {
    this.filtered = this.subjects.filter(s =>
      s.name.toLowerCase().includes(this.search.toLowerCase())
    );
  }

  speciesLabel(species: string): string {
    const labels: Record<string, string> = { dog: 'Cão', cat: 'Gato', equine: 'Equino', bovine: 'Bovino' };
    return labels[species] ?? species;
  }
}
