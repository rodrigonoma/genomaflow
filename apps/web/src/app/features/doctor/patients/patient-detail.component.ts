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
    <div class="page-container">
      @if (patient) {
        <div class="flex justify-between items-start mb-6">
          <div>
            <h1 class="text-2xl font-semibold">{{ patient.name }}</h1>
            <p class="text-gray-600">
              Sexo: {{ patient.sex }} &nbsp;|&nbsp;
              Nascimento: {{ patient.birth_date | date:'dd/MM/yyyy' }}
            </p>
          </div>
          <a mat-flat-button color="primary"
             [routerLink]="['/doctor/patients', patient.id, 'exams']">
            Enviar novo exame
          </a>
        </div>

        <h2 class="text-lg font-medium mb-3">Histórico de exames</h2>
        @for (exam of exams; track exam.id) {
          <app-exam-card [exam]="exam" />
        }
        @if (exams.length === 0) {
          <p class="text-gray-500">Nenhum exame encontrado.</p>
        }
      }
    </div>
  `
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
