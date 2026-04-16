import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { ExamCardComponent } from '../../../shared/components/exam-card/exam-card.component';
import { environment } from '../../../../environments/environment';
import { Patient, Exam } from '../../../shared/models/api.models';

@Component({
  selector: 'app-patient-detail',
  standalone: true,
  imports: [RouterModule, DatePipe, MatCardModule, MatButtonModule, ExamCardComponent],
  template: `
    <div class="patient-detail-page">
      @if (patient) {
        <div class="patient-header">
          <div class="header-info">
            <h1 class="patient-name">{{ patient.name }}</h1>
            <p class="patient-meta">
              <span>Sexo: {{ patient.sex }}</span>
              @if (patient.birth_date) {
                <span> · Nascimento: {{ patient.birth_date | date:'dd/MM/yyyy' }}</span>
              }
            </p>
          </div>
          <a mat-flat-button class="new-exam-btn"
             [routerLink]="['/doctor/patients', patient.id, 'exams']">
            Novo Exame
          </a>
        </div>

        <div class="exams-section">
          <h2 class="section-title">Histórico de Exames</h2>
          @for (exam of exams; track exam.id) {
            <div class="exam-card" [class]="'status-border-' + exam.status">
              <app-exam-card [exam]="exam" />
            </div>
          }
          @if (exams.length === 0) {
            <p class="empty-state">Nenhum exame encontrado.</p>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      background: #0b1326;
      min-height: 100vh;
      padding: 2rem;
    }

    .patient-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 2rem;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .patient-name {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 1.5rem;
      color: #dae2fd;
      margin: 0 0 0.25rem 0;
    }

    .patient-meta {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #c7c4d7;
      margin: 0;
    }

    .new-exam-btn {
      background: #c0c1ff !important;
      color: #1000a9 !important;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .section-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 1rem;
      color: #dae2fd;
      margin: 0 0 1rem 0;
    }

    .exams-section {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .exam-card {
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 0.75rem;
    }

    .exam-card.status-border-done { border-left: 4px solid #10b981; }
    .exam-card.status-border-processing { border-left: 4px solid #c0c1ff; }
    .exam-card.status-border-error { border-left: 4px solid #ffb4ab; }
    .exam-card.status-border-pending { border-left: 4px solid #908fa0; }

    .empty-state {
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      color: #908fa0;
      padding: 2rem;
      text-align: center;
    }
  `]
})
export class PatientDetailComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  patient: Patient | null = null;
  exams: Exam[] = [];

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.http.get<Patient>(`${environment.apiUrl}/patients/${id}`)
      .subscribe(p => this.patient = p);
    // Backend returns all tenant exams; filter by patient_id client-side
    this.http.get<Exam[]>(`${environment.apiUrl}/exams`)
      .subscribe(all => this.exams = all.filter((e: any) => e.patient_id === id));
  }
}
