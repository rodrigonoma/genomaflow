import { Component, OnInit, computed, inject, signal, input } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AiSuggestionsService, AiSuggestion, AiSuggestionsCache } from './ai-suggestions.service';

/**
 * Card de sugestões pró-ativas da IA pra o paciente.
 *
 * UX:
 * - Empty state com CTA "Gerar sugestões"
 * - Sugestões ordenadas por prioridade (high → medium → low)
 * - Badge de prioridade colorido + chip da diretriz fonte
 * - Botão "X" pra dismissar individual (não some, fica em dismissed_ids)
 * - Botão "Atualizar" pro profissional regerar (gasta tokens — confirma)
 * - Disclaimer obrigatório no footer
 */
@Component({
  selector: 'app-ai-suggestions-card',
  standalone: true,
  imports: [CommonModule, DatePipe, MatButtonModule, MatIconModule, MatTooltipModule, MatSnackBarModule],
  template: `
    <div class="ai-card">
      <div class="ai-header">
        <div class="ai-title">
          <mat-icon class="ai-icon">auto_awesome</mat-icon>
          <span>Sugestões da IA</span>
          @if (cache(); as c) {
            <span class="ai-meta">· {{ c.generated_at | date:'dd/MM HH:mm' }}</span>
          }
        </div>
        <div class="ai-actions">
          @if (cache()) {
            <button mat-stroked-button (click)="onRefresh()" [disabled]="loading()" matTooltip="Regenerar com base no histórico atualizado">
              <mat-icon>refresh</mat-icon>
              {{ loading() ? 'Gerando...' : 'Atualizar' }}
            </button>
          }
        </div>
      </div>

      @if (loading() && !cache()) {
        <p class="ai-status">A IA está analisando o histórico do paciente…</p>
      } @else if (!cache()) {
        <div class="ai-empty">
          <mat-icon class="ai-empty-icon">tips_and_updates</mat-icon>
          <p>A IA pode revisar o histórico clínico e sugerir ações pró-ativas baseadas em diretrizes.</p>
          <button mat-flat-button color="primary" (click)="onRefresh()" [disabled]="loading()">
            <mat-icon>auto_awesome</mat-icon>
            {{ loading() ? 'Analisando...' : 'Gerar sugestões' }}
          </button>
        </div>
      } @else if (visibleSuggestions().length === 0) {
        <p class="ai-status muted">Nenhuma sugestão pendente para este paciente.</p>
      } @else {
        <ul class="ai-list">
          @for (s of visibleSuggestions(); track s.id) {
            <li class="ai-item" [class]="'priority-' + s.priority">
              <div class="ai-item-head">
                <span class="ai-priority">{{ priorityLabel(s.priority) }}</span>
                <button class="ai-dismiss" (click)="onDismiss(s.id)" matTooltip="Descartar">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
              <div class="ai-item-title">{{ s.title }}</div>
              <div class="ai-item-rationale">{{ s.rationale }}</div>
              @if (s.suggested_action) {
                <div class="ai-item-action">
                  <mat-icon>chevron_right</mat-icon>
                  {{ s.suggested_action }}
                </div>
              }
              @if (s.source_guideline) {
                <div class="ai-item-source">📖 {{ s.source_guideline }}</div>
              }
            </li>
          }
        </ul>
      }

      @if (cache()) {
        <p class="ai-disclaimer">
          ⚕ Sugestões geradas por IA não substituem julgamento clínico. O médico decide.
        </p>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ai-card {
      background: linear-gradient(135deg, rgba(192,193,255,0.08), rgba(74,214,160,0.04));
      border: 1px solid rgba(192,193,255,0.18);
      border-radius: 10px; padding: 16px 18px;
      margin-bottom: 16px;
    }
    .ai-header {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; flex-wrap: wrap; margin-bottom: 12px;
    }
    .ai-title { display: flex; align-items: center; gap: 8px; color: #dae2fd;
                font-weight: 600; font-size: 0.9375rem; }
    .ai-icon { color: #c0c1ff; }
    .ai-meta { font-size: 0.75rem; color: #a09fb2; font-weight: 400; }
    .ai-actions button { color: #c0c1ff; }

    .ai-status { color: #c7c5d0; font-size: 0.875rem; padding: 8px 0; margin: 0; }
    .ai-status.muted { color: #7c7b8f; }

    .ai-empty {
      text-align: center; padding: 24px 12px;
      display: flex; flex-direction: column; align-items: center; gap: 12px;
    }
    .ai-empty-icon { font-size: 40px; width: 40px; height: 40px; color: #c0c1ff; opacity: 0.6; }
    .ai-empty p { color: #c7c5d0; font-size: 0.875rem; max-width: 380px; margin: 0; }

    .ai-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .ai-item {
      background: rgba(11,19,38,0.5);
      border: 1px solid rgba(192,193,255,0.1);
      border-left: 3px solid #c0c1ff;
      border-radius: 6px; padding: 10px 14px;
      transition: border-color 0.15s;
    }
    .ai-item:hover { border-left-color: #fff; }
    .ai-item.priority-high { border-left-color: #ff6b6b; }
    .ai-item.priority-medium { border-left-color: #f7c873; }
    .ai-item.priority-low { border-left-color: #4ad6a0; }

    .ai-item-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; margin-bottom: 4px;
    }
    .ai-priority {
      font-size: 0.625rem; padding: 1px 8px; border-radius: 100px;
      text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;
      background: rgba(255,255,255,0.05); color: #c7c5d0;
      font-family: 'JetBrains Mono', monospace;
    }
    .priority-high .ai-priority { background: rgba(255,107,107,0.15); color: #ff8b8b; }
    .priority-medium .ai-priority { background: rgba(247,200,115,0.15); color: #f7c873; }
    .priority-low .ai-priority { background: rgba(74,214,160,0.15); color: #4ad6a0; }

    .ai-dismiss {
      background: transparent; border: none; cursor: pointer;
      color: #7c7b8f; padding: 0; display: flex; align-items: center;
      transition: color 0.15s;
    }
    .ai-dismiss:hover { color: #ff8b8b; }
    .ai-dismiss mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .ai-item-title { color: #fff; font-weight: 500; font-size: 0.9375rem; margin-bottom: 4px; }
    .ai-item-rationale { color: #c7c5d0; font-size: 0.8125rem; line-height: 1.45; margin-bottom: 6px; }
    .ai-item-action {
      display: flex; align-items: center; gap: 4px;
      color: #4ad6a0; font-size: 0.8125rem; font-weight: 500;
      margin-top: 4px;
    }
    .ai-item-action mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ai-item-source { color: #a09fb2; font-size: 0.75rem; margin-top: 4px; }

    .ai-disclaimer {
      color: #7c7b8f; font-size: 0.6875rem; margin: 12px 0 0;
      padding-top: 10px; border-top: 1px solid rgba(192,193,255,0.08);
      text-align: center;
    }
  `],
})
export class AiSuggestionsCardComponent implements OnInit {
  private service = inject(AiSuggestionsService);
  private snack = inject(MatSnackBar);

  /** ID do subject (paciente humano OU animal). */
  subjectId = input.required<string>();

  cache = signal<AiSuggestionsCache | null>(null);
  loading = signal(false);

  visibleSuggestions = computed<AiSuggestion[]>(() => {
    const c = this.cache();
    if (!c) return [];
    const dismissed = new Set(c.dismissed_ids || []);
    const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return [...c.suggestions]
      .filter(s => !dismissed.has(s.id))
      .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
  });

  ngOnInit() {
    this.load();
  }

  load() {
    this.service.get(this.subjectId()).subscribe({
      next: r => this.cache.set(r.cached),
      error: () => this.cache.set(null),
    });
  }

  onRefresh() {
    if (this.cache() && !confirm('Regerar sugestões? Vai consumir tokens da IA.')) return;
    this.loading.set(true);
    this.service.refresh(this.subjectId()).subscribe({
      next: c => {
        this.cache.set(c);
        this.loading.set(false);
        this.snack.open(`${c.suggestions.length} sugestão(ões) gerada(s).`, 'OK', { duration: 3000 });
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err?.error?.error || 'Erro ao gerar sugestões. Tente novamente.';
        this.snack.open(msg, 'Fechar', { duration: 5000 });
      },
    });
  }

  onDismiss(suggestionId: string) {
    this.service.dismiss(this.subjectId(), suggestionId).subscribe({
      next: c => this.cache.set(c),
      error: () => this.snack.open('Erro ao descartar sugestão', 'Fechar', { duration: 3000 }),
    });
  }

  priorityLabel(p: string): string {
    return ({ high: 'Alta', medium: 'Média', low: 'Baixa' } as any)[p] || p;
  }
}
