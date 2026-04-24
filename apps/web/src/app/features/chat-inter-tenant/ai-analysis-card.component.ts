import { Component, Input, signal } from '@angular/core';
import { CommonModule, KeyValuePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { AiAnalysisCardPayload } from '../../shared/models/chat.models';

const AGENT_LABELS: Record<string, string> = {
  cardiovascular: 'Cardiovascular',
  hematology: 'Hematologia',
  metabolic: 'Metabólico',
  therapeutic: 'Terapêutico',
  nutrition: 'Nutrição',
  clinical_correlation: 'Correlação Clínica',
  small_animals: 'Pequenos Animais',
  equine: 'Equino',
  bovine: 'Bovino',
};

const SEV_COLORS: Record<string, string> = {
  critical: '#ffb4ab',
  high: '#ffcb6b',
  medium: '#c0c1ff',
  low: '#4ad6a0',
};

@Component({
  selector: 'app-ai-analysis-card',
  standalone: true,
  imports: [CommonModule, KeyValuePipe, MatIconModule],
  styles: [`
    :host { display: block; margin-top: 0.5rem; }
    .card {
      background: #111929; border: 1px solid rgba(192,193,255,0.25);
      border-radius: 8px; overflow: hidden; max-width: 440px;
    }
    .card-header {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.625rem 0.875rem; cursor: pointer;
      background: rgba(192,193,255,0.06);
      border-bottom: 1px solid rgba(192,193,255,0.15);
      transition: background 150ms;
    }
    .card-header:hover { background: rgba(192,193,255,0.12); }
    .card-header mat-icon { font-size: 18px; width: 18px; height: 18px; color: #c0c1ff; }
    .card-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 0.8125rem; color: #c0c1ff;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .card-subtitle {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #908fa0; flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .chevron { color: #7c7b8f !important; }
    .card-body { padding: 0.75rem 0.875rem; display: flex; flex-direction: column; gap: 0.875rem; }
    .agent-block { padding-bottom: 0.625rem; border-bottom: 1px solid rgba(70,69,84,0.15); }
    .agent-block:last-child { border-bottom: none; padding-bottom: 0; }
    .agent-name {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
      color: #c0c1ff; margin-bottom: 0.375rem;
    }
    .risk-scores { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.375rem; }
    .risk-chip {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      padding: 2px 6px; border-radius: 3px;
      background: rgba(192,193,255,0.08); color: #c0c1ff;
    }
    .alerts { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.375rem; }
    .alert {
      font-size: 12px; padding: 0.25rem 0.5rem; border-radius: 3px;
      border-left: 2px solid; background: rgba(70,69,84,0.2);
    }
    .alert strong { font-family: 'Space Grotesk', sans-serif; }
    .interpretation {
      font-size: 12px; color: #dae2fd; line-height: 1.5;
      padding-top: 0.25rem;
    }
    .disclaimer {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #4ad6a0; padding-top: 0.5rem;
      border-top: 1px solid rgba(74,214,160,0.2);
      display: flex; align-items: center; gap: 0.25rem;
    }
    .recommendations { display: flex; flex-direction: column; gap: 0.25rem; }
    .recommendation {
      font-size: 12px; color: #dae2fd;
      padding-left: 0.75rem; border-left: 2px solid rgba(192,193,255,0.3);
    }
  `],
  template: `
    <div class="card">
      <div class="card-header" (click)="toggle()">
        <mat-icon>insights</mat-icon>
        <span class="card-title">Análise IA</span>
        <span class="card-subtitle">
          {{ payload.subject.subject_type === 'animal' ? 'Animal' : 'Paciente' }}
          @if (payload.subject.age_range) { · {{ payload.subject.age_range }} anos }
          · {{ payload.subject.sex }}
          @if (payload.subject.species) { · {{ payload.subject.species }} }
          @if (payload.subject.breed) { · {{ payload.subject.breed }} }
          @if (payload.subject.weight_kg) { · {{ payload.subject.weight_kg }}kg }
        </span>
        <mat-icon class="chevron">{{ expanded() ? 'expand_less' : 'expand_more' }}</mat-icon>
      </div>
      @if (expanded()) {
        <div class="card-body">
          @for (r of payload.results; track r.agent_type) {
            <div class="agent-block">
              <div class="agent-name">{{ agentLabel(r.agent_type) }}</div>
              @if (hasRiskScores(r.risk_scores)) {
                <div class="risk-scores">
                  @for (rs of r.risk_scores | keyvalue; track rs.key) {
                    <span class="risk-chip">{{ rs.key }}: {{ rs.value }}</span>
                  }
                </div>
              }
              @if (r.alerts?.length) {
                <div class="alerts">
                  @for (a of r.alerts; track a.marker + a.value) {
                    <div class="alert" [style.borderColor]="sevColor(a.severity)" [style.color]="sevColor(a.severity)">
                      <strong>{{ a.marker }}</strong>: {{ a.value }}
                    </div>
                  }
                </div>
              }
              @if (r.recommendations?.length) {
                <div class="recommendations">
                  @for (rec of r.recommendations; track rec.description) {
                    <span class="recommendation">• {{ rec.description }}</span>
                  }
                </div>
              }
              @if (r.interpretation) {
                <div class="interpretation">{{ r.interpretation }}</div>
              }
            </div>
          }
          <div class="disclaimer">
            <mat-icon style="font-size:12px;width:12px;height:12px">shield</mat-icon>
            Dados anonimizados — sem identificação do paciente.
          </div>
        </div>
      }
    </div>
  `
})
export class AiAnalysisCardComponent {
  @Input() payload!: AiAnalysisCardPayload;
  expanded = signal(false);

  toggle() { this.expanded.set(!this.expanded()); }

  agentLabel(k: string): string {
    return AGENT_LABELS[k] || k;
  }

  sevColor(sev: string): string {
    return SEV_COLORS[sev?.toLowerCase()] || '#7c7b8f';
  }

  hasRiskScores(rs: Record<string, string> | null | undefined): boolean {
    return !!rs && Object.keys(rs).length > 0;
  }
}
