import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe, UpperCasePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ReviewQueueService } from './review-queue.service';
import { ReviewQueueItem } from '../../../shared/models/api.models';

@Component({
  selector: 'app-review-queue',
  standalone: true,
  imports: [DatePipe, UpperCasePipe, MatIconModule, MatButtonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Fila de Revisão</h1>
          <p class="page-subtitle">Laudos com análise de IA aguardando revisão médica</p>
        </div>
        <div class="header-meta">
          @if (!loading) {
            <span class="count-badge">{{ queue.length }} pendente{{ queue.length !== 1 ? 's' : '' }}</span>
          }
        </div>
      </div>

      @if (loading) {
        <div class="loading-state">
          <span class="loading-text">Carregando...</span>
        </div>
      }

      @if (!loading && queue.length === 0) {
        <div class="empty-state">
          <mat-icon class="empty-icon">check_circle</mat-icon>
          <p class="empty-text">Nenhum laudo pendente de revisão</p>
          <p class="empty-sub">Todos os laudos foram revisados.</p>
        </div>
      }

      @if (!loading && queue.length > 0) {
        <div class="queue-list">
          @for (exam of queue; track exam.id) {
            <div class="queue-row" [class]="'severity-' + getSeverityLabel(exam.max_severity_score)">
              <div class="row-severity">
                <span class="severity-badge" [class]="'sev-' + getSeverityLabel(exam.max_severity_score)">
                  {{ getSeverityLabel(exam.max_severity_score) | uppercase }}
                </span>
              </div>

              <div class="row-info">
                <div class="row-meta">
                  <span class="meta-item">
                    <mat-icon class="meta-icon">schedule</mat-icon>
                    {{ exam.created_at | date:'dd/MM/yyyy HH:mm' }}
                  </span>
                  <span class="source-badge" [class]="'source-' + exam.source">
                    {{ exam.source | uppercase }}
                  </span>
                </div>
                @if (exam.results && exam.results.length > 0) {
                  <div class="agent-chips">
                    @for (result of exam.results; track result.agent_type) {
                      <span class="agent-chip">{{ result.agent_type }}</span>
                    }
                  </div>
                }
              </div>

              <div class="row-actions">
                <button mat-flat-button class="open-btn" (click)="open(exam)">
                  <mat-icon>open_in_new</mat-icon>
                  Abrir
                </button>
              </div>
            </div>
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

    .page {
      max-width: 900px;
      margin: 0 auto;
    }

    .page-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 2rem;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .page-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 1.5rem;
      color: #dae2fd;
      margin: 0 0 0.25rem 0;
    }

    .page-subtitle {
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      color: #a09fb2;
      margin: 0;
    }

    .header-meta {
      display: flex;
      align-items: center;
    }

    .count-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      background: rgba(73, 75, 214, 0.15);
      color: #c0c1ff;
      border: 1px solid rgba(73, 75, 214, 0.3);
      padding: 4px 10px;
      border-radius: 20px;
    }

    .loading-state {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 200px;
    }

    .loading-text {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: #6e6d80;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 300px;
      gap: 0.5rem;
    }

    .empty-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #10b981;
      opacity: 0.6;
    }

    .empty-text {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 1rem;
      font-weight: 600;
      color: #c7c4d7;
      margin: 0.5rem 0 0 0;
    }

    .empty-sub {
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      color: #6e6d80;
      margin: 0;
    }

    .queue-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .queue-row {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      background: #111929;
      border: 1px solid rgba(70, 69, 84, 0.15);
      border-left: 4px solid rgba(70, 69, 84, 0.3);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      transition: border-color 150ms ease, background 150ms ease;
    }

    .queue-row:hover {
      background: #162035;
    }

    .queue-row.severity-critical { border-left-color: #ffb4ab; }
    .queue-row.severity-high     { border-left-color: #ffb783; }
    .queue-row.severity-medium   { border-left-color: #c0c1ff; }
    .queue-row.severity-low      { border-left-color: #10b981; }
    .queue-row.severity-none     { border-left-color: rgba(70,69,84,0.3); }

    .row-severity {
      flex-shrink: 0;
      width: 80px;
    }

    .severity-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      padding: 3px 7px;
      border-radius: 4px;
    }

    .sev-critical { background: rgba(255,180,171,0.12); color: #ffb4ab; }
    .sev-high     { background: rgba(255,183,131,0.12); color: #ffb783; }
    .sev-medium   { background: rgba(192,193,255,0.12); color: #c0c1ff; }
    .sev-low      { background: rgba(16,185,129,0.12);  color: #10b981; }
    .sev-none     { background: rgba(70,69,84,0.12);    color: #6e6d80; }

    .row-info {
      flex: 1;
      min-width: 0;
    }

    .row-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
      flex-wrap: wrap;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #a09fb2;
    }

    .meta-icon {
      font-size: 13px;
      width: 13px;
      height: 13px;
    }

    .source-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      padding: 2px 6px;
      border-radius: 3px;
    }

    .source-integration { background: rgba(73,75,214,0.15); color: #c0c1ff; }
    .source-upload      { background: rgba(70,69,84,0.2);   color: #a09fb2; }

    .agent-chips {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .agent-chip {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: #c7c4d7;
      border: 1px solid rgba(70, 69, 84, 0.25);
      padding: 2px 7px;
      border-radius: 3px;
      text-transform: uppercase;
    }

    .row-actions {
      flex-shrink: 0;
    }

    .open-btn {
      background: #494bd6 !important;
      color: #fff !important;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 600;
      font-size: 13px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .open-btn mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
  `]
})
export class ReviewQueueComponent implements OnInit {
  private service = inject(ReviewQueueService);
  private router = inject(Router);

  queue: ReviewQueueItem[] = [];
  loading = true;

  ngOnInit(): void {
    this.service.getQueue().subscribe({
      next: items => { this.queue = items; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  open(exam: ReviewQueueItem): void {
    this.queue = this.queue.filter(e => e.id !== exam.id);
    if (exam.review_status === 'pending') {
      this.service.markViewed(exam.id).subscribe({
        next: () => this.service.refreshCount(),
        error: () => {}
      });
    }
    this.router.navigate(['/doctor/results', exam.id]);
  }

  getSeverityLabel(score: number): string {
    if (score >= 4) return 'critical';
    if (score >= 3) return 'high';
    if (score >= 2) return 'medium';
    if (score >= 1) return 'low';
    return 'none';
  }
}
