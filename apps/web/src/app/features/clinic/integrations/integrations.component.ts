import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { environment } from '../../../../environments/environment';
import { Connector } from '../../../shared/models/api.models';

@Component({
  selector: 'app-integrations',
  standalone: true,
  imports: [DatePipe, RouterModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="integrations-page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Integrações</h1>
          <span class="page-subtitle">INTEGRATION STUDIO &middot; CONECTORES ATIVOS</span>
        </div>
        <button class="new-btn" (click)="goToWizard()">
          <mat-icon>add</mat-icon>
          Nova Integração
        </button>
      </div>

      <div class="status-bar">
        <span class="status-stat">
          <span class="stat-num stat-active">{{ activeCount }}</span>
          <span class="stat-label">ATIVO</span>
        </span>
        <span class="status-sep">&middot;</span>
        <span class="status-stat">
          <span class="stat-num stat-error">{{ errorCount }}</span>
          <span class="stat-label">COM ERRO</span>
        </span>
        <span class="status-sep">&middot;</span>
        <span class="status-stat">
          <span class="stat-num">{{ totalIngested }}</span>
          <span class="stat-label">REGISTROS IMPORTADOS</span>
        </span>
      </div>

      @if (!connectors.length) {
        <div class="empty-state">
          <mat-icon class="empty-icon">cable</mat-icon>
          <p class="empty-title">Nenhuma integração configurada</p>
          <p class="empty-sub">Conecte seu sistema legado em menos de 15 minutos</p>
          <button class="new-btn" (click)="goToWizard()">
            <mat-icon>add</mat-icon> Criar primeira integração
          </button>
        </div>
      }

      @for (c of connectors; track c.id) {
        <div class="connector-card">
          <div class="connector-header">
            <div class="connector-info">
              <div class="connector-dot"
                [class.dot-active]="c.status === 'active'"
                [class.dot-error]="c.status === 'error'"
                [class.dot-inactive]="c.status === 'inactive'">
              </div>
              <div>
                <span class="connector-name">{{ c.name }}</span>
                <span class="connector-mode">{{ modeLabel(c.mode) }}</span>
              </div>
            </div>
            <div class="connector-status-badge" [class]="'badge-' + c.status">
              {{ c.status.toUpperCase() }}
            </div>
          </div>

          <div class="connector-meta">
            @if (c.last_sync_at) {
              <span class="meta-item">
                <mat-icon class="meta-icon">sync</mat-icon>
                Último sync: {{ c.last_sync_at | date:'dd/MM HH:mm' }}
              </span>
            }
            <span class="meta-item">
              <mat-icon class="meta-icon">download</mat-icon>
              {{ c.sync_count }} registros importados
            </span>
            <span class="meta-item">
              <mat-icon class="meta-icon">schedule</mat-icon>
              Criado em {{ c.created_at | date:'dd/MM/yyyy' }}
            </span>
          </div>

          @if (c.error_msg) {
            <div class="connector-error">{{ c.error_msg }}</div>
          }

          <div class="connector-actions">
            <button class="action-btn" (click)="testConnection(c)" [disabled]="testing === c.id"
              matTooltip="Testar conexão">
              <mat-icon>cable</mat-icon>
              {{ testing === c.id ? 'Testando...' : 'Testar' }}
            </button>
            <button class="action-btn action-btn-ghost" (click)="toggleStatus(c)"
              [matTooltip]="c.status === 'active' ? 'Desativar' : 'Ativar'">
              <mat-icon>{{ c.status === 'active' ? 'pause' : 'play_arrow' }}</mat-icon>
              {{ c.status === 'active' ? 'Desativar' : 'Ativar' }}
            </button>
            <button class="action-btn action-btn-danger" (click)="deleteConnector(c)"
              matTooltip="Excluir conector">
              <mat-icon>delete</mat-icon>
            </button>
          </div>

          @if (testResult[c.id]) {
            <div class="test-result" [class.test-ok]="testResult[c.id].ok" [class.test-fail]="!testResult[c.id].ok">
              {{ testResult[c.id].message }}
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; background: #0b1326; min-height: 100vh; padding: 2rem; }

    .page-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;
    }

    .page-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.5rem; color: #dae2fd; margin: 0 0 0.25rem 0;
    }

    .page-subtitle {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; color: #464554; letter-spacing: 0.08em;
    }

    .new-btn {
      display: flex; align-items: center; gap: 0.5rem;
      background: #c0c1ff; color: #1000a9; border: none; border-radius: 4px;
      padding: 0.625rem 1.25rem; font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 0.8125rem; text-transform: uppercase;
      letter-spacing: 0.06em; cursor: pointer;
      transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .new-btn:hover { opacity: 0.88; }

    .status-bar {
      display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem;
      background: #131b2e; border: 1px solid rgba(70,69,84,0.15);
      border-radius: 4px; padding: 0.875rem 1.25rem;
    }
    .status-stat { display: flex; align-items: center; gap: 0.5rem; }
    .status-sep { color: #464554; }
    .stat-num {
      font-family: 'JetBrains Mono', monospace; font-weight: 700;
      font-size: 1.125rem; color: #c0c1ff;
    }
    .stat-num.stat-active { color: #10b981; }
    .stat-num.stat-error { color: #ffb4ab; }
    .stat-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.1em; color: #464554;
    }

    .empty-state {
      display: flex; flex-direction: column; align-items: center;
      gap: 0.75rem; padding: 4rem 2rem; text-align: center;
      border: 1px dashed rgba(70,69,84,0.3); border-radius: 8px;
    }
    .empty-icon { font-size: 3rem; width: 3rem; height: 3rem; color: #464554; }
    .empty-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1rem; color: #dae2fd; margin: 0;
    }
    .empty-sub { font-family: 'Inter', sans-serif; font-size: 13px; color: #908fa0; margin: 0; }

    .connector-card {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.15);
      border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;
      transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .connector-card:hover { border-color: rgba(70,69,84,0.35); }

    .connector-header {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;
    }
    .connector-info { display: flex; align-items: center; gap: 0.75rem; }
    .connector-dot { width: 8px; height: 8px; border-radius: 50%; background: #464554; flex-shrink: 0; }
    .dot-active { background: #10b981; box-shadow: 0 0 6px #10b98166; }
    .dot-error { background: #ffb4ab; }
    .dot-inactive { background: #464554; }

    .connector-name {
      display: block; font-family: 'Space Grotesk', sans-serif;
      font-weight: 600; font-size: 1rem; color: #dae2fd;
    }
    .connector-mode {
      display: block; font-family: 'JetBrains Mono', monospace;
      font-size: 10px; text-transform: uppercase; color: #464554; letter-spacing: 0.08em; margin-top: 2px;
    }

    .connector-status-badge {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; padding: 3px 10px; border-radius: 4px; letter-spacing: 0.08em;
    }
    .badge-active { background: rgba(16,185,129,0.1); color: #10b981; }
    .badge-inactive { background: #1e2740; color: #908fa0; }
    .badge-error { background: rgba(255,180,171,0.1); color: #ffb4ab; }

    .connector-meta { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem; }
    .meta-item {
      display: flex; align-items: center; gap: 0.25rem;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #908fa0;
    }
    .meta-icon { font-size: 14px !important; width: 14px !important; height: 14px !important; }

    .connector-error {
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #ffb4ab;
      background: rgba(147,0,10,0.1); border: 1px solid rgba(255,180,171,0.15);
      border-radius: 4px; padding: 0.5rem 0.75rem; margin-bottom: 1rem;
    }

    .connector-actions { display: flex; align-items: center; gap: 0.5rem; }

    .action-btn {
      display: flex; align-items: center; gap: 0.375rem;
      background: rgba(192,193,255,0.08); color: #c0c1ff;
      border: 1px solid rgba(70,69,84,0.25); border-radius: 4px;
      padding: 0.375rem 0.75rem; font-family: 'JetBrains Mono', monospace;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
      cursor: pointer; transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .action-btn:hover:not(:disabled) { background: rgba(192,193,255,0.15); }
    .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .action-btn-ghost { background: transparent; color: #908fa0; }
    .action-btn-ghost:hover:not(:disabled) { background: #1e2740; color: #dae2fd; }
    .action-btn-danger { background: transparent; color: #ffb4ab; border-color: rgba(255,180,171,0.2); }
    .action-btn-danger:hover:not(:disabled) { background: rgba(147,0,10,0.1); }

    .test-result {
      margin-top: 0.75rem; padding: 0.5rem 0.75rem; border-radius: 4px;
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
    }
    .test-ok { background: rgba(16,185,129,0.08); color: #10b981; border: 1px solid rgba(16,185,129,0.2); }
    .test-fail { background: rgba(147,0,10,0.1); color: #ffb4ab; border: 1px solid rgba(255,180,171,0.15); }
  `]
})
export class IntegrationsComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);

  connectors: Connector[] = [];
  testing = '';
  testResult: Record<string, { ok: boolean; message: string }> = {};

  get activeCount() { return this.connectors.filter(c => c.status === 'active').length; }
  get errorCount() { return this.connectors.filter(c => c.status === 'error').length; }
  get totalIngested() { return this.connectors.reduce((s, c) => s + c.sync_count, 0); }

  ngOnInit(): void { this.loadConnectors(); }

  loadConnectors(): void {
    this.http.get<Connector[]>(`${environment.apiUrl}/integrations`)
      .subscribe(c => this.connectors = c);
  }

  goToWizard(): void { this.router.navigate(['/clinic/integrations/new']); }

  modeLabel(mode: string): string {
    return ({ swagger: 'REST / Swagger', hl7: 'HL7 v2.x', file_drop: 'File Drop' } as Record<string, string>)[mode] ?? mode;
  }

  testConnection(c: Connector): void {
    this.testing = c.id;
    this.http.post<{ ok: boolean; fields_discovered?: number; error?: string }>(
      `${environment.apiUrl}/integrations/${c.id}/test`, {}
    ).subscribe({
      next: r => {
        this.testing = '';
        this.testResult[c.id] = { ok: true, message: `Conexão OK — ${r.fields_discovered} campos descobertos` };
      },
      error: err => {
        this.testing = '';
        this.testResult[c.id] = { ok: false, message: err.error?.error ?? 'Falha na conexão' };
      }
    });
  }

  toggleStatus(c: Connector): void {
    const newStatus = c.status === 'active' ? 'inactive' : 'active';
    this.http.put<Connector>(`${environment.apiUrl}/integrations/${c.id}`, { status: newStatus })
      .subscribe(updated => {
        const idx = this.connectors.findIndex(x => x.id === c.id);
        if (idx !== -1) this.connectors[idx] = { ...this.connectors[idx], status: updated.status };
      });
  }

  deleteConnector(c: Connector): void {
    if (!confirm(`Excluir integração "${c.name}"?`)) return;
    this.http.delete(`${environment.apiUrl}/integrations/${c.id}`)
      .subscribe(() => this.connectors = this.connectors.filter(x => x.id !== c.id));
  }
}
