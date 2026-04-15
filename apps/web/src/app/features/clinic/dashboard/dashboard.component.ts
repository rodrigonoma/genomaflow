import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe, KeyValuePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AlertBadgeComponent } from '../../../shared/components/alert-badge/alert-badge.component';
import { environment } from '../../../../environments/environment';
import { Exam } from '../../../shared/models/api.models';

interface AlertItem { marker: string; value: string; severity: any; exam_id: string; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DatePipe, KeyValuePipe, RouterModule, MatCardModule, MatListModule, MatProgressBarModule, AlertBadgeComponent],
  template: `
    <div class="page-container">
      <h1 class="text-2xl font-semibold mb-6">Dashboard</h1>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <mat-card class="p-4 text-center">
          <div class="text-3xl font-bold text-blue-600">{{ counts.total }}</div>
          <div class="text-sm text-gray-600">Total de exames</div>
        </mat-card>
        <mat-card class="p-4 text-center">
          <div class="text-3xl font-bold text-green-600">{{ counts.done }}</div>
          <div class="text-sm text-gray-600">Concluídos</div>
        </mat-card>
        <mat-card class="p-4 text-center">
          <div class="text-3xl font-bold text-yellow-600">{{ counts.processing }}</div>
          <div class="text-sm text-gray-600">Processando</div>
        </mat-card>
        <mat-card class="p-4 text-center">
          <div class="text-3xl font-bold text-red-600">{{ counts.error }}</div>
          <div class="text-sm text-gray-600">Com erro</div>
        </mat-card>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <mat-card class="p-4">
          <h2 class="font-medium mb-3">Alertas críticos recentes</h2>
          @for (a of criticalAlerts; track a.marker) {
            <div class="flex items-center gap-2 mb-2">
              <app-alert-badge [severity]="a.severity" />
              <span class="text-sm">{{ a.marker }}: {{ a.value }}</span>
            </div>
          }
          @if (!criticalAlerts.length) {
            <p class="text-gray-500 text-sm">Nenhum alerta crítico.</p>
          }
        </mat-card>

        <mat-card class="p-4">
          <h2 class="font-medium mb-3">Agentes mais utilizados</h2>
          @for (entry of agentCounts | keyvalue; track entry.key) {
            <div class="mb-2">
              <div class="flex justify-between text-sm mb-1">
                <span class="capitalize">{{ entry.key }}</span>
                <span>{{ entry.value }}</span>
              </div>
              <mat-progress-bar [value]="counts.done > 0 ? (entry.value / counts.done) * 100 : 0" />
            </div>
          }
        </mat-card>
      </div>
    </div>
  `
})
export class DashboardComponent implements OnInit {
  private http = inject(HttpClient);

  counts = { total: 0, done: 0, processing: 0, error: 0, pending: 0 };
  criticalAlerts: AlertItem[] = [];
  agentCounts: Record<string, number> = {};

  ngOnInit(): void {
    this.http.get<any[]>(`${environment.apiUrl}/alerts?severity=critical`)
      .subscribe(alerts => {
        this.criticalAlerts = alerts.slice(0, 10).map(a => ({
          marker: a.marker, value: a.value, severity: a.severity, exam_id: a.exam_id
        }));
      });

    this.http.get<Exam[]>(`${environment.apiUrl}/exams`)
      .subscribe(exams => {
        this.counts.total = exams.length;
        this.counts.done = exams.filter(e => e.status === 'done').length;
        this.counts.processing = exams.filter(e => e.status === 'processing').length;
        this.counts.error = exams.filter(e => e.status === 'error').length;
        this.counts.pending = exams.filter(e => e.status === 'pending').length;

        const counts: Record<string, number> = {};
        for (const exam of exams) {
          for (const r of exam.results ?? []) {
            counts[r.agent_type] = (counts[r.agent_type] ?? 0) + 1;
          }
        }
        this.agentCounts = counts;
      });
  }
}
