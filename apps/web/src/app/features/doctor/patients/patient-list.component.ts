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
    <div class="page-container">
      <div class="flex justify-between items-center mb-4">
        <h1 class="text-2xl font-semibold">Pacientes</h1>
      </div>

      <mat-form-field class="w-full mb-4">
        <mat-label>Buscar paciente</mat-label>
        <input matInput [(ngModel)]="search" (ngModelChange)="applyFilter()" placeholder="Nome..." />
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>

      <table mat-table [dataSource]="filtered" class="w-full">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Nome</th>
          <td mat-cell *matCellDef="let p">{{ p.name }}</td>
        </ng-container>
        <ng-container matColumnDef="sex">
          <th mat-header-cell *matHeaderCellDef>Sexo</th>
          <td mat-cell *matCellDef="let p">{{ p.sex }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let p">
            <a mat-button [routerLink]="['/doctor/patients', p.id]">Ver perfil</a>
            <a mat-stroked-button [routerLink]="['/doctor/patients', p.id, 'exams']" class="ml-2">Novo exame</a>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns;" class="cursor-pointer hover:bg-gray-50"></tr>
      </table>
    </div>
  `
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
