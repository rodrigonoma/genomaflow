import { Component, computed, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DatePipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WsService } from '../../../core/ws/ws.service';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ExamCardComponent } from '../../../shared/components/exam-card/exam-card.component';
import { environment } from '../../../../environments/environment';
import { Subject, Exam, Alert, TreatmentPlan, TreatmentItem, ClinicalResult } from '../../../shared/models/api.models';

interface AlertChange {
  marker: string;
  kind: 'new' | 'worsened' | 'improved' | 'resolved';
  from_severity?: string;
  to_severity?: string;
  value?: string;
}

interface ComparisonBlock {
  agent_type: string;
  risk_trajectory: string[];
  changes: AlertChange[];
}

@Component({
  selector: 'app-patient-detail',
  standalone: true,
  imports: [
    RouterModule, DatePipe, NgClass, FormsModule,
    MatTabsModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatChipsModule, MatDialogModule, MatCheckboxModule, MatSnackBarModule, ExamCardComponent
  ],
  styles: [`
    :host { display: block; background: #0b1326; min-height: 100vh; }

    .page-header {
      padding: 1.5rem 2rem 0;
      border-bottom: 1px solid rgba(70,69,84,0.2);
    }
    .back-link {
      display: inline-flex; align-items: center; gap: 6px;
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.1em;
      color: #908fa0; cursor: pointer; background: none; border: none;
      margin-bottom: 1rem;
      transition: color 0.15s;
    }
    .back-link:hover { color: #dae2fd; }

    .subject-header {
      display: flex; align-items: flex-start;
      justify-content: space-between; gap: 1rem;
      margin-bottom: 1.5rem; flex-wrap: wrap;
    }
    .subject-name {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.75rem; color: #dae2fd; margin: 0 0 0.5rem;
      letter-spacing: -0.02em;
    }
    .subject-badges { display: flex; gap: 8px; flex-wrap: wrap; }
    .badge {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.1em;
      padding: 3px 10px; border-radius: 2px;
    }
    .badge-human  { background: rgba(192,193,255,0.1); color: #c0c1ff; border: 1px solid rgba(192,193,255,0.2); }
    .badge-animal { background: rgba(74,214,160,0.1);  color: #4ad6a0; border: 1px solid rgba(74,214,160,0.2); }
    .badge-sex    { background: rgba(70,69,84,0.2); color: #908fa0; border: 1px solid rgba(70,69,84,0.3); }
    .badge-species { background: rgba(245,193,74,0.1); color: #f5c14a; border: 1px solid rgba(245,193,74,0.2); }

    .header-actions { display: flex; gap: 8px; }
    .btn-new-exam {
      background: #c0c1ff !important; color: #1000a9 !important;
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em;
    }

    ::ng-deep .mat-mdc-tab-labels { padding: 0 2rem; }
    ::ng-deep .mat-mdc-tab-body-wrapper { padding: 2rem; }

    /* ── PROFILE FORM ── */
    .profile-grid {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 1.5rem; max-width: 900px;
    }
    .profile-section {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 6px; padding: 1.5rem;
    }
    .profile-section.span-2 { grid-column: span 2; }
    .section-label {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.15em;
      color: #464554; margin-bottom: 1rem;
    }
    .field-row { display: flex; flex-direction: column; gap: 1rem; }
    .field-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    mat-form-field { width: 100%; }
    .save-row { display: flex; justify-content: flex-end; margin-top: 1rem; }

    /* owner card */
    .owner-card {
      background: #0e1420; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 4px; padding: 1rem 1.25rem;
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 1rem;
    }
    .owner-name { font-weight: 600; font-size: 14px; color: #dae2fd; }
    .owner-meta {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #908fa0; margin-top: 3px;
    }

    /* ── Evolução ── */
    .evolution-select-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem; }
    .evolution-exam-row {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.6rem 1rem; border-radius: 6px;
      background: #131b2e; border: 1px solid rgba(70,69,84,0.15);
      cursor: pointer;
    }
    .evolution-exam-row.selected { border-color: #c0c1ff; }
    .evolution-exam-meta { font-size: 13px; color: #908fa0; }
    .evolution-exam-date { font-weight: 600; color: #dae2fd; margin-right: 0.5rem; }
    .compare-btn { margin-bottom: 2rem; }
    .comparison-header {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      letter-spacing: 0.1em; color: #c0c1ff; text-transform: uppercase;
      margin-bottom: 1.5rem;
    }
    .comparison-blocks { display: flex; flex-direction: column; gap: 1.5rem; max-width: 800px; }
    .comp-block { background: #131b2e; border-radius: 8px; padding: 1rem 1.25rem; border: 1px solid rgba(70,69,84,0.15); }
    .comp-agent-header {
      display: flex; align-items: baseline; gap: 1rem; margin-bottom: 0.75rem;
    }
    .comp-agent-name {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 13px; text-transform: uppercase; color: #c0c1ff; letter-spacing: 0.05em;
    }
    .comp-risk-traj { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #908fa0; }
    .comp-changes { display: flex; flex-direction: column; gap: 0.4rem; }
    .comp-change-row { display: flex; align-items: center; gap: 0.5rem; font-size: 13px; }
    .comp-change-kind { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; min-width: 72px; }
    .comp-marker { color: #dae2fd; }
    .comp-severity { color: #908fa0; font-size: 12px; }
    .comp-empty { color: #908fa0; font-style: italic; font-size: 13px; }

    /* ── EXAMS ── */
    .exams-upload-row {
      display: flex; align-items: center; gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .upload-exam-btn { color: #c0c1ff; border-color: rgba(192,193,255,0.3); }
    .upload-error { color: #ffb4ab; font-size: 13px; }
    .exams-list { display: flex; flex-direction: column; gap: 0.75rem; max-width: 900px; }
    .exam-wrap { border-radius: 6px; overflow: hidden; }
    .exam-wrap.status-border-done       { border-left: 4px solid #10b981; }
    .exam-wrap.status-border-processing { border-left: 4px solid #c0c1ff; }
    .exam-wrap.status-border-error      { border-left: 4px solid #ffb4ab; }
    .exam-wrap.status-border-pending    { border-left: 4px solid #908fa0; }

    /* ── AI RESULTS (redesign) ── */
    .ai-exam-selector { margin-bottom: 1rem; }
    .ai-select-field { width: 300px; }
    .ai-status-strip { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
    .ai-agent-chip {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.4rem 0.75rem; background: #131b2e;
      border: 1px solid rgba(70,69,84,0.2); border-left: 3px solid;
      border-radius: 6px; cursor: pointer; transition: background 150ms;
    }
    .ai-agent-chip:hover { background: #1a2540; }
    .ai-chip-name {
      font-family: 'Space Grotesk', sans-serif; font-size: 12px;
      font-weight: 700; color: #dae2fd; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .ai-chip-sev { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; }
    .ai-chip-count { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #908fa0; }
    .ai-cards { display: flex; flex-direction: column; gap: 0.5rem; max-width: 860px; }
    .ai-card {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.2);
      border-left: 4px solid; border-radius: 8px; overflow: hidden;
    }
    .ai-card-header {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.75rem 1rem; cursor: pointer; transition: background 150ms;
    }
    .ai-card-header:hover { background: #1a2540; }
    .ai-expand-icon { font-size: 18px !important; width: 18px !important; height: 18px !important; color: #908fa0; }
    .ai-card-name {
      font-family: 'Space Grotesk', sans-serif; font-size: 13px;
      font-weight: 700; color: #dae2fd; text-transform: uppercase; letter-spacing: 0.04em; flex: 1;
    }
    .ai-card-sev { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; }
    .ai-card-count { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #908fa0; }
    .ai-result-link {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #c0c1ff; text-decoration: none; white-space: nowrap; margin-left: auto;
    }
    .ai-result-link:hover { text-decoration: underline; }
    .ai-card-body { padding: 0 1rem 1rem 1rem; border-top: 1px solid rgba(70,69,84,0.15); }
    .ai-section-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.1em; color: #464554;
      margin: 1rem 0 0.5rem 0;
    }
    .ai-alerts { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.5rem; }
    .ai-alert-row {
      display: flex; align-items: center; gap: 0.5rem;
      font-family: 'JetBrains Mono', monospace; font-size: 12px;
    }
    .ai-alert-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .ai-alert-marker { color: #dae2fd; flex: 1; }
    .ai-alert-value { color: #908fa0; }
    .ai-alert-sev { font-size: 10px; font-weight: 700; min-width: 56px; text-align: right; }
    .ai-interpretation { margin-bottom: 0.5rem; }
    .ai-interpretation p {
      font-family: 'Inter', sans-serif; font-size: 13px; color: #c7c4d7;
      line-height: 1.6; margin: 0 0 0.5rem 0;
      padding-left: 0.75rem; border-left: 2px solid rgba(192,193,255,0.2);
    }
    .ai-recs { display: flex; flex-direction: column; gap: 0.375rem; }
    .ai-rec-item {
      display: flex; gap: 0.5rem; align-items: flex-start;
      padding: 0.5rem 0.75rem; border-radius: 4px;
      background: rgba(70,69,84,0.08); border-left: 3px solid;
    }
    .ai-rec-type {
      font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700;
      letter-spacing: 0.08em; color: #908fa0; flex-shrink: 0; padding-top: 2px; min-width: 88px;
    }
    .ai-rec-desc { font-family: 'Inter', sans-serif; font-size: 13px; color: #c7c4d7; line-height: 1.4; }

    /* ── TREATMENTS ── */
    .treatments-header {
      display: flex; justify-content: space-between;
      align-items: center; margin-bottom: 1.5rem;
    }
    .treatments-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1rem; color: #dae2fd;
    }
    .plan-card {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 6px; padding: 1.25rem; margin-bottom: 1rem;
      max-width: 900px;
    }
    .plan-header {
      display: flex; justify-content: space-between;
      align-items: flex-start; margin-bottom: 0.75rem;
    }
    .plan-title { font-weight: 700; font-size: 15px; color: #dae2fd; }
    .plan-meta {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #464554; margin-top: 3px;
    }
    .plan-type-badge {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.1em;
      padding: 3px 10px; border-radius: 2px;
    }
    .type-therapeutic { background: rgba(192,193,255,0.1); color: #c0c1ff; }
    .type-nutritional  { background: rgba(74,214,160,0.1);  color: #4ad6a0; }
    .plan-desc { font-size: 13px; color: #908fa0; margin-bottom: 1rem; line-height: 1.5; }
    .items-table { width: 100%; border-collapse: collapse; }
    .items-table th {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.15em; color: #464554;
      text-align: left; padding: 6px 0; border-bottom: 1px solid rgba(70,69,84,0.2);
    }
    .items-table td {
      font-size: 13px; color: #c7c4d7; padding: 8px 0;
      border-bottom: 1px dashed rgba(70,69,84,0.15);
      vertical-align: top;
    }
    .items-table tr:last-child td { border-bottom: none; }
    .td-label { font-weight: 600; color: #dae2fd; padding-right: 1rem; }

    /* new plan form */
    .new-plan-form {
      background: #0e1420; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 6px; padding: 1.5rem; margin-bottom: 1.5rem;
      max-width: 900px;
    }
    .form-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 14px; color: #dae2fd; margin-bottom: 1.25rem;
    }
    .items-form { margin-top: 1rem; }
    .item-row {
      display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto;
      gap: 8px; align-items: start; margin-bottom: 8px;
    }
    .item-row input {
      background: #0b1326; border: 1px solid rgba(70,69,84,0.3);
      color: #dae2fd; padding: 8px 10px; font-size: 12px;
      border-radius: 4px; width: 100%; outline: none;
      font-family: 'Inter', sans-serif;
    }
    .item-row input:focus { border-color: #464554; }
    .btn-icon {
      background: none; border: 1px solid rgba(70,69,84,0.3);
      color: #908fa0; padding: 8px; border-radius: 4px;
      cursor: pointer; transition: all 0.15s;
    }
    .btn-icon:hover { border-color: #ffb4ab; color: #ffb4ab; }
    .add-item-btn {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: #908fa0; background: none; border: 1px dashed rgba(70,69,84,0.3);
      padding: 8px 14px; border-radius: 4px; cursor: pointer;
      transition: all 0.15s; margin-top: 4px;
    }
    .add-item-btn:hover { border-color: #c0c1ff; color: #c0c1ff; }
    .form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 1rem; }

    .empty-state {
      font-size: 14px; color: #908fa0; padding: 3rem; text-align: center;
    }

    .plan-status-active    { color: #4ad6a0; }
    .plan-status-completed { color: #c0c1ff; }
    .plan-status-cancelled { color: #908fa0; }
  `],
  template: `
    <div class="page-header">
      <button class="back-link" routerLink="/doctor/patients">
        <mat-icon style="font-size:14px;width:14px;height:14px">arrow_back</mat-icon>
        Pacientes
      </button>

      @if (subject()) {
        <div class="subject-header">
          <div>
            <h1 class="subject-name">{{ subject()!.name }}</h1>
            <div class="subject-badges">
              <span class="badge" [ngClass]="subject()!.subject_type === 'human' ? 'badge-human' : 'badge-animal'">
                {{ subject()!.subject_type === 'human' ? 'Humano' : 'Animal' }}
              </span>
              <span class="badge badge-sex">{{ subject()!.sex }}</span>
              @if (subject()!.species) {
                <span class="badge badge-species">{{ subject()!.species }}</span>
              }
              @if (subject()!.birth_date) {
                <span class="badge badge-sex">{{ age(subject()!.birth_date!) }}</span>
              }
            </div>
          </div>
          <div class="header-actions"></div>
        </div>
      }

      <mat-tab-group animationDuration="150ms">

        <!-- ── PERFIL ── -->
        <mat-tab label="Perfil">
          @if (subject()) {
            <div class="profile-grid">

              <!-- Dados pessoais -->
              <div class="profile-section">
                <div class="section-label">Dados pessoais</div>
                <div class="field-row">
                  <div class="field-pair">
                    <mat-form-field appearance="outline">
                      <mat-label>Nome</mat-label>
                      <input matInput [(ngModel)]="editForm.name"/>
                    </mat-form-field>
                    <mat-form-field appearance="outline">
                      <mat-label>Sexo</mat-label>
                      <mat-select [(ngModel)]="editForm.sex">
                        <mat-option value="M">Masculino</mat-option>
                        <mat-option value="F">Feminino</mat-option>
                        <mat-option value="other">Outro</mat-option>
                      </mat-select>
                    </mat-form-field>
                  </div>
                  @if (subject()!.subject_type === 'human') {
                    <div class="field-pair">
                      <mat-form-field appearance="outline">
                        <mat-label>Data de nascimento</mat-label>
                        <input matInput type="date" [(ngModel)]="editForm.birth_date"/>
                      </mat-form-field>
                      <mat-form-field appearance="outline">
                        <mat-label>Telefone</mat-label>
                        <input matInput [(ngModel)]="editForm.phone"/>
                      </mat-form-field>
                    </div>
                  }
                  @if (subject()!.subject_type === 'animal') {
                    <div class="field-pair">
                      <mat-form-field appearance="outline">
                        <mat-label>Raça</mat-label>
                        <input matInput [(ngModel)]="editForm.breed"/>
                      </mat-form-field>
                      <mat-form-field appearance="outline">
                        <mat-label>Cor / Pelagem</mat-label>
                        <input matInput [(ngModel)]="editForm.color"/>
                      </mat-form-field>
                    </div>
                    <div class="field-pair">
                      <mat-form-field appearance="outline">
                        <mat-label>Microchip</mat-label>
                        <input matInput [(ngModel)]="editForm.microchip"/>
                      </mat-form-field>
                      <mat-form-field appearance="outline">
                        <mat-label>Castrado(a)</mat-label>
                        <mat-select [(ngModel)]="editForm.neutered">
                          <mat-option [value]="true">Sim</mat-option>
                          <mat-option [value]="false">Não</mat-option>
                        </mat-select>
                      </mat-form-field>
                    </div>
                  }
                </div>
              </div>

              <!-- Dados clínicos -->
              <div class="profile-section">
                <div class="section-label">Dados clínicos</div>
                <div class="field-row">
                  <div class="field-pair">
                    <mat-form-field appearance="outline">
                      <mat-label>Peso (kg)</mat-label>
                      <input matInput type="number" step="0.1" [(ngModel)]="editForm.weight"/>
                    </mat-form-field>
                    @if (subject()!.subject_type === 'human') {
                      <mat-form-field appearance="outline">
                        <mat-label>Altura (cm)</mat-label>
                        <input matInput type="number" [(ngModel)]="editForm.height"/>
                      </mat-form-field>
                    }
                  </div>
                  @if (subject()!.subject_type === 'human') {
                    <mat-form-field appearance="outline">
                      <mat-label>Tipo sanguíneo</mat-label>
                      <mat-select [(ngModel)]="editForm.blood_type">
                        @for (t of bloodTypes; track t) {
                          <mat-option [value]="t">{{ t }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                  }
                  <mat-form-field appearance="outline">
                    <mat-label>Alergias</mat-label>
                    <textarea matInput rows="2" [(ngModel)]="editForm.allergies"
                              placeholder="Ex: penicilina, látex..."></textarea>
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>Comorbidades</mat-label>
                    <textarea matInput rows="2" [(ngModel)]="editForm.comorbidities"
                              placeholder="Ex: hipertensão, diabetes..."></textarea>
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>Observações</mat-label>
                    <textarea matInput rows="2" [(ngModel)]="editForm.notes"></textarea>
                  </mat-form-field>
                </div>
              </div>

              <!-- Owner card (vet only) -->
              @if (subject()!.subject_type === 'animal' && subject()!.owner_name) {
                <div class="profile-section">
                  <div class="section-label">Dono / Tutor</div>
                  <div class="owner-card">
                    <div>
                      <div class="owner-name">{{ subject()!.owner_name }}</div>
                      <div class="owner-meta">
                        @if (subject()!.owner_cpf_last4) { CPF ***{{ subject()!.owner_cpf_last4 }} · }
                        @if (subject()!.owner_phone) { {{ subject()!.owner_phone }} }
                      </div>
                    </div>
                  </div>
                </div>
              }

              <div class="profile-section span-2 save-row">
                <button mat-flat-button style="background:#c0c1ff;color:#1000a9;font-weight:700"
                        (click)="saveProfile()">
                  Salvar alterações
                </button>
              </div>
            </div>
          }
        </mat-tab>

        <!-- ── EXAMES ── -->
        <mat-tab [label]="'Exames (' + exams().length + ')'">
          <div class="exams-upload-row">
            <input #examFile type="file" accept=".pdf" style="display:none"
                   (change)="onExamFile($event)"/>
            <button mat-stroked-button class="upload-exam-btn" (click)="examFile.click()"
                    [disabled]="uploading()">
              <mat-icon>upload_file</mat-icon>
              {{ uploading() ? 'Enviando…' : 'Upload de Exame (PDF)' }}
            </button>
            @if (uploadError()) {
              <span class="upload-error">{{ uploadError() }}</span>
            }
          </div>
          @if (exams().length === 0) {
            <p class="empty-state">Nenhum exame registrado.</p>
          } @else {
            <div class="exams-list">
              @for (exam of exams(); track exam.id) {
                <div class="exam-wrap" [ngClass]="'status-border-' + exam.status">
                  <app-exam-card [exam]="exam"/>
                </div>
              }
            </div>
          }
        </mat-tab>

        <!-- ── ANÁLISES IA ── -->
        <mat-tab [label]="'Análises IA (' + aiResults().length + ')'">
          @if (aiResults().length === 0) {
            <p class="empty-state">Nenhuma análise de IA disponível.</p>
          } @else {
            <!-- Seletor de exame -->
            <div class="ai-exam-selector">
              <mat-form-field appearance="outline" class="ai-select-field">
                <mat-label>Exame</mat-label>
                <mat-select [value]="selectedAiExam()?.id"
                            (selectionChange)="onAiExamSelect($event.value)">
                  @for (e of sortedAiExams(); track e.id) {
                    <mat-option [value]="e.id">
                      {{ e.created_at | date:'dd/MM/yyyy HH:mm' }} · {{ e.results!.length }} {{ e.results!.length === 1 ? 'agente' : 'agentes' }}
                    </mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>

            @if (selectedAiExam(); as exam) {
              <!-- Faixa de status -->
              <div class="ai-status-strip">
                @for (cr of exam.results ?? []; track cr.agent_type) {
                  @let sev = topSeverity(cr.alerts);
                  <div class="ai-agent-chip" [style.border-left-color]="severityColor(sev)"
                       (click)="toggleAgent(cr.agent_type)">
                    <span class="ai-chip-name">{{ agentLabel(cr.agent_type) }}</span>
                    <span class="ai-chip-sev" [style.color]="severityColor(sev)">{{ sev.toUpperCase() }}</span>
                    @if (cr.alerts?.length) {
                      <span class="ai-chip-count">{{ cr.alerts.length }} alerta{{ cr.alerts.length !== 1 ? 's' : '' }}</span>
                    }
                  </div>
                }
              </div>

              <!-- Cards colapsáveis -->
              <div class="ai-cards">
                @for (cr of exam.results ?? []; track cr.agent_type) {
                  @let sev = topSeverity(cr.alerts);
                  @let expanded = expandedAgents().has(cr.agent_type);
                  <div class="ai-card" [style.border-left-color]="severityColor(sev)">
                    <div class="ai-card-header" (click)="toggleAgent(cr.agent_type)">
                      <mat-icon class="ai-expand-icon">{{ expanded ? 'expand_more' : 'chevron_right' }}</mat-icon>
                      <span class="ai-card-name">{{ agentLabel(cr.agent_type) }}</span>
                      <span class="ai-card-sev" [style.color]="severityColor(sev)">{{ sev.toUpperCase() }}</span>
                      @if (cr.alerts?.length) {
                        <span class="ai-card-count">{{ cr.alerts.length }} alerta{{ cr.alerts.length !== 1 ? 's' : '' }}</span>
                      }
                      <a class="ai-result-link" [routerLink]="['/doctor/results', exam.id]"
                         (click)="$event.stopPropagation()">Ver resultado ↗</a>
                    </div>

                    @if (expanded) {
                      <div class="ai-card-body">
                        @if (cr.alerts?.length) {
                          <div class="ai-section-label">ALERTAS</div>
                          <div class="ai-alerts">
                            @for (a of sortedAlerts(cr.alerts); track a.marker) {
                              <div class="ai-alert-row">
                                <span class="ai-alert-dot" [style.background]="severityColor(a.severity)"></span>
                                <span class="ai-alert-marker">{{ a.marker }}</span>
                                <span class="ai-alert-value">{{ a.value }}</span>
                                <span class="ai-alert-sev" [style.color]="severityColor(a.severity)">{{ a.severity }}</span>
                              </div>
                            }
                          </div>
                        }

                        <div class="ai-section-label">INTERPRETAÇÃO · AI · CLAUDE SONNET</div>
                        <div class="ai-interpretation">
                          @for (para of cr.interpretation.split('\n'); track $index) {
                            @if (para.trim()) {
                              <p>{{ para.trim() }}</p>
                            }
                          }
                        </div>

                        @if (cr.recommendations?.length) {
                          <div class="ai-section-label">RECOMENDAÇÕES</div>
                          <div class="ai-recs">
                            @for (rec of cr.recommendations; track rec.description) {
                              <div class="ai-rec-item"
                                   [style.border-left-color]="severityColor(rec.priority === 'high' ? 'high' : rec.priority === 'medium' ? 'medium' : 'low')">
                                <span class="ai-rec-type">{{ rec.type.toUpperCase() }}</span>
                                <span class="ai-rec-desc">{{ rec.description }}</span>
                              </div>
                            }
                          </div>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            }
          }
        </mat-tab>

        <!-- ── EVOLUÇÃO ── -->
        <mat-tab label="Evolução">
          @if (doneExams().length < 2) {
            <p class="empty-state">São necessários pelo menos 2 exames concluídos com análise de IA para comparar.</p>
          } @else {
            <div class="evolution-select-list">
              @for (e of doneExams(); track e.id) {
                <div class="evolution-exam-row"
                     [class.selected]="selectedExamIds().has(e.id)"
                     (click)="toggleExamSelection(e.id)">
                  <mat-checkbox [checked]="selectedExamIds().has(e.id)"
                                (click)="$event.stopPropagation()"
                                (change)="toggleExamSelection(e.id)"/>
                  <span class="evolution-exam-date">{{ e.created_at | date:'dd/MM/yyyy HH:mm' }}</span>
                  <span class="evolution-exam-meta">
                    {{ e.results!.length }} {{ e.results!.length === 1 ? 'agente' : 'agentes' }}
                  </span>
                </div>
              }
            </div>

            <button mat-flat-button class="compare-btn"
                    style="background:#c0c1ff;color:#1000a9;font-weight:700"
                    [disabled]="selectedExamIds().size < 2"
                    (click)="compareExams()">
              <mat-icon>compare_arrows</mat-icon>
              Comparar {{ selectedExamIds().size }} exame{{ selectedExamIds().size !== 1 ? 's' : '' }} selecionado{{ selectedExamIds().size !== 1 ? 's' : '' }}
            </button>

            @if (comparison()) {
              <div class="comparison-header">
                Comparando &nbsp;
                @for (e of selectedSortedExams(); track e.id; let last = $last) {
                  {{ e.created_at | date:'dd/MM' }}@if (!last) { &nbsp;→&nbsp; }
                }
              </div>

              @if (comparison()!.length === 0) {
                <p class="comp-empty">Nenhuma mudança clínica detectada entre os exames selecionados.</p>
              } @else {
                <div class="comparison-blocks">
                  @for (block of comparison()!; track block.agent_type) {
                    <div class="comp-block">
                      <div class="comp-agent-header">
                        <span class="comp-agent-name">{{ agentLabel(block.agent_type) }}</span>
                        <span class="comp-risk-traj">{{ block.risk_trajectory.join(' → ') }}</span>
                      </div>
                      @if (block.changes.length === 0) {
                        <span class="comp-empty">Risk score alterado, sem mudanças em alertas.</span>
                      } @else {
                        <div class="comp-changes">
                          @for (ch of block.changes; track ch.marker) {
                            <div class="comp-change-row">
                              <mat-icon [style.color]="kindColor(ch.kind)" style="font-size:18px;width:18px;height:18px">{{ kindIcon(ch.kind) }}</mat-icon>
                              <span class="comp-change-kind" [style.color]="kindColor(ch.kind)">{{ kindLabel(ch.kind) }}</span>
                              <span class="comp-marker">{{ ch.marker }}</span>
                              @if (ch.value) {
                                <span class="comp-severity">· {{ ch.value }}</span>
                              }
                              @if (ch.from_severity && ch.to_severity) {
                                <span class="comp-severity">({{ ch.from_severity }} → {{ ch.to_severity }})</span>
                              } @else if (ch.to_severity) {
                                <span class="comp-severity">({{ ch.to_severity }})</span>
                              } @else if (ch.from_severity) {
                                <span class="comp-severity">(era {{ ch.from_severity }})</span>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            }
          }
        </mat-tab>

        <!-- ── TRATAMENTOS ── -->
        <mat-tab [label]="'Tratamentos (' + plans().length + ')'">
          <div class="treatments-header">
            <span class="treatments-title">Planos de tratamento</span>
            <button mat-stroked-button (click)="toggleNewPlan()">
              <mat-icon>add</mat-icon> Novo plano
            </button>
          </div>

          @if (showNewPlan()) {
            <div class="new-plan-form">
              <div class="form-title">Novo plano de tratamento</div>
              <div class="field-pair" style="margin-bottom:1rem">
                <mat-form-field appearance="outline">
                  <mat-label>Título</mat-label>
                  <input matInput [(ngModel)]="newPlan.title" placeholder="Ex: Tratamento dislipidemia"/>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Tipo</mat-label>
                  <mat-select [(ngModel)]="newPlan.type">
                    <mat-option value="therapeutic">Terapêutico</mat-option>
                    <mat-option value="nutritional">Nutricional</mat-option>
                  </mat-select>
                </mat-form-field>
              </div>
              <mat-form-field appearance="outline" style="width:100%;margin-bottom:1rem">
                <mat-label>Descrição / contexto clínico</mat-label>
                <textarea matInput rows="2" [(ngModel)]="newPlan.description"></textarea>
              </mat-form-field>

              <div class="items-form">
                <div class="section-label">Itens do plano</div>
                @for (item of newPlan.items; track $index; let i = $index) {
                  <div class="item-row">
                    <input [(ngModel)]="item.label" placeholder="Medicamento / nutriente"/>
                    <input [(ngModel)]="item.value" placeholder="Dose / qtd"/>
                    <input [(ngModel)]="item.frequency" placeholder="Frequência"/>
                    <input [(ngModel)]="item.duration" placeholder="Duração"/>
                    <button class="btn-icon" (click)="removeItem(i)">
                      <mat-icon style="font-size:16px;width:16px;height:16px">close</mat-icon>
                    </button>
                  </div>
                }
                <button class="add-item-btn" (click)="addItem()">+ Adicionar item</button>
              </div>

              <div class="form-actions">
                <button mat-button (click)="showNewPlan.set(false)">Cancelar</button>
                <button mat-flat-button style="background:#c0c1ff;color:#1000a9;font-weight:700"
                        (click)="savePlan()">
                  Salvar plano
                </button>
              </div>
            </div>
          }

          @for (plan of plans(); track plan.id) {
            <div class="plan-card">
              <div class="plan-header">
                <div>
                  <div class="plan-title">{{ plan.title }}</div>
                  <div class="plan-meta">
                    {{ plan.created_at | date:'dd/MM/yyyy' }} ·
                    <span [ngClass]="'plan-status-' + plan.status">{{ plan.status }}</span>
                  </div>
                </div>
                <span class="plan-type-badge" [ngClass]="'type-' + plan.type">
                  {{ plan.type === 'therapeutic' ? 'Terapêutico' : 'Nutricional' }}
                </span>
              </div>
              @if (plan.description) {
                <div class="plan-desc">{{ plan.description }}</div>
              }
              @if (plan.items?.length) {
                <table class="items-table">
                  <tr>
                    <th>Item</th><th>Dose/Qtd</th><th>Frequência</th><th>Duração</th>
                  </tr>
                  @for (item of plan.items; track item.label) {
                    <tr>
                      <td class="td-label">{{ item.label }}</td>
                      <td>{{ item.value || '—' }}</td>
                      <td>{{ item.frequency || '—' }}</td>
                      <td>{{ item.duration || '—' }}</td>
                    </tr>
                  }
                </table>
              }
            </div>
          }

          @if (plans().length === 0 && !showNewPlan()) {
            <p class="empty-state">Nenhum plano de tratamento registrado.</p>
          }
        </mat-tab>

      </mat-tab-group>
    </div>
  `
})
export class PatientDetailComponent implements OnInit, OnDestroy {
  private http   = inject(HttpClient);
  private route  = inject(ActivatedRoute);
  private snack  = inject(MatSnackBar);
  private ws     = inject(WsService);
  private wsSub  = new Subscription();

  subject   = signal<Subject | null>(null);
  exams     = signal<Exam[]>([]);
  aiResults = signal<Exam[]>([]);
  plans     = signal<TreatmentPlan[]>([]);
  showNewPlan = signal(false);
  uploading   = signal(false);
  uploadError = signal('');
  selectedAiExamId = signal<string | null>(null);
  expandedAgents   = signal<Set<string>>(new Set());
  selectedExamIds = signal(new Set<string>());
  comparison      = signal<ComparisonBlock[] | null>(null);

  sortedAiExams = computed(() =>
    [...this.aiResults()].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  );

  selectedAiExam = computed<Exam | null>(() => {
    const all = this.sortedAiExams();
    if (!all.length) return null;
    const id = this.selectedAiExamId();
    return id ? (all.find(e => e.id === id) ?? all[0]) : all[0];
  });

  doneExams = computed(() => this.exams().filter(e => e.status === 'done' && !!e.results?.length));

  selectedSortedExams = computed(() =>
    this.exams()
      .filter(e => this.selectedExamIds().has(e.id) && e.status === 'done')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  );

  readonly bloodTypes = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];

  editForm: Partial<Subject> = {};
  newPlan: { title: string; type: 'therapeutic'|'nutritional'; description: string; items: Partial<TreatmentItem>[] } = {
    title: '', type: 'therapeutic', description: '', items: []
  };

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.loadSubject(id);
    this.loadExams(id);
    this.loadPlans(id);
    this.subscribeToExamUpdates(id);
  }

  ngOnDestroy(): void { this.wsSub.unsubscribe(); }

  private subscribeToExamUpdates(subjectId: string): void {
    this.wsSub.add(
      this.ws.examUpdates$.subscribe(({ exam_id }) => {
        const match = this.exams().find(e => e.id === exam_id);
        if (!match) return;
        // Reload exam details to get results then update signals
        this.http.get<Exam>(`${environment.apiUrl}/exams/${exam_id}`).subscribe(updated => {
          this.exams.update(list => list.map(e => e.id === exam_id ? updated : e));
          if (updated.status === 'done') {
            this.aiResults.update(list => {
              const exists = list.some(e => e.id === exam_id);
              return exists ? list.map(e => e.id === exam_id ? updated : e) : [updated, ...list];
            });
          }
        });
      })
    );
    this.wsSub.add(
      this.ws.examError$.subscribe(({ exam_id }) => {
        if (this.exams().some(e => e.id === exam_id)) {
          this.exams.update(list => list.map(e => e.id === exam_id ? { ...e, status: 'error' } : e));
        }
      })
    );
  }

  private loadSubject(id: string): void {
    this.http.get<Subject>(`${environment.apiUrl}/patients/${id}`).subscribe(s => {
      this.subject.set(s);
      this.editForm = {
        ...s,
        birth_date: s.birth_date ? s.birth_date.toString().slice(0, 10) : undefined
      };
    });
  }

  private loadExams(id: string): void {
    this.http.get<Exam[]>(`${environment.apiUrl}/exams`).subscribe(all => {
      const mine = all.filter((e: any) => e.subject_id === id || e.patient_id === id);
      this.exams.set(mine);
      const done = mine.filter(e => e.status === 'done' && e.results?.length);
      this.aiResults.set(done);
      const latest = [...done].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];
      if (latest) this.initExpandedAgents(latest);
    });
  }

  private loadPlans(id: string): void {
    this.http.get<TreatmentPlan[]>(`${environment.apiUrl}/patients/${id}/treatments`)
      .subscribe(p => this.plans.set(p));
  }

  age(birthDate: string): string {
    const diff = Date.now() - new Date(birthDate).getTime();
    const years = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
    return `${years} anos`;
  }

  saveProfile(): void {
    const id = this.subject()!.id;
    this.http.put<Subject>(`${environment.apiUrl}/patients/${id}`, this.editForm).subscribe({
      next: s => {
        this.subject.set(s);
        this.editForm = { ...s, birth_date: s.birth_date ? s.birth_date.toString().slice(0, 10) : undefined };
        this.snack.open('Perfil salvo com sucesso.', 'OK', { duration: 3000 });
      },
      error: () => this.snack.open('Erro ao salvar perfil. Tente novamente.', 'Fechar', { duration: 5000 })
    });
  }

  toggleNewPlan(): void {
    this.showNewPlan.update(v => !v);
    this.newPlan = { title: '', type: 'therapeutic', description: '', items: [] };
  }

  addItem(): void {
    this.newPlan.items.push({ label: '', value: '', frequency: '', duration: '' });
  }

  removeItem(i: number): void {
    this.newPlan.items.splice(i, 1);
  }

  savePlan(): void {
    const id = this.subject()!.id;
    const body = { ...this.newPlan, items: this.newPlan.items.filter(i => i.label) };
    this.http.post<TreatmentPlan>(`${environment.apiUrl}/patients/${id}/treatments`, body)
      .subscribe(plan => {
        this.plans.update(p => [plan, ...p]);
        this.showNewPlan.set(false);
      });
  }

  private readonly SEV_COLORS: Record<string, string> = {
    critical: '#ffb4ab', high: '#ffcb6b', medium: '#c0c1ff', low: '#4ad6a0', none: '#464554'
  };

  topSeverity(alerts: Alert[]): string {
    if (!alerts?.length) return 'none';
    for (const s of ['critical', 'high', 'medium', 'low']) {
      if (alerts.some(a => a.severity?.toLowerCase() === s)) return s;
    }
    return 'none';
  }

  severityColor(sev: string): string {
    return this.SEV_COLORS[sev?.toLowerCase()] ?? '#464554';
  }

  sortedAlerts(alerts: Alert[]): Alert[] {
    return [...(alerts ?? [])].sort((a, b) =>
      (this.SEV_RANK[b.severity] ?? 0) - (this.SEV_RANK[a.severity] ?? 0)
    );
  }

  private readonly SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };

  private severityOf(s: string): number {
    return this.SEV_RANK[s?.toLowerCase()] ?? 0;
  }

  onAiExamSelect(id: string): void {
    this.selectedAiExamId.set(id);
    const exam = this.selectedAiExam();
    if (exam) this.initExpandedAgents(exam);
  }

  toggleAgent(agentType: string): void {
    const s = new Set(this.expandedAgents());
    s.has(agentType) ? s.delete(agentType) : s.add(agentType);
    this.expandedAgents.set(s);
  }

  private initExpandedAgents(exam: Exam): void {
    const results = exam.results ?? [];
    if (!results.length) { this.expandedAgents.set(new Set()); return; }
    const top = results.reduce((best, r) =>
      (this.SEV_RANK[this.topSeverity(r.alerts)] ?? 0) > (this.SEV_RANK[this.topSeverity(best.alerts)] ?? 0) ? r : best
    , results[0]);
    this.expandedAgents.set(new Set([top.agent_type]));
  }

  toggleExamSelection(id: string): void {
    const s = new Set(this.selectedExamIds());
    s.has(id) ? s.delete(id) : s.add(id);
    this.selectedExamIds.set(s);
    this.comparison.set(null);
  }

  compareExams(): void {
    const sorted = this.selectedSortedExams().filter(e => e.results?.length);

    if (sorted.length < 2) return;

    // Collect all agent types across selected exams
    const allAgents = [...new Set(sorted.flatMap(e => (e.results ?? []).map(r => r.agent_type)))];

    const blocks: ComparisonBlock[] = [];

    for (const agent of allAgents) {
      // Risk trajectory
      const risk_trajectory: string[] = sorted.map(e => {
        const r = (e.results ?? []).find(r => r.agent_type === agent);
        if (!r) return '—';
        const entries = Object.entries(r.risk_scores ?? {});
        return entries.length ? entries.map(([, v]) => v).join(' / ') : '—';
      });

      // Alert changes — compare consecutive pairs, keep most recent change per marker
      const latestChange = new Map<string, AlertChange>();

      for (let i = 1; i < sorted.length; i++) {
        const prev = (sorted[i - 1].results ?? []).find(r => r.agent_type === agent);
        const curr = (sorted[i].results ?? []).find(r => r.agent_type === agent);

        const prevAlerts = prev?.alerts ?? [];
        const currAlerts = curr?.alerts ?? [];

        const prevMap = new Map(prevAlerts.map(a => [a.marker.toLowerCase(), a]));
        const currMap = new Map(currAlerts.map(a => [a.marker.toLowerCase(), a]));

        // New and changed
        for (const [key, ca] of currMap) {
          const pa = prevMap.get(key);
          if (!pa) {
            latestChange.set(key, { marker: ca.marker, kind: 'new', to_severity: ca.severity, value: ca.value });
          } else {
            const diff = this.severityOf(ca.severity) - this.severityOf(pa.severity);
            if (diff > 0) {
              latestChange.set(key, { marker: ca.marker, kind: 'worsened', from_severity: pa.severity, to_severity: ca.severity, value: ca.value });
            } else if (diff < 0) {
              latestChange.set(key, { marker: ca.marker, kind: 'improved', from_severity: pa.severity, to_severity: ca.severity, value: ca.value });
            }
          }
        }
        // Resolved
        for (const [key, pa] of prevMap) {
          if (!currMap.has(key)) {
            latestChange.set(key, { marker: pa.marker, kind: 'resolved', from_severity: pa.severity });
          }
        }
      }

      const changes = [...latestChange.values()];
      const isConstant = risk_trajectory.every(v => v === risk_trajectory[0]);
      if (changes.length === 0 && isConstant) continue;

      blocks.push({ agent_type: agent, risk_trajectory, changes });
    }

    this.comparison.set(blocks);
  }

  private readonly AGENT_LABELS: Record<string, string> = {
    metabolic: 'Metabólico', cardiovascular: 'Cardiovascular',
    hematology: 'Hematologia', therapeutic: 'Terapêutico',
    nutrition: 'Nutrição', small_animals: 'Pequenos Animais',
    equine: 'Equino', bovine: 'Bovino'
  };
  agentLabel(type: string): string { return this.AGENT_LABELS[type] ?? type; }

  private readonly KIND_ICONS: Record<string, string> = {
    new: 'fiber_new', worsened: 'trending_up', improved: 'trending_down', resolved: 'check_circle'
  };
  kindIcon(kind: string): string { return this.KIND_ICONS[kind] ?? 'circle'; }

  private readonly KIND_COLORS: Record<string, string> = {
    new: '#ffb4ab', worsened: '#ffcb6b', improved: '#4ad6a0', resolved: '#908fa0'
  };
  kindColor(kind: string): string { return this.KIND_COLORS[kind] ?? '#908fa0'; }

  private readonly KIND_LABELS: Record<string, string> = {
    new: 'NOVO', worsened: 'PIOROU', improved: 'MELHOROU', resolved: 'RESOLVIDO'
  };
  kindLabel(kind: string): string { return this.KIND_LABELS[kind] ?? kind; }

  onExamFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const id = this.subject()!.id;
    this.uploading.set(true);
    this.uploadError.set('');
    const form = new FormData();
    form.append('patient_id', id);
    form.append('file', file);
    this.http.post<{ exam_id: string; status: string }>(`${environment.apiUrl}/exams`, form)
      .subscribe({
        next: ({ exam_id, status }) => {
          this.uploading.set(false);
          const newExam: Exam = {
            id: exam_id,
            subject_id: id,
            status: status as Exam['status'],
            source: 'upload',
            file_path: file.name,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            results: null
          };
          this.exams.update(e => [newExam, ...e]);
          (event.target as HTMLInputElement).value = '';
        },
        error: (err: any) => {
          this.uploading.set(false);
          this.uploadError.set(err.error?.error ?? 'Erro ao enviar exame');
        }
      });
  }
}
