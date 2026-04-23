import { Component, computed, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DatePipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ExamCardComponent } from '../../../shared/components/exam-card/exam-card.component';
import { environment } from '../../../../environments/environment';
import { Subject, Exam, Alert, TreatmentPlan, TreatmentItem, ClinicalResult, SPECIALTY_AGENTS, Prescription, Owner } from '../../../shared/models/api.models';
import { PrescriptionModalComponent, PrescriptionModalData } from '../../clinic/prescription/prescription-modal.component';
import { WsService } from '../../../core/ws/ws.service';
import { shortId, examTypeLabel } from '../../../shared/utils/id-format';
import { generateConsentTemplatePdf } from '../../../shared/utils/consent-pdf';
import { Subscription } from 'rxjs';

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
    MatChipsModule, MatDialogModule, MatCheckboxModule, MatMenuModule, MatAutocompleteModule, MatSnackBarModule, ExamCardComponent,
    PrescriptionModalComponent
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
      color: #a09fb2; cursor: pointer; background: none; border: none;
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
    .badge-sex    { background: rgba(70,69,84,0.2); color: #a09fb2; border: 1px solid rgba(70,69,84,0.3); }
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
      background: #111929; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 6px; padding: 1.5rem;
    }
    .profile-section.span-2 { grid-column: span 2; }
    .section-label {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.15em;
      color: #6e6d80; margin-bottom: 1rem;
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
      color: #7c7b8f; margin-top: 3px;
    }

    /* ── Evolução — mode toggle ── */
    .evolution-mode-toggle {
      display: inline-flex; gap: 0; margin-bottom: 1.5rem;
      background: #111929; border: 1px solid rgba(70,69,84,0.25);
      border-radius: 6px; padding: 2px;
    }
    .mode-btn {
      display: inline-flex; align-items: center; gap: 0.375rem;
      background: transparent; border: none; cursor: pointer;
      padding: 0.5rem 0.875rem; border-radius: 4px;
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.06em;
      color: #7c7b8f; transition: all 150ms;
    }
    .mode-btn:hover { color: #dae2fd; }
    .mode-btn.active {
      background: rgba(192,193,255,0.12); color: #c0c1ff;
    }
    .mode-btn mat-icon { font-size: 14px; width: 14px; height: 14px; }

    /* ── Por marcador ── */
    .marker-controls { margin-bottom: 1.25rem; }
    .marker-hint {
      font-family: 'Inter', sans-serif; font-size: 12px;
      color: #7c7b8f; margin-bottom: 0.625rem;
    }
    .marker-chips {
      display: flex; flex-wrap: wrap; gap: 0.375rem;
    }
    .marker-chip {
      display: inline-flex; align-items: center; gap: 4px;
      background: #0b1326; border: 1px solid rgba(70,69,84,0.3);
      color: #a09fb2; border-radius: 20px;
      padding: 0.375rem 0.75rem; cursor: pointer;
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      transition: all 150ms;
    }
    .marker-chip:hover:not(:disabled) {
      border-color: rgba(192,193,255,0.4); color: #dae2fd;
    }
    .marker-chip.selected {
      background: rgba(192,193,255,0.12); border-color: #c0c1ff; color: #c0c1ff;
    }
    .marker-chip:disabled { opacity: 0.35; cursor: not-allowed; }

    .marker-chart-wrap {
      background: #111929; border: 1px solid rgba(70,69,84,0.18);
      border-radius: 8px; padding: 1rem; height: 320px; position: relative;
      max-width: 900px;
    }
    .marker-chart-wrap canvas { height: 100% !important; }

    .marker-legend {
      display: flex; flex-direction: column; gap: 0.5rem;
      margin-top: 1rem; max-width: 900px;
    }
    .legend-item {
      display: flex; align-items: center; gap: 0.625rem;
      padding: 0.5rem 0.75rem; background: #0b1326;
      border-radius: 4px; border: 1px solid rgba(70,69,84,0.15);
    }
    .legend-color {
      width: 12px; height: 12px; border-radius: 50%;
      flex-shrink: 0;
    }
    .legend-marker {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 13px; color: #dae2fd; flex: 1;
    }
    .legend-stats {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #7c7b8f; display: inline-flex; align-items: center; gap: 0.375rem;
    }
    .trend-icon { font-size: 16px !important; width: 16px !important; height: 16px !important; }

    /* ── Evolução ── */
    .evolution-select-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem; }
    .evolution-exam-row {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.6rem 1rem; border-radius: 6px;
      background: #111929; border: 1px solid rgba(70,69,84,0.15);
      cursor: pointer;
    }
    .evolution-exam-row.selected { border-color: #c0c1ff; }
    .evolution-exam-meta { font-size: 13px; color: #7c7b8f; }
    .evolution-exam-date { font-weight: 600; color: #dae2fd; margin-right: 0.5rem; }
    .compare-btn { margin-bottom: 2rem; }
    .comparison-header {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      letter-spacing: 0.1em; color: #c0c1ff; text-transform: uppercase;
      margin-bottom: 1.5rem;
    }
    .comparison-blocks { display: flex; flex-direction: column; gap: 1.5rem; }
    .comp-chart-wrap { height: 180px; margin: 0.75rem 0 0.25rem; position: relative; }
    .comp-chart-wrap canvas { height: 100% !important; }
    .comp-block { background: #111929; border-radius: 8px; padding: 1rem 1.25rem; border: 1px solid rgba(70,69,84,0.15); }
    .comp-agent-header {
      display: flex; align-items: baseline; gap: 1rem; margin-bottom: 0.75rem;
    }
    .comp-agent-name {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 13px; text-transform: uppercase; color: #c0c1ff; letter-spacing: 0.05em;
    }
    .comp-risk-traj { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #7c7b8f; }
    .comp-changes { display: flex; flex-direction: column; gap: 0.4rem; }
    .comp-change-row { display: flex; align-items: center; gap: 0.5rem; font-size: 13px; }
    .comp-change-kind { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; min-width: 72px; }
    .comp-marker { color: #dae2fd; }
    .comp-severity { color: #7c7b8f; font-size: 12px; }
    .comp-empty { color: #7c7b8f; font-style: italic; font-size: 13px; }

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
    .exam-wrap.status-border-pending    { border-left: 4px solid #7c7b8f; }

    /* ── AI RESULTS (redesign) ── */
    .ai-exam-selector { margin-bottom: 1rem; padding-top: 0.75rem; }
    .ai-select-field { width: 300px; }
    .ai-status-strip { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
    .ai-agent-chip {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.4rem 0.75rem; background: #111929;
      border: 1px solid rgba(70,69,84,0.2); border-left: 3px solid;
      border-radius: 6px; cursor: pointer; transition: background 150ms;
    }
    .ai-agent-chip:hover { background: #1a2540; }
    .ai-chip-name {
      font-family: 'Space Grotesk', sans-serif; font-size: 12px;
      font-weight: 700; color: #dae2fd; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .ai-chip-sev { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; }
    .ai-chip-count { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #7c7b8f; }
    .ai-cards { display: flex; flex-direction: column; gap: 0.5rem; max-width: 860px; }
    .ai-card {
      background: #111929; border: 1px solid rgba(70,69,84,0.2);
      border-left: 4px solid; border-radius: 8px; overflow: hidden;
    }
    .ai-card-header {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.75rem 1rem; cursor: pointer; transition: background 150ms;
    }
    .ai-card-header:hover { background: #1a2540; }
    .ai-expand-icon { font-size: 18px !important; width: 18px !important; height: 18px !important; color: #7c7b8f; }
    .ai-card-name {
      font-family: 'Space Grotesk', sans-serif; font-size: 13px;
      font-weight: 700; color: #dae2fd; text-transform: uppercase; letter-spacing: 0.04em; flex: 1;
    }
    .ai-card-sev { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; }
    .ai-card-count { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #7c7b8f; }
    .ai-result-link {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #c0c1ff; text-decoration: none; white-space: nowrap; margin-left: auto;
    }
    .ai-result-link:hover { text-decoration: underline; }
    .ai-card-body { padding: 0 1rem 1rem 1rem; border-top: 1px solid rgba(70,69,84,0.15); }
    .ai-section-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.1em; color: #6e6d80;
      margin: 1rem 0 0.5rem 0;
    }
    .ai-alerts { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.5rem; }
    .ai-alert-row {
      display: flex; align-items: center; gap: 0.5rem;
      font-family: 'JetBrains Mono', monospace; font-size: 12px;
    }
    .ai-alert-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .ai-alert-marker { color: #dae2fd; flex: 1; }
    .ai-alert-value { color: #7c7b8f; }
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
      letter-spacing: 0.08em; color: #7c7b8f; flex-shrink: 0; padding-top: 2px; min-width: 88px;
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
      background: #111929; border: 1px solid rgba(70,69,84,0.2);
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
      color: #6e6d80; margin-top: 3px;
    }
    .plan-type-badge {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.1em;
      padding: 3px 10px; border-radius: 2px;
    }
    .type-therapeutic { background: rgba(192,193,255,0.1); color: #c0c1ff; }
    .type-nutritional  { background: rgba(74,214,160,0.1);  color: #4ad6a0; }
    .plan-desc { font-size: 13px; color: #7c7b8f; margin-bottom: 1rem; line-height: 1.5; }
    .items-table { width: 100%; border-collapse: collapse; }
    .items-table th {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.15em; color: #6e6d80;
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
    .item-row input:focus { border-color: #6e6d80; }
    .btn-icon {
      background: none; border: 1px solid rgba(70,69,84,0.3);
      color: #a09fb2; padding: 8px; border-radius: 4px;
      cursor: pointer; transition: all 0.15s;
    }
    .btn-icon:hover { border-color: #ffb4ab; color: #ffb4ab; }
    .add-item-btn {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: #a09fb2; background: none; border: 1px dashed rgba(70,69,84,0.3);
      padding: 8px 14px; border-radius: 4px; cursor: pointer;
      transition: all 0.15s; margin-top: 4px;
    }
    .add-item-btn:hover { border-color: #c0c1ff; color: #c0c1ff; }
    .form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 1rem; }

    .empty-state {
      font-size: 14px; color: #7c7b8f; padding: 3rem; text-align: center;
    }

    .plan-status-active    { color: #4ad6a0; }
    .plan-status-completed { color: #c0c1ff; }
    .plan-status-cancelled { color: #7c7b8f; }

    /* ── CONSENT status ── */
    .consent-status {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.75rem 1rem; border-radius: 6px;
      font-family: 'Inter', sans-serif; font-size: 13px;
    }
    .consent-status mat-icon { font-size: 22px; width: 22px; height: 22px; flex-shrink: 0; }
    .consent-ok {
      background: rgba(74,214,160,0.08); color: #4ad6a0;
      border: 1px solid rgba(74,214,160,0.2);
    }
    .consent-ok mat-icon { color: #4ad6a0; }
    .consent-missing {
      background: rgba(255,203,107,0.08); color: #f5c14a;
      border: 1px solid rgba(255,203,107,0.2);
    }
    .consent-missing mat-icon { color: #f5c14a; }

    /* ── TREATMENTS — two-section layout ── */
    .treatments-section { margin-bottom: 2rem; max-width: 900px; }
    .section-header {
      display: flex; align-items: center; gap: 0.75rem;
      margin-bottom: 1rem; padding-bottom: 0.5rem;
      border-bottom: 1px solid rgba(70,69,84,0.18);
    }
    .section-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 0.9375rem; color: #dae2fd;
    }
    .section-count {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      background: rgba(73,75,214,0.15); color: #c0c1ff;
      border: 1px solid rgba(73,75,214,0.3);
      padding: 2px 8px; border-radius: 20px;
    }
    .empty-state-small {
      font-size: 13px; color: #7c7b8f; padding: 1rem; margin: 0;
      font-style: italic;
    }

    /* ── PRESCRIPTION CARD ── */
    .prescription-card {
      background: #111929; border: 1px solid rgba(70,69,84,0.2);
      border-left: 3px solid #c0c1ff; border-radius: 6px;
      padding: 1.125rem 1.25rem; margin-bottom: 0.75rem;
    }
    .prescription-card.agent-nutrition { border-left-color: #4ad6a0; }
    .prescription-header {
      display: flex; justify-content: space-between;
      align-items: flex-start; gap: 1rem; margin-bottom: 0.75rem;
    }
    .prescription-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 14px; color: #dae2fd; margin-top: 6px;
      display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
    }
    .prescription-id-chip {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      font-weight: 700; letter-spacing: 0.06em;
      color: #c0c1ff; background: rgba(192,193,255,0.08);
      border: 1px solid rgba(192,193,255,0.2);
      padding: 1px 6px; border-radius: 3px;
    }
    .prescription-meta {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #6e6d80; margin-top: 4px;
    }
    .exam-link {
      color: #c0c1ff; cursor: pointer; text-decoration: none;
      border-bottom: 1px dashed rgba(192,193,255,0.3);
      transition: border-color 150ms;
    }
    .exam-link:hover { border-bottom-color: #c0c1ff; }
    .badge-ia {
      display: inline-block;
      font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.1em;
      padding: 3px 8px; border-radius: 3px;
    }
    .badge-therapeutic { background: rgba(192,193,255,0.12); color: #c0c1ff; }
    .badge-nutrition   { background: rgba(74,214,160,0.12);  color: #4ad6a0; }
    .prescription-actions { display: flex; gap: 0.375rem; align-items: center; flex-shrink: 0; }
    .prescription-notes {
      font-family: 'Inter', sans-serif; font-size: 12px; color: #a09fb2;
      padding: 0.625rem 0.875rem; background: rgba(70,69,84,0.08);
      border-left: 2px solid rgba(192,193,255,0.3); border-radius: 3px;
      margin-top: 0.5rem;
    }
    .danger { color: #ffb4ab !important; }
    .danger ::ng-deep .mat-icon { color: #ffb4ab !important; }

    /* ── UPLOAD CONFIRMATION PANEL ── */
    .upload-panel {
      background: #111929; border: 1px solid rgba(192,193,255,0.15);
      border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; max-width: 700px;
    }
    .upload-panel-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 13px; color: #dae2fd; margin-bottom: 1rem;
    }
    .upload-file-chip {
      display: inline-flex; align-items: center; gap: 6px;
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #c0c1ff; background: rgba(73,75,214,0.1);
      border: 1px solid rgba(73,75,214,0.25); padding: 4px 10px;
      border-radius: 4px; margin-bottom: 1rem;
    }
    .agents-section-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.15em; color: #6e6d80;
      margin-bottom: 0.5rem;
    }
    .agents-row { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .agent-check {
      display: flex; align-items: center; gap: 6px;
      background: #0b1326; border: 1px solid rgba(70,69,84,0.3);
      border-radius: 6px; padding: 0.5rem 0.75rem; cursor: pointer;
      transition: border-color 150ms;
    }
    .agent-check.selected { border-color: rgba(192,193,255,0.4); }
    .agent-check-label {
      font-family: 'Space Grotesk', sans-serif; font-size: 12px;
      font-weight: 600; color: #c7c4d7;
    }
    .upload-panel-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 1rem; }
    .upload-panel-error { color: #ffb4ab; font-size: 12px; margin-top: 0.5rem; }

    /* ══════════════ MOBILE (< 640px) ══════════════
     * Desktop permanece intacto. Abaixo só reduções de grid, padding e font
     * onde o viewport exige. Tablet (640–1024) herda a maior parte.
     */
    @media (max-width: 639px) {
      .page-header { padding: 1rem 1rem 0; }
      .subject-header { flex-direction: column; align-items: flex-start; gap: 0.75rem; }
      .subject-name { font-size: 1.25rem; }
      ::ng-deep .mat-mdc-tab-labels { padding: 0 0.5rem !important; }
      ::ng-deep .mat-mdc-tab-body-wrapper { padding: 1rem !important; }

      .profile-grid { grid-template-columns: 1fr !important; gap: 1rem; max-width: 100%; }
      .profile-section.span-2 { grid-column: span 1; }
      .profile-section { padding: 1rem; }

      .field-pair, .field-trio { grid-template-columns: 1fr !important; gap: 0.75rem; }

      /* Tabela de itens: cabeçalho some, cada linha vira card empilhado */
      .items-table { display: block; width: 100%; }
      .items-table tr {
        display: block;
        padding: 0.625rem 0;
        border-bottom: 1px dashed rgba(70,69,84,0.2);
      }
      .items-table tr:first-child { display: none; }
      .items-table td {
        display: inline-block;
        padding: 2px 10px 2px 0;
        font-size: 12.5px;
        color: #a09fb2;
        border-bottom: none !important;
      }
      .items-table td.td-label {
        display: block;
        font-size: 14px; color: #dae2fd; font-weight: 600;
        margin-bottom: 4px;
      }

      /* Cards de evolução e comparação */
      .comp-chart-wrap { height: 160px; }
      .marker-chart-wrap { height: 260px; padding: 0.5rem; }
      .marker-legend { gap: 0.375rem; }

      /* Card de prescrição da IA */
      .prescription-card { padding: 0.875rem 1rem; }
      .prescription-header { flex-direction: column; align-items: flex-start; gap: 0.75rem; }
      .prescription-actions { width: 100%; justify-content: flex-end; }
      .treatments-header { flex-direction: column; align-items: flex-start; gap: 0.5rem; }

      /* Owner card */
      .owner-card { flex-direction: column; align-items: flex-start; gap: 0.5rem; }

      /* Formulário de novo plano — item rows */
      .item-row { grid-template-columns: 1fr !important; gap: 0.375rem; }
      .item-row .btn-icon { justify-self: flex-end; }

      /* Upload panel */
      .upload-panel { padding: 1rem; }
      .upload-panel-actions { flex-direction: column; align-items: stretch; }
      .upload-panel-actions button { width: 100%; }

      /* Evolução mode toggle — wrap se muitos botões */
      .evolution-mode-toggle { flex-wrap: wrap; }

      /* Marker chips — não disabled aparência pesada */
      .marker-chips { gap: 0.25rem; }
      .marker-chip { padding: 0.3125rem 0.625rem; font-size: 10.5px; }

      /* Back link */
      .back-link { margin-bottom: 0.75rem; }
    }
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

      <mat-tab-group animationDuration="150ms"
                     [selectedIndex]="selectedTabIndex()"
                     (selectedIndexChange)="selectedTabIndex.set($event)">

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

              <!-- Contexto Clínico (human only) -->
              @if (subject()!.subject_type === 'human') {
                <div class="profile-section span-2">
                  <div class="section-label">Contexto Clínico</div>
                  <div class="field-row">
                    <div class="field-pair">
                      <mat-form-field appearance="outline">
                        <mat-label>Tabagismo</mat-label>
                        <mat-select [(ngModel)]="editForm.smoking">
                          <mat-option value="">Não informado</mat-option>
                          <mat-option value="never">Nunca fumou</mat-option>
                          <mat-option value="former">Ex-fumante</mat-option>
                          <mat-option value="current_light">Fumante leve (&lt;10/dia)</mat-option>
                          <mat-option value="current_heavy">Fumante pesado (≥10/dia)</mat-option>
                        </mat-select>
                      </mat-form-field>
                      <mat-form-field appearance="outline">
                        <mat-label>Consumo de álcool</mat-label>
                        <mat-select [(ngModel)]="editForm.alcohol">
                          <mat-option value="">Não informado</mat-option>
                          <mat-option value="none">Não consome</mat-option>
                          <mat-option value="occasional">Ocasional</mat-option>
                          <mat-option value="moderate">Moderado</mat-option>
                          <mat-option value="heavy">Abusivo</mat-option>
                        </mat-select>
                      </mat-form-field>
                    </div>
                    <div class="field-pair">
                      <mat-form-field appearance="outline">
                        <mat-label>Dieta</mat-label>
                        <mat-select [(ngModel)]="editForm.diet_type">
                          <mat-option value="">Não informado</mat-option>
                          <mat-option value="omnivore">Onívora</mat-option>
                          <mat-option value="vegetarian">Vegetariana</mat-option>
                          <mat-option value="vegan">Vegana</mat-option>
                          <mat-option value="low_carb">Low Carb</mat-option>
                          <mat-option value="mediterranean">Mediterrânea</mat-option>
                          <mat-option value="other">Outra</mat-option>
                        </mat-select>
                      </mat-form-field>
                      <mat-form-field appearance="outline">
                        <mat-label>Atividade física</mat-label>
                        <mat-select [(ngModel)]="editForm.physical_activity">
                          <mat-option value="">Não informado</mat-option>
                          <mat-option value="sedentary">Sedentário</mat-option>
                          <mat-option value="light">Leve (1–2x/sem)</mat-option>
                          <mat-option value="moderate">Moderada (3–4x/sem)</mat-option>
                          <mat-option value="intense">Intensa (5+x/sem)</mat-option>
                        </mat-select>
                      </mat-form-field>
                    </div>
                    <mat-form-field appearance="outline">
                      <mat-label>Medicamentos em uso</mat-label>
                      <textarea matInput rows="2" [(ngModel)]="editForm.medications"
                                placeholder="Ex: metformina 500mg, atorvastatina 20mg..."></textarea>
                    </mat-form-field>
                    <mat-form-field appearance="outline">
                      <mat-label>Histórico familiar relevante</mat-label>
                      <textarea matInput rows="2" [(ngModel)]="editForm.family_history"
                                placeholder="Ex: pai com IAM aos 55, mãe com DM2..."></textarea>
                    </mat-form-field>
                  </div>
                </div>
              }

              <!-- Owner selector (vet only) -->
              @if (subject()!.subject_type === 'animal') {
                <div class="profile-section">
                  <div class="section-label">Dono / Tutor</div>
                  <mat-form-field appearance="outline">
                    <mat-label>Vincular dono</mat-label>
                    <input matInput type="text"
                           [matAutocomplete]="ownerAuto"
                           [value]="ownerQuery()"
                           (input)="onOwnerQueryInput($event)"
                           placeholder="Digite o nome do dono..."/>
                    @if (editForm.owner_id) {
                      <button mat-icon-button matSuffix type="button" (click)="clearOwner($event)" aria-label="Remover vínculo">
                        <mat-icon>close</mat-icon>
                      </button>
                    }
                  </mat-form-field>
                  <mat-autocomplete #ownerAuto="matAutocomplete"
                                    (optionSelected)="onOwnerSelected($event)"
                                    [displayWith]="displayOwner">
                    @for (o of filteredOwners(); track o.id) {
                      <mat-option [value]="o">
                        {{ o.name }}{{ o.cpf_last4 ? ' (***' + o.cpf_last4 + ')' : '' }}
                      </mat-option>
                    }
                    @if (filteredOwners().length === 0 && ownerQuery()) {
                      <mat-option disabled>Nenhum dono encontrado.</mat-option>
                    }
                  </mat-autocomplete>
                  @if (subject()!.owner_name) {
                    <div class="owner-meta" style="margin-top:0.5rem">
                      Atual: {{ subject()!.owner_name }}
                      @if (subject()!.owner_cpf_last4) { · CPF ***{{ subject()!.owner_cpf_last4 }} }
                      @if (subject()!.owner_phone) { · {{ subject()!.owner_phone }} }
                    </div>
                  }
                </div>
              }

              <div class="profile-section span-2">
                <div class="section-label">Consentimento LGPD</div>
                @if (subject()!.consent_given_at) {
                  <div class="consent-status consent-ok">
                    <mat-icon>verified</mat-icon>
                    <div>
                      <div style="font-weight:600">Consentimento registrado</div>
                      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#a09fb2;margin-top:2px">
                        em {{ subject()!.consent_given_at | date:'dd/MM/yyyy HH:mm' }}
                      </div>
                    </div>
                  </div>
                } @else {
                  <div class="consent-status consent-missing">
                    <mat-icon>warning</mat-icon>
                    <div>
                      <div style="font-weight:600">Consentimento não registrado</div>
                      <div style="font-size:12px;color:#d4b464;margin-top:2px">
                        Obtenha a assinatura do termo físico antes de marcar como aceito.
                      </div>
                    </div>
                  </div>
                  <mat-checkbox color="primary" [(ngModel)]="editForm.consent_given" style="margin-top:0.75rem">
                    <span style="font-family:'Inter',sans-serif;font-size:13px;color:#dae2fd">
                      Confirmo que o paciente (ou responsável legal) assinou o termo de consentimento LGPD.
                    </span>
                  </mat-checkbox>
                  <button type="button" mat-stroked-button style="margin-top:0.5rem;font-size:11px" (click)="downloadConsentTemplate()">
                    <mat-icon>download</mat-icon>
                    Baixar template para impressão
                  </button>
                }
              </div>

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
          <input #examFile type="file" accept=".pdf,.dcm,.dicom,.jpg,.jpeg,.png,.tiff" style="display:none"
                 (change)="onExamFile($event)"/>

          @if (!pendingFile()) {
            <div class="exams-upload-row">
              <button mat-stroked-button class="upload-exam-btn" (click)="examFile.click()"
                      [disabled]="uploading()">
                <mat-icon>upload_file</mat-icon>
                Upload de Exame
              </button>
              <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#6e6d80;letter-spacing:0.08em">
                PDF · DICOM · JPG · PNG
              </span>
              @if (uploadError()) {
                <span class="upload-error">{{ uploadError() }}</span>
              }
            </div>
          } @else {
            <div class="upload-panel">
              <div class="upload-panel-title">Confirmar envio de exame</div>
              <div class="upload-file-chip">
                <mat-icon style="font-size:14px;width:14px;height:14px">description</mat-icon>
                {{ pendingFile()!.name }}
              </div>

              @if (subject()?.subject_type === 'human') {
                <div class="agents-section-label">Agentes de análise</div>
                <div class="agents-row">
                  @for (agent of humanPhase1Agents; track agent.value) {
                    <div class="agent-check" [class.selected]="uploadAgents().includes(agent.value)"
                         (click)="toggleUploadAgent(agent.value)">
                      <mat-checkbox [checked]="uploadAgents().includes(agent.value)"
                                    (click)="$event.stopPropagation()"
                                    (change)="toggleUploadAgent(agent.value)" color="primary"/>
                      <span class="agent-check-label">{{ agent.label }}</span>
                    </div>
                  }
                </div>

                <mat-form-field appearance="outline" style="width:100%;margin-bottom:0.75rem">
                  <mat-label>Queixa principal</mat-label>
                  <input matInput [(ngModel)]="chiefComplaintValue"
                         placeholder="Ex: dor no peito, fadiga persistente..."/>
                </mat-form-field>

                <mat-form-field appearance="outline" style="width:100%">
                  <mat-label>Sintomas atuais</mat-label>
                  <textarea matInput rows="2" [(ngModel)]="currentSymptomsValue"
                            placeholder="Ex: dispneia aos esforços, edema em MMII..."></textarea>
                </mat-form-field>
              }

              <div class="upload-panel-actions">
                <button mat-button (click)="cancelUpload()">Cancelar</button>
                <button mat-flat-button style="background:#c0c1ff;color:#1000a9;font-weight:700"
                        [disabled]="uploading()" (click)="submitUpload()">
                  <mat-icon>send</mat-icon>
                  {{ uploading() ? 'Enviando…' : 'Enviar para análise' }}
                </button>
              </div>

              @if (uploadError()) {
                <div class="upload-panel-error">{{ uploadError() }}</div>
              }
            </div>
          }
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

                        @if (getStandardRecs(cr.recommendations).length) {
                          <div class="ai-section-label">RECOMENDAÇÕES</div>
                          <div class="ai-recs">
                            @for (rec of getStandardRecs(cr.recommendations); track rec.description) {
                              <div class="ai-rec-item"
                                   [style.border-left-color]="severityColor(rec.priority === 'high' ? 'high' : rec.priority === 'medium' ? 'medium' : 'low')">
                                <span class="ai-rec-type">{{ rec.type.toUpperCase() }}</span>
                                <div>
                                  @if (rec.type === 'medication' && rec.name) {
                                    <div style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:#dae2fd;margin-bottom:2px;">
                                      {{ rec.name }}
                                      @if (rec.dose) { <span style="font-weight:400;color:#c0c1ff"> · {{ rec.dose }}</span> }
                                      @if (rec.frequency) { <span style="font-weight:400;color:#a09fb2"> · {{ rec.frequency }}</span> }
                                      @if (rec.duration) { <span style="font-weight:400;color:#7c7b8f"> · {{ rec.duration }}</span> }
                                    </div>
                                  }
                                  <span class="ai-rec-desc">{{ rec.description }}</span>
                                </div>
                              </div>
                            }
                          </div>
                        }

                        @if (getSuggestedExams(cr.recommendations).length) {
                          <div class="ai-section-label">EXAMES SUGERIDOS</div>
                          <div class="ai-recs">
                            @for (rec of getSuggestedExams(cr.recommendations); track rec.description) {
                              <div class="ai-rec-item" [style.border-left-color]="severityColor('medium')">
                                <span class="ai-rec-type">EXAME</span>
                                <div>
                                  <span class="ai-rec-desc">{{ rec._exam }}</span>
                                  @if (rec._rationale) {
                                    <div style="font-family:'Inter',sans-serif;font-size:11px;color:#7c7b8f;margin-top:2px;font-style:italic">{{ rec._rationale }}</div>
                                  }
                                </div>
                              </div>
                            }
                          </div>
                        }

                        @if (getContextualFactors(cr.recommendations).length) {
                          <div class="ai-section-label">FATORES CONTEXTUAIS</div>
                          <div class="ai-recs">
                            @for (rec of getContextualFactors(cr.recommendations); track rec.description) {
                              <div class="ai-rec-item" [style.border-left-color]="severityColor('low')">
                                <span class="ai-rec-type">CONTEXTO</span>
                                <span class="ai-rec-desc">{{ rec.description }}</span>
                              </div>
                            }
                          </div>
                        }

                        @if (cr.agent_type === 'therapeutic' || cr.agent_type === 'nutrition') {
                          <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid rgba(70,69,84,0.1);">
                            <button mat-stroked-button style="font-size:11px;" (click)="openPrescriptionFromDetail(exam, cr)">
                              <mat-icon>description</mat-icon>
                              {{ cr.agent_type === 'therapeutic' ? 'Gerar Receita' : 'Gerar Prescrição Nutricional' }}
                            </button>

                            @if ((prescriptionsByExam()[exam.id]?.[cr.agent_type] ?? []).length > 0) {
                              <div style="margin-top:0.5rem;">
                                @for (p of prescriptionsByExam()[exam.id][cr.agent_type]; track p.id) {
                                  <div style="display:flex;align-items:center;gap:0.5rem;padding:0.375rem 0.625rem;background:#0b1326;border-radius:4px;margin-bottom:0.25rem;">
                                    <mat-icon style="font-size:14px;width:14px;height:14px;color:#c0c1ff;">description</mat-icon>
                                    <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#a09fb2;flex:1;">
                                      {{ p.created_at | date:'dd/MM/yyyy' }}
                                    </span>
                                    <button mat-icon-button style="width:24px;height:24px;" (click)="openPrescriptionFromDetail(exam, cr, p)">
                                      <mat-icon style="font-size:14px;">open_in_new</mat-icon>
                                    </button>
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
              </div>
            }
          }
        </mat-tab>

        <!-- ── EVOLUÇÃO ── -->
        <mat-tab label="Evolução">
          <div class="evolution-mode-toggle">
            <button class="mode-btn" [class.active]="evolutionMode() === 'compare'"
                    (click)="evolutionMode.set('compare')">
              <mat-icon>compare_arrows</mat-icon> Comparar exames
            </button>
            <button class="mode-btn" [class.active]="evolutionMode() === 'marker'"
                    (click)="evolutionMode.set('marker')">
              <mat-icon>show_chart</mat-icon> Por marcador
            </button>
          </div>

          @if (evolutionMode() === 'marker') {
            @if (availableMarkers().length === 0) {
              <p class="empty-state">Nenhum marcador numérico disponível nos exames analisados.</p>
            } @else {
              <div class="marker-controls">
                <div class="marker-hint">
                  Selecione até 3 marcadores para comparar a evolução no tempo.
                </div>
                <div class="marker-chips">
                  @for (m of availableMarkers(); track m) {
                    <button class="marker-chip"
                            [class.selected]="selectedMarkers().has(m)"
                            [disabled]="!selectedMarkers().has(m) && selectedMarkers().size >= 3"
                            (click)="toggleMarker(m)">
                      @if (selectedMarkers().has(m)) {
                        <mat-icon style="font-size:13px;width:13px;height:13px">check</mat-icon>
                      }
                      {{ m }}
                    </button>
                  }
                </div>
              </div>

              @if (selectedMarkers().size === 0) {
                <p class="empty-state">Selecione pelo menos 1 marcador acima para visualizar o gráfico.</p>
              } @else {
                <div class="marker-chart-wrap">
                  <canvas id="marker-evolution-chart"></canvas>
                </div>

                <div class="marker-legend">
                  @for (entry of markerSeriesPreview(); track entry.marker) {
                    <div class="legend-item">
                      <span class="legend-color" [style.background]="entry.color"></span>
                      <span class="legend-marker">{{ entry.marker }}</span>
                      <span class="legend-stats">
                        min {{ entry.min }} · max {{ entry.max }} · último {{ entry.last }}
                        @if (entry.trend) {
                          <mat-icon class="trend-icon" [style.color]="entry.trendColor">{{ entry.trendIcon }}</mat-icon>
                        }
                      </span>
                    </div>
                  }
                </div>
              }
            }
          } @else if (doneExams().length < 2) {
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
                      </div>
                      <div class="comp-chart-wrap">
                        <canvas [id]="'evo-chart-' + block.agent_type"></canvas>
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
        <mat-tab [label]="'Tratamentos (' + (prescriptions().length + plans().length) + ')'">

          <!-- ── Seção 1: Prescrições da IA ── -->
          <div class="treatments-section">
            <div class="section-header">
              <span class="section-title">Prescrições da IA</span>
              <span class="section-count">{{ prescriptions().length }}</span>
            </div>

            @if (prescriptions().length === 0) {
              <p class="empty-state-small">
                Nenhuma prescrição da IA. Gere uma a partir de uma análise terapêutica ou nutricional em "Análises IA".
              </p>
            }

            @for (p of prescriptions(); track p.id) {
              <div class="prescription-card" [class]="'agent-' + p.agent_type">
                <div class="prescription-header">
                  <div>
                    <span class="badge-ia" [class]="'badge-' + p.agent_type">
                      IA · {{ p.agent_type === 'therapeutic' ? 'Terapêutico' : 'Nutricional' }}
                    </span>
                    <div class="prescription-title">
                      Prescrição {{ p.agent_type === 'therapeutic' ? 'Terapêutica' : 'Nutricional' }}
                      <span class="prescription-id-chip">{{ prescriptionShortId(p) }}</span>
                    </div>
                    <div class="prescription-meta">
                      Criada em {{ p.created_at | date:'dd/MM/yyyy HH:mm' }}
                      @if (p.exam_created_at) {
                        · <a class="exam-link" (click)="goToAnalysis(p.exam_id, p.agent_type)">
                            Baseada em {{ examShortId(p.exam_id) }}{{ examContextOf(p) ? ' · ' + examContextOf(p) : '' }} ({{ p.exam_created_at | date:'dd/MM/yyyy' }})
                          </a>
                      }
                    </div>
                  </div>
                  <div class="prescription-actions">
                    @if (p.pdf_url) {
                      <button mat-stroked-button style="font-size:12px" (click)="downloadPrescriptionPdf(p)">
                        <mat-icon style="font-size:16px;width:16px;height:16px">download</mat-icon>
                        Baixar PDF
                      </button>
                    } @else {
                      <button mat-stroked-button style="font-size:12px" (click)="editPrescription(p)">
                        <mat-icon style="font-size:16px;width:16px;height:16px">picture_as_pdf</mat-icon>
                        Gerar PDF
                      </button>
                    }
                    <button mat-icon-button [matMenuTriggerFor]="actionMenu" style="width:32px;height:32px">
                      <mat-icon style="font-size:18px;width:18px;height:18px">more_vert</mat-icon>
                    </button>
                    <mat-menu #actionMenu="matMenu">
                      <button mat-menu-item (click)="editPrescription(p)">
                        <mat-icon>edit</mat-icon> Editar
                      </button>
                      @if (p.pdf_url) {
                        <button mat-menu-item (click)="editPrescription(p)">
                          <mat-icon>share</mat-icon> Compartilhar
                        </button>
                      }
                      <button mat-menu-item class="danger" (click)="deletePrescription(p)">
                        <mat-icon>delete</mat-icon> Excluir
                      </button>
                    </mat-menu>
                  </div>
                </div>

                @if (p.items.length) {
                  <table class="items-table">
                    <tr>
                      <th>Item</th><th>Dose</th><th>Frequência</th><th>Duração</th>
                    </tr>
                    @for (item of p.items; track $index) {
                      <tr>
                        <td class="td-label">{{ item.name }}</td>
                        <td>{{ item.dose || '—' }}</td>
                        <td>{{ item.frequency || '—' }}</td>
                        <td>{{ item.duration || '—' }}</td>
                      </tr>
                    }
                  </table>
                }

                @if (p.notes) {
                  <div class="prescription-notes">{{ p.notes }}</div>
                }
              </div>
            }
          </div>

          <!-- ── Seção 2: Planos Manuais ── -->
          <div class="treatments-header" style="margin-top: 0.5rem;">
            <span class="treatments-title">Planos Manuais</span>
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
  private dialog = inject(MatDialog);
  private ws     = inject(WsService);
  private wsSub?: Subscription;
  private pollInterval?: ReturnType<typeof setInterval>;

  subject   = signal<Subject | null>(null);
  exams     = signal<Exam[]>([]);
  aiResults = signal<Exam[]>([]);
  plans     = signal<TreatmentPlan[]>([]);
  prescriptions = signal<Prescription[]>([]);
  owners    = signal<Owner[]>([]);
  ownerQuery = signal('');

  filteredOwners = computed<Owner[]>(() => {
    const q = this.ownerQuery().toLowerCase().trim();
    const all = this.owners();
    if (!q) return all.slice(0, 20);
    return all.filter(o => o.name.toLowerCase().includes(q)).slice(0, 20);
  });
  selectedTabIndex = signal(0);
  showNewPlan = signal(false);
  uploading   = signal(false);
  uploadError = signal('');
  selectedAiExamId = signal<string | null>(null);
  expandedAgents   = signal<Set<string>>(new Set());
  selectedExamIds = signal(new Set<string>());
  comparison      = signal<ComparisonBlock[] | null>(null);
  evolutionMode   = signal<'compare' | 'marker'>('marker');
  selectedMarkers = signal(new Set<string>());
  prescriptionsByExam = signal<Record<string, Record<string, Prescription[]>>>({});
  private evoCharts: Chart[] = [];

  private readonly AI_TAB_INDEX = 2;

  pendingFile     = signal<File | null>(null);
  uploadAgents    = signal<string[]>([]);
  doctorSpecialty = signal<string | null>(null);
  chiefComplaintValue  = '';
  currentSymptomsValue = '';

  readonly humanPhase1Agents = [
    { value: 'metabolic',       label: 'Metabólico' },
    { value: 'cardiovascular',  label: 'Cardiovascular' },
    { value: 'hematology',      label: 'Hematologia' }
  ];

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

  editForm: Partial<Subject> & { consent_given?: boolean } = {};
  newPlan: { title: string; type: 'therapeutic'|'nutritional'; description: string; items: Partial<TreatmentItem>[] } = {
    title: '', type: 'therapeutic', description: '', items: []
  };

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.loadSubject(id);
    this.loadExams(id);
    this.loadPlans(id);
    this.loadPrescriptions(id);
    this.loadOwners();
    this.http.get<{ specialty: string | null }>(`${environment.apiUrl}/auth/me`)
      .subscribe({ next: me => this.doctorSpecialty.set(me.specialty ?? null), error: () => {} });
    this.wsSub = new Subscription();
    this.wsSub.add(this.ws.examUpdates$.subscribe(({ exam_id }) => {
      const isThisPatient = this.exams().some(e => e.id === exam_id);
      this.loadExams(id);
      if (isThisPatient) {
        this.snack.open('Resultado disponível!', 'Ver', { duration: 5000 })
          .onAction().subscribe(() => window.location.href = `/doctor/results/${exam_id}`);
      }
    }));
    this.wsSub.add(this.ws.reconnect$.subscribe(() => this.loadExams(id)));
    this.pollInterval = setInterval(() => {
      const hasPending = this.exams().some(e => e.status === 'pending' || e.status === 'processing');
      if (hasPending) this.loadExams(id);
    }, 8000);
  }

  private loadSubject(id: string): void {
    this.http.get<Subject>(`${environment.apiUrl}/patients/${id}`).subscribe(s => {
      this.subject.set(s);
      this.editForm = {
        ...s,
        birth_date: s.birth_date ? s.birth_date.toString().slice(0, 10) : undefined
      };
      if (s.owner_name) this.ownerQuery.set(s.owner_name);
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
      if (latest) {
        this.initExpandedAgents(latest);
        this.loadPrescriptionsForExam(latest.id);
      }
    });
  }

  loadPrescriptionsForExam(examId: string): void {
    this.http.get<Prescription[]>(`${environment.apiUrl}/prescriptions/exams/${examId}`).subscribe({
      next: (list) => {
        const map: Record<string, Prescription[]> = {};
        list.forEach(p => {
          if (!map[p.agent_type]) map[p.agent_type] = [];
          map[p.agent_type].push(p);
        });
        this.prescriptionsByExam.update(current => ({ ...current, [examId]: map }));
      },
      error: () => {}
    });
  }

  openPrescriptionFromDetail(exam: Exam, result: ClinicalResult, existing?: Prescription): void {
    const s = this.subject();
    if (!s) return;
    const module: 'human' | 'veterinary' = s.subject_type === 'animal' ? 'veterinary' : 'human';
    const data: PrescriptionModalData = {
      examId: exam.id,
      subjectId: s.id,
      subject: s,
      result,
      module,
      existingPrescription: existing
    };
    const ref = this.dialog.open(PrescriptionModalComponent, { width: '680px', panelClass: 'dark-dialog', data });
    ref.afterClosed().subscribe(saved => {
      if (saved) {
        this.loadPrescriptionsForExam(exam.id);
        this.loadPrescriptions(s.id);
      }
    });
  }

  private loadPlans(id: string): void {
    this.http.get<TreatmentPlan[]>(`${environment.apiUrl}/patients/${id}/treatments`)
      .subscribe(p => this.plans.set(p));
  }

  private loadPrescriptions(subjectId: string): void {
    this.http.get<Prescription[]>(`${environment.apiUrl}/prescriptions/subjects/${subjectId}`)
      .subscribe({
        next: list => this.prescriptions.set(list),
        error: () => {}
      });
  }

  private loadOwners(): void {
    this.http.get<Owner[]>(`${environment.apiUrl}/patients/owners`)
      .subscribe({
        next: list => this.owners.set(list),
        error: () => {}
      });
  }

  onOwnerQueryInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.ownerQuery.set(value);
    if (!value.trim()) this.editForm.owner_id = null;
  }

  onOwnerSelected(event: MatAutocompleteSelectedEvent): void {
    const owner = event.option.value as Owner;
    this.editForm.owner_id = owner.id;
    this.ownerQuery.set(owner.name);
  }

  clearOwner(event: Event): void {
    event.stopPropagation();
    this.editForm.owner_id = null;
    this.ownerQuery.set('');
  }

  displayOwner = (owner: Owner | string | null): string => {
    if (!owner) return '';
    if (typeof owner === 'string') return owner;
    return owner.name ?? '';
  };

  goToAnalysis(examId: string, agentType: string): void {
    this.selectedAiExamId.set(examId);
    this.expandedAgents.set(new Set([agentType]));
    this.selectedTabIndex.set(this.AI_TAB_INDEX);
  }

  prescriptionShortId(p: Prescription): string {
    return shortId(p.id, 'PR');
  }

  examShortId(examId: string): string {
    return shortId(examId, 'EX');
  }

  examContextOf(p: Prescription): string {
    const exam = this.exams().find(e => e.id === p.exam_id);
    return examTypeLabel(exam?.results as Array<{ agent_type: string }> | null);
  }

  downloadConsentTemplate(): void {
    this.http.get<{ name: string; cnpj?: string | null }>(`${environment.apiUrl}/clinic/profile`).subscribe({
      next: p => generateConsentTemplatePdf({ name: p.name, cnpj: p.cnpj ?? null }),
      error: () => generateConsentTemplatePdf()
    });
  }

  downloadPrescriptionPdf(p: Prescription): void {
    if (p.pdf_url) window.open(p.pdf_url, '_blank');
  }

  editPrescription(p: Prescription): void {
    const exam = this.exams().find(e => e.id === p.exam_id);
    if (!exam) {
      this.snack.open('Exame de origem não encontrado.', '', { duration: 3000 });
      return;
    }
    const result = (exam.results ?? []).find(r => r.agent_type === p.agent_type);
    if (!result) {
      this.snack.open('Análise de origem não encontrada.', '', { duration: 3000 });
      return;
    }
    this.openPrescriptionFromDetail(exam, result, p);
  }

  deletePrescription(p: Prescription): void {
    if (!confirm('Excluir esta prescrição? Esta ação não pode ser desfeita.')) return;
    this.http.delete(`${environment.apiUrl}/prescriptions/${p.id}`).subscribe({
      next: () => {
        this.loadPrescriptions(this.subject()!.id);
        this.loadPrescriptionsForExam(p.exam_id);
        this.snack.open('Prescrição excluída.', '', { duration: 2500 });
      },
      error: () => this.snack.open('Erro ao excluir prescrição.', '', { duration: 3000 })
    });
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
    critical: '#ffb4ab', high: '#ffcb6b', medium: '#c0c1ff', low: '#4ad6a0', none: '#6e6d80'
  };

  topSeverity(alerts: Alert[]): string {
    if (!alerts?.length) return 'none';
    for (const s of ['critical', 'high', 'medium', 'low']) {
      if (alerts.some(a => a.severity?.toLowerCase() === s)) return s;
    }
    return 'none';
  }

  severityColor(sev: string): string {
    return this.SEV_COLORS[sev?.toLowerCase()] ?? '#6e6d80';
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

  // ── Evolução por marcador ──────────────────────────────────────────────

  private readonly MARKER_COLORS = ['#c0c1ff', '#4ad6a0', '#ffcb6b'];
  private markerChart: Chart | null = null;

  private parseNumeric(value: string | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const s = String(value).replace(',', '.').replace(/[^\d.\-]/g, '');
    if (!s) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  availableMarkers = computed<string[]>(() => {
    const exams = this.doneExams();
    const markerSet = new Set<string>();
    for (const e of exams) {
      for (const r of (e.results ?? [])) {
        for (const [k, v] of Object.entries(r.risk_scores ?? {})) {
          if (this.parseNumeric(v) !== null) markerSet.add(k);
        }
      }
    }
    return [...markerSet].sort((a, b) => a.localeCompare(b));
  });

  toggleMarker(marker: string): void {
    const s = new Set(this.selectedMarkers());
    if (s.has(marker)) s.delete(marker);
    else if (s.size < 3) s.add(marker);
    this.selectedMarkers.set(s);
    setTimeout(() => this.renderMarkerChart(), 0);
  }

  markerSeriesPreview = computed(() => {
    const selected = [...this.selectedMarkers()];
    const exams = [...this.doneExams()].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    return selected.map((marker, i) => {
      const values: number[] = [];
      for (const e of exams) {
        for (const r of (e.results ?? [])) {
          const raw = r.risk_scores?.[marker];
          const n = this.parseNumeric(raw);
          if (n !== null) { values.push(n); break; }
        }
      }
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 0;
      const last = values.length ? values[values.length - 1] : 0;
      const first = values.length ? values[0] : 0;

      let trend: 'up' | 'down' | 'flat' | null = null;
      let trendIcon = 'remove';
      let trendColor = '#7c7b8f';
      if (values.length >= 2) {
        const delta = last - first;
        const threshold = Math.max(Math.abs(first) * 0.05, 0.01);
        if (delta > threshold) { trend = 'up'; trendIcon = 'trending_up'; trendColor = '#ffcb6b'; }
        else if (delta < -threshold) { trend = 'down'; trendIcon = 'trending_down'; trendColor = '#4ad6a0'; }
        else { trend = 'flat'; trendIcon = 'trending_flat'; trendColor = '#7c7b8f'; }
      }

      return {
        marker,
        color: this.MARKER_COLORS[i % this.MARKER_COLORS.length],
        min: min.toFixed(2).replace(/\.?0+$/, ''),
        max: max.toFixed(2).replace(/\.?0+$/, ''),
        last: last.toFixed(2).replace(/\.?0+$/, ''),
        trend,
        trendIcon,
        trendColor,
      };
    });
  });

  private renderMarkerChart(): void {
    if (this.markerChart) { this.markerChart.destroy(); this.markerChart = null; }
    const canvas = document.getElementById('marker-evolution-chart') as HTMLCanvasElement | null;
    if (!canvas) return;
    const selected = [...this.selectedMarkers()];
    if (selected.length === 0) return;

    const exams = [...this.doneExams()].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const labels = exams.map(e => new Date(e.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }));

    const datasets = selected.map((marker, i) => {
      const color = this.MARKER_COLORS[i % this.MARKER_COLORS.length];
      const data = exams.map(e => {
        for (const r of (e.results ?? [])) {
          const raw = r.risk_scores?.[marker];
          const n = this.parseNumeric(raw);
          if (n !== null) return n;
        }
        return null as unknown as number;
      });
      return {
        label: marker,
        data,
        borderColor: color,
        backgroundColor: color + '22',
        pointBackgroundColor: color,
        pointRadius: 4, pointHoverRadius: 6,
        tension: 0.3, spanGaps: true, fill: false,
      };
    });

    this.markerChart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: '#c8c7d9',
              font: { family: "'JetBrains Mono', monospace", size: 10 },
              boxWidth: 8, padding: 10,
            }
          },
          tooltip: {
            backgroundColor: '#1a2440',
            borderColor: 'rgba(70,69,84,0.4)', borderWidth: 1,
            titleColor: '#dae2fd', bodyColor: '#a09fb2',
            titleFont: { family: "'Space Grotesk'" },
            bodyFont: { family: "'JetBrains Mono'", size: 11 },
          }
        },
        scales: {
          x: {
            ticks: { color: '#7c7b8f', font: { family: "'JetBrains Mono'", size: 10 } },
            grid: { color: 'rgba(70,69,84,0.18)' },
            border: { color: 'rgba(70,69,84,0.18)' },
          },
          y: {
            ticks: { color: '#7c7b8f', font: { family: "'JetBrains Mono'", size: 10 } },
            grid: { color: 'rgba(70,69,84,0.18)' },
            border: { color: 'rgba(70,69,84,0.18)' },
          }
        }
      }
    });
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
    setTimeout(() => this.renderEvolutionCharts(), 0);
  }

  private readonly AGENT_LABELS: Record<string, string> = {
    metabolic: 'Metabólico', cardiovascular: 'Cardiovascular',
    hematology: 'Hematologia', therapeutic: 'Terapêutico',
    nutrition: 'Nutrição', clinical_correlation: 'Correlação Clínica',
    small_animals: 'Pequenos Animais', equine: 'Equino', bovine: 'Bovino'
  };
  agentLabel(type: string): string { return this.AGENT_LABELS[type] ?? type; }

  private readonly KIND_ICONS: Record<string, string> = {
    new: 'fiber_new', worsened: 'trending_up', improved: 'trending_down', resolved: 'check_circle'
  };
  kindIcon(kind: string): string { return this.KIND_ICONS[kind] ?? 'circle'; }

  private readonly KIND_COLORS: Record<string, string> = {
    new: '#ffb4ab', worsened: '#ffcb6b', improved: '#4ad6a0', resolved: '#7c7b8f'
  };
  kindColor(kind: string): string { return this.KIND_COLORS[kind] ?? '#7c7b8f'; }

  private readonly KIND_LABELS: Record<string, string> = {
    new: 'NOVO', worsened: 'PIOROU', improved: 'MELHOROU', resolved: 'RESOLVIDO'
  };
  kindLabel(kind: string): string { return this.KIND_LABELS[kind] ?? kind; }

  getStandardRecs(recs: any[]): any[] {
    return (recs || []).filter(r => r.type !== 'suggested_exam' && r.type !== 'contextual_factor');
  }

  getSuggestedExams(recs: any[]): any[] {
    return (recs || []).filter(r => r.type === 'suggested_exam');
  }

  getContextualFactors(recs: any[]): any[] {
    return (recs || []).filter(r => r.type === 'contextual_factor');
  }

  onExamFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    (event.target as HTMLInputElement).value = '';

    if (!this.isAllowedFile(file)) {
      this.snack.open('Formato não suportado. Use PDF, DICOM (.dcm), JPG ou PNG.', '', { duration: 4000 });
      return;
    }

    const isImage = this.isImageFile(file);

    // Painel com seleção de agentes + queixa/sintomas só para PDF laboratorial (human).
    // Imagens usam Vision classifier e agentes de imagem automaticamente.
    if (this.subject()?.subject_type === 'human' && !isImage) {
      const specialty = this.doctorSpecialty();
      const preSelected = specialty && SPECIALTY_AGENTS[specialty]?.length
        ? SPECIALTY_AGENTS[specialty]
        : ['metabolic', 'cardiovascular', 'hematology'];
      this.uploadAgents.set([...preSelected]);
      this.chiefComplaintValue = '';
      this.currentSymptomsValue = '';
      this.uploadError.set('');
      this.pendingFile.set(file);
    } else {
      this.doUpload(file);
    }
  }

  private isImageFile(file: File): boolean {
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    return ['dcm', 'dicom', 'jpg', 'jpeg', 'png', 'tiff', 'tif'].includes(ext);
  }

  private isAllowedFile(file: File): boolean {
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    return ['pdf', 'dcm', 'dicom', 'jpg', 'jpeg', 'png', 'tiff', 'tif'].includes(ext);
  }

  toggleUploadAgent(type: string): void {
    const agents = this.uploadAgents();
    if (agents.includes(type)) {
      this.uploadAgents.set(agents.filter(a => a !== type));
    } else {
      this.uploadAgents.set([...agents, type]);
    }
  }

  cancelUpload(): void {
    this.pendingFile.set(null);
    this.uploadError.set('');
    this.chiefComplaintValue = '';
    this.currentSymptomsValue = '';
  }

  submitUpload(): void {
    const file = this.pendingFile();
    if (!file) return;
    const extraFields = this.subject()?.subject_type === 'human' ? {
      selected_agents: JSON.stringify(this.uploadAgents()),
      chief_complaint: this.chiefComplaintValue,
      current_symptoms: this.currentSymptomsValue
    } : undefined;
    this.doUpload(file, extraFields, () => this.pendingFile.set(null));
  }

  private doUpload(file: File, extra?: Record<string, string>, onSuccess?: () => void): void {
    const id = this.subject()!.id;
    this.uploading.set(true);
    this.uploadError.set('');
    const form = new FormData();
    form.append('patient_id', id);
    form.append('file', file);
    if (extra) {
      Object.entries(extra).forEach(([k, v]) => form.append(k, v));
    }
    this.http.post<{ exam_id: string; status: string }>(`${environment.apiUrl}/exams`, form)
      .subscribe({
        next: ({ exam_id, status }) => {
          this.uploading.set(false);
          onSuccess?.();
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
        },
        error: (err: any) => {
          this.uploading.set(false);
          this.uploadError.set(err.error?.error ?? 'Erro ao enviar exame');
        }
      });
  }

  ngOnDestroy(): void {
    this.evoCharts.forEach(c => c.destroy());
    if (this.markerChart) { this.markerChart.destroy(); this.markerChart = null; }
    this.wsSub?.unsubscribe();
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  private renderEvolutionCharts(): void {
    this.evoCharts.forEach(c => c.destroy());
    this.evoCharts = [];

    const blocks = this.comparison() ?? [];
    const exams = this.selectedSortedExams();
    if (exams.length < 2 || !blocks.length) return;

    const labels = exams.map(e =>
      new Date(e.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    );

    const COLORS = ['#c0c1ff', '#10b981', '#ffb783', '#f5c14a', '#60a5fa', '#f472b6', '#a78bfa'];
    const GRID   = 'rgba(70,69,84,0.18)';
    const TICK   = '#7c7b8f';
    const LEGEND = '#c8c7d9';

    for (const block of blocks) {
      const canvas = document.getElementById(`evo-chart-${block.agent_type}`) as HTMLCanvasElement | null;
      if (!canvas) continue;

      // Collect numeric metric keys for this agent
      const metricKeys = new Set<string>();
      for (const exam of exams) {
        const result = (exam.results ?? []).find(r => r.agent_type === block.agent_type);
        for (const [k, v] of Object.entries(result?.risk_scores ?? {})) {
          if (!isNaN(parseFloat(v as string))) metricKeys.add(k);
        }
      }

      const datasets = [...metricKeys].map((key, i) => ({
        label: key,
        data: exams.map(exam => {
          const result = (exam.results ?? []).find(r => r.agent_type === block.agent_type);
          const v = result?.risk_scores?.[key];
          return v !== undefined ? parseFloat(v as string) : null;
        }),
        borderColor: COLORS[i % COLORS.length],
        backgroundColor: COLORS[i % COLORS.length] + '18',
        pointBackgroundColor: COLORS[i % COLORS.length],
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.35,
        spanGaps: true,
        fill: false,
      }));

      if (!datasets.length) continue;

      const chart = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              labels: {
                color: LEGEND,
                font: { family: "'JetBrains Mono', monospace", size: 10 },
                boxWidth: 8, padding: 10,
              }
            },
            tooltip: {
              backgroundColor: '#1a2440',
              borderColor: 'rgba(70,69,84,0.4)',
              borderWidth: 1,
              titleColor: '#dae2fd',
              bodyColor: '#a09fb2',
              titleFont: { family: "'Space Grotesk'" },
              bodyFont: { family: "'JetBrains Mono'", size: 11 },
            }
          },
          scales: {
            x: {
              ticks: { color: TICK, font: { family: "'JetBrains Mono'", size: 10 } },
              grid: { color: GRID },
              border: { color: GRID },
            },
            y: {
              ticks: { color: TICK, font: { family: "'JetBrains Mono'", size: 10 } },
              grid: { color: GRID },
              border: { color: GRID },
            }
          }
        }
      });

      this.evoCharts.push(chart);
    }
  }
}
