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
    <div class="uploads-page">
      <div class="page-header">
        <h1 class="page-title">Upload de Exames</h1>
        <span class="page-subtitle">GESTÃO DE EXAMES LABORATORIAIS</span>
      </div>

      <mat-tab-group class="uploads-tabs">
        <mat-tab label="Individual">
          <div class="tab-content">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Buscar paciente</mat-label>
              <input matInput [(ngModel)]="patientSearch" (ngModelChange)="searchPatients()" />
            </mat-form-field>

            @if (patientResults.length) {
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Selecionar paciente</mat-label>
                <mat-select [(ngModel)]="selectedPatientId">
                  @for (p of patientResults; track p.id) {
                    <mat-option [value]="p.id">{{ p.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }

            <div class="file-selector-row">
              <input #singleFile type="file" accept=".pdf" class="hidden-input" (change)="onSingleFile($event)" />
              <button mat-stroked-button class="select-btn" (click)="singleFile.click()">
                <mat-icon>upload_file</mat-icon>
                Selecionar PDF
              </button>
              @if (singleSelected) {
                <span class="filename-display">{{ singleSelected.name }}</span>
              }
            </div>

            <div class="submit-row">
              <button class="submit-btn"
                [disabled]="!singleSelected || !selectedPatientId"
                (click)="uploadSingle()">ENVIAR EXAME</button>
            </div>
          </div>
        </mat-tab>

        <mat-tab label="Lote">
          <div class="tab-content">
            <div class="drop-zone">
              <input #batchFiles type="file" accept=".pdf" multiple class="hidden-input" (change)="onBatchFiles($event)" />
              <mat-icon class="drop-icon">cloud_upload</mat-icon>
              <p class="drop-text">Arraste PDFs ou clique para selecionar</p>
              <button mat-stroked-button class="select-btn" (click)="batchFiles.click()">
                Selecionar PDFs (múltiplos)
              </button>
              @if (batchSelected.length) {
                <span class="batch-count">{{ batchSelected.length }} arquivo(s) selecionado(s)</span>
              }
            </div>
            <div class="submit-row">
              <button class="submit-btn"
                [disabled]="!batchSelected.length"
                (click)="uploadBatch()">ENVIAR TODOS</button>
            </div>
          </div>
        </mat-tab>
      </mat-tab-group>

      <div class="queue-section">
        <div class="queue-header">
          <h2 class="section-title">Fila de Processamento</h2>
          <mat-form-field appearance="outline" class="status-filter">
            <mat-label>Filtrar status</mat-label>
            <mat-select [(ngModel)]="statusFilter" (ngModelChange)="applyFilter()">
              <mat-option value="">Todos</mat-option>
              <mat-option value="pending">Pending</mat-option>
              <mat-option value="processing">Processing</mat-option>
              <mat-option value="done">Done</mat-option>
              <mat-option value="error">Error</mat-option>
            </mat-select>
          </mat-form-field>
        </div>

        <table mat-table [dataSource]="filteredQueue" class="queue-table">
          <ng-container matColumnDef="filename">
            <th mat-header-cell *matHeaderCellDef>Arquivo</th>
            <td mat-cell *matCellDef="let e">
              <span class="filename-cell">{{ e.filename }}</span>
            </td>
          </ng-container>
          <ng-container matColumnDef="patient">
            <th mat-header-cell *matHeaderCellDef>Paciente</th>
            <td mat-cell *matCellDef="let e">{{ e.patient_name }}</td>
          </ng-container>
          <ng-container matColumnDef="created_at">
            <th mat-header-cell *matHeaderCellDef>Enviado em</th>
            <td mat-cell *matCellDef="let e">
              <span class="date-cell">{{ e.created_at | date:'dd/MM HH:mm' }}</span>
            </td>
          </ng-container>
          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let e">
              <div class="status-cell">
                @if (e.status === 'pending') {
                  <span class="status-badge status-pending">PENDING</span>
                } @else if (e.status === 'processing') {
                  <span class="status-badge status-processing intelligence-pulse">PROCESSING</span>
                } @else if (e.status === 'done') {
                  <span class="status-badge status-done">DONE</span>
                } @else if (e.status === 'error') {
                  <span class="status-badge status-error">ERROR</span>
                }
                @if (e.error_message) {
                  <mat-icon [matTooltip]="e.error_message" class="error-icon">error_outline</mat-icon>
                }
              </div>
            </td>
          </ng-container>
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let e">
              @if (e.status === 'done') {
                <a mat-icon-button [routerLink]="['/results', e.exam_id]" matTooltip="Ver resultado" class="action-btn">
                  <mat-icon>open_in_new</mat-icon>
                </a>
              }
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="queueColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: queueColumns;"></tr>
        </table>
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
      margin-bottom: 2rem;
    }

    .page-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 1.5rem;
      color: #dae2fd;
      margin: 0 0 0.25rem 0;
    }

    .page-subtitle {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      text-transform: uppercase;
      color: #464554;
      letter-spacing: 0.08em;
    }

    .uploads-tabs {
      margin-bottom: 2rem;
    }

    .tab-content {
      padding: 1.5rem 0;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .full-width {
      width: 100%;
    }

    .hidden-input {
      display: none;
    }

    .file-selector-row {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .select-btn {
      color: #c0c1ff;
      border-color: rgba(70, 69, 84, 0.4);
    }

    .filename-display {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #908fa0;
    }

    .submit-row {
      margin-top: 0.5rem;
    }

    .submit-btn {
      width: 100%;
      padding: 0.75rem 1.5rem;
      background: #c0c1ff;
      color: #1000a9;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .submit-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .submit-btn:not(:disabled):hover {
      opacity: 0.9;
    }

    .drop-zone {
      border: 1px dashed rgba(70, 69, 84, 0.4);
      border-radius: 8px;
      padding: 2rem;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
    }

    .drop-icon {
      font-size: 2.5rem;
      width: 2.5rem;
      height: 2.5rem;
      color: #464554;
    }

    .drop-text {
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      color: #908fa0;
      margin: 0;
    }

    .batch-count {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #c0c1ff;
    }

    .queue-section {
      margin-top: 2rem;
    }

    .queue-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .section-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 1rem;
      color: #dae2fd;
      margin: 0;
    }

    .status-filter {
      min-width: 180px;
    }

    .queue-table {
      width: 100%;
      background: transparent !important;
    }

    .filename-cell {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #dae2fd;
    }

    .date-cell {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: #908fa0;
    }

    .status-cell {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .status-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: 4px;
    }

    .status-pending {
      background: #2d3449;
      color: #908fa0;
    }

    .status-processing {
      background: #2d3449;
      color: #c0c1ff;
    }

    .status-done {
      background: rgba(16, 185, 129, 0.1);
      color: #10b981;
    }

    .status-error {
      background: rgba(255, 180, 171, 0.1);
      color: #ffb4ab;
    }

    .error-icon {
      font-size: 1rem;
      width: 1rem;
      height: 1rem;
      color: #ffb4ab;
    }

    .action-btn {
      color: #c0c1ff;
    }
  `]
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
    this.loadExistingExams();
    this.wsSub = this.ws.examUpdates$.subscribe(({ exam_id }) => {
      this.refreshQueueEntry(exam_id);
    });
  }

  private loadExistingExams(): void {
    this.http.get<Patient[]>(`${environment.apiUrl}/patients`).subscribe(patients => {
      const patientMap = new Map(patients.map(p => [p.id, p.name]));
      this.http.get<any[]>(`${environment.apiUrl}/exams`).subscribe(exams => {
        this.queue = exams.map(e => ({
          exam_id: e.id,
          filename: e.file_path?.split('/').pop() ?? e.id,
          patient_name: patientMap.get(e.patient_id) ?? '',
          patient_id: e.patient_id ?? '',
          status: e.status,
          agents: e.results?.map((r: any) => r.agent_type).join(', ') ?? '',
          created_at: e.created_at,
          error_message: e.error_message
        }));
        this.applyFilter();
      });
    });
  }

  ngOnDestroy(): void { this.wsSub?.unsubscribe(); }

  searchPatients(): void {
    if (!this.patientSearch.trim()) { this.patientResults = []; return; }
    const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    this.http.get<Patient[]>(`${environment.apiUrl}/patients`).subscribe(all =>
      this.patientResults = all.filter(p =>
        normalize(p.name).includes(normalize(this.patientSearch)))
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
