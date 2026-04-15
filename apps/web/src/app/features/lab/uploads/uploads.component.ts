import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { WsService } from '../../../core/ws/ws.service';
import { ExamStatusComponent } from '../../../shared/components/exam-status/exam-status.component';
import { environment } from '../../../../environments/environment';
import { Patient, Exam } from '../../../shared/models/api.models';

interface QueueEntry {
  exam_id: string;
  filename: string;
  patient_name: string;
  patient_id: string;
  status: Exam['status'];
  agents: string;
  created_at: string;
  error_message?: string;
}

@Component({
  selector: 'app-uploads',
  standalone: true,
  imports: [
    FormsModule, DatePipe, RouterModule,
    MatTabsModule, MatTableModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatTooltipModule, MatIconModule, ExamStatusComponent
  ],
  template: `
    <div class="page-container">
      <h1 class="text-2xl font-semibold mb-6">Upload de Exames</h1>

      <mat-tab-group class="mb-8">
        <mat-tab label="Individual">
          <div class="p-4">
            <mat-form-field class="w-full mb-3">
              <mat-label>Buscar paciente</mat-label>
              <input matInput [(ngModel)]="patientSearch" (ngModelChange)="searchPatients()" />
            </mat-form-field>

            @if (patientResults.length) {
              <mat-form-field class="w-full mb-3">
                <mat-label>Selecionar paciente</mat-label>
                <mat-select [(ngModel)]="selectedPatientId">
                  @for (p of patientResults; track p.id) {
                    <mat-option [value]="p.id">{{ p.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }

            <input #singleFile type="file" accept=".pdf" class="hidden" (change)="onSingleFile($event)" />
            <button mat-stroked-button (click)="singleFile.click()">Selecionar PDF</button>
            @if (singleSelected) { <span class="ml-3 text-sm">{{ singleSelected.name }}</span> }

            <div class="mt-4">
              <button mat-flat-button color="primary"
                [disabled]="!singleSelected || !selectedPatientId"
                (click)="uploadSingle()">Enviar</button>
            </div>
          </div>
        </mat-tab>

        <mat-tab label="Lote">
          <div class="p-4">
            <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-4">
              <input #batchFiles type="file" accept=".pdf" multiple class="hidden" (change)="onBatchFiles($event)" />
              <button mat-stroked-button (click)="batchFiles.click()">Selecionar PDFs (múltiplos)</button>
              @if (batchSelected.length) {
                <p class="mt-2 text-sm text-gray-600">{{ batchSelected.length }} arquivo(s) selecionado(s)</p>
              }
            </div>
            <button mat-flat-button color="primary"
              [disabled]="!batchSelected.length"
              (click)="uploadBatch()">Enviar todos</button>
          </div>
        </mat-tab>
      </mat-tab-group>

      <h2 class="text-lg font-medium mb-3">Fila de Processamento</h2>

      <mat-form-field>
        <mat-label>Filtrar status</mat-label>
        <mat-select [(ngModel)]="statusFilter" (ngModelChange)="applyFilter()">
          <mat-option value="">Todos</mat-option>
          <mat-option value="pending">Pending</mat-option>
          <mat-option value="processing">Processing</mat-option>
          <mat-option value="done">Done</mat-option>
          <mat-option value="error">Error</mat-option>
        </mat-select>
      </mat-form-field>

      <table mat-table [dataSource]="filteredQueue" class="w-full mt-3">
        <ng-container matColumnDef="filename">
          <th mat-header-cell *matHeaderCellDef>Arquivo</th>
          <td mat-cell *matCellDef="let e">{{ e.filename }}</td>
        </ng-container>
        <ng-container matColumnDef="patient">
          <th mat-header-cell *matHeaderCellDef>Paciente</th>
          <td mat-cell *matCellDef="let e">{{ e.patient_name }}</td>
        </ng-container>
        <ng-container matColumnDef="created_at">
          <th mat-header-cell *matHeaderCellDef>Enviado em</th>
          <td mat-cell *matCellDef="let e">{{ e.created_at | date:'dd/MM HH:mm' }}</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let e">
            <div class="flex items-center gap-2">
              <app-exam-status [status]="e.status" />
              <span class="text-sm capitalize">{{ e.status }}</span>
              @if (e.error_message) {
                <mat-icon [matTooltip]="e.error_message" class="text-red-600 text-base">error_outline</mat-icon>
              }
            </div>
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let e">
            @if (e.status === 'done') {
              <a mat-icon-button [routerLink]="['/doctor/results', e.exam_id]" matTooltip="Ver resultado">
                <mat-icon>open_in_new</mat-icon>
              </a>
            }
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="queueColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: queueColumns;"></tr>
      </table>
    </div>
  `
})
export class UploadsComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private ws = inject(WsService);

  patientSearch = '';
  patientResults: Patient[] = [];
  selectedPatientId = '';
  singleSelected: File | null = null;
  batchSelected: File[] = [];
  queue: QueueEntry[] = [];
  filteredQueue: QueueEntry[] = [];
  statusFilter = '';
  queueColumns = ['filename', 'patient', 'created_at', 'status', 'actions'];
  private wsSub?: Subscription;

  ngOnInit(): void {
    this.wsSub = this.ws.examUpdates$.subscribe(({ exam_id }) => {
      this.refreshQueueEntry(exam_id);
    });
  }

  ngOnDestroy(): void { this.wsSub?.unsubscribe(); }

  searchPatients(): void {
    if (!this.patientSearch.trim()) return;
    this.http.get<Patient[]>(`${environment.apiUrl}/patients`).subscribe(all =>
      this.patientResults = all.filter(p =>
        p.name.toLowerCase().includes(this.patientSearch.toLowerCase()))
    );
  }

  onSingleFile(e: Event): void {
    this.singleSelected = (e.target as HTMLInputElement).files?.[0] ?? null;
  }

  onBatchFiles(e: Event): void {
    this.batchSelected = Array.from((e.target as HTMLInputElement).files ?? []);
  }

  uploadSingle(): void {
    if (!this.singleSelected || !this.selectedPatientId) return;
    this.sendFile(this.singleSelected, this.selectedPatientId);
    this.singleSelected = null;
    this.selectedPatientId = '';
  }

  uploadBatch(): void {
    for (const file of this.batchSelected) {
      this.sendFile(file, this.selectedPatientId || '');
    }
    this.batchSelected = [];
  }

  private sendFile(file: File, patientId: string): void {
    const form = new FormData();
    form.append('patient_id', patientId);
    form.append('file', file);
    this.http.post<{ exam_id: string; status: string }>(
      `${environment.apiUrl}/exams`, form
    ).subscribe(({ exam_id, status }) => {
      const entry: QueueEntry = {
        exam_id,
        filename: file.name,
        patient_name: '',
        patient_id: patientId,
        status: status as Exam['status'],
        agents: '',
        created_at: new Date().toISOString()
      };
      this.queue.unshift(entry);
      this.applyFilter();
    });
  }

  private refreshQueueEntry(examId: string): void {
    this.http.get<Exam>(`${environment.apiUrl}/exams/${examId}`).subscribe(exam => {
      const idx = this.queue.findIndex(e => e.exam_id === examId);
      if (idx !== -1) {
        this.queue[idx].status = exam.status;
        this.queue[idx].agents = exam.results?.map(r => r.agent_type).join(', ') ?? '';
        this.applyFilter();
      }
    });
  }

  applyFilter(): void {
    this.filteredQueue = this.statusFilter
      ? this.queue.filter(e => e.status === this.statusFilter)
      : [...this.queue];
  }
}
