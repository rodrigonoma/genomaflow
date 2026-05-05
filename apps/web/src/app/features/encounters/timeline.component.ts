import { Component, Input, OnInit, OnChanges, signal, computed, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { EncountersService, TimelineEvent } from './encounters.service';

/**
 * Timeline unificada: encontros + exames + prescrições + análises IA, ordem cronológica desc.
 * Cada item renderiza com badge de tipo + payload simplificado.
 */
@Component({
  selector: 'app-timeline',
  standalone: true,
  imports: [CommonModule, DatePipe],
  template: `
    @if (loading()) {
      <p class="muted">Carregando timeline…</p>
    } @else if (items().length === 0) {
      <p class="muted">Sem eventos registrados ainda.</p>
    } @else {
      <ul class="timeline">
        @for (item of items(); track item.event_id) {
          <li [class]="'event event-' + item.event_type">
            <span class="badge">{{ labelFor(item.event_type) }}</span>
            <span class="date">{{ item.event_at | date:'dd/MM/yyyy HH:mm' }}</span>
            <p class="summary">{{ summaryFor(item) }}</p>
          </li>
        }
      </ul>
      @if (hasMore()) {
        <button class="more" (click)="loadMore()" [disabled]="loadingMore()">
          {{ loadingMore() ? 'Carregando…' : 'Carregar mais' }}
        </button>
      }
    }
  `,
  styles: [`
    .muted { color: #c7c5d0; font-size: 0.875rem; padding: 16px 0; }
    .timeline { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .event { display: grid; grid-template-columns: 110px 140px 1fr; gap: 12px; align-items: start;
             padding: 8px 12px; border-radius: 4px; background: #171f33; border-left: 2px solid #2a3148; }
    .event-encounter { border-left-color: #c0c1ff; }
    .event-exam { border-left-color: #88d8b0; }
    .event-prescription { border-left-color: #ffd166; }
    .event-ai_analysis { border-left-color: #ff6b6b; }
    .badge { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.1em;
             font-family: 'JetBrains Mono', monospace; color: #c0c1ff; padding-top: 2px; }
    .date { color: #c7c5d0; font-size: 0.75rem; font-family: 'JetBrains Mono', monospace; padding-top: 2px; }
    .summary { color: #dbe2fd; font-size: 0.875rem; margin: 0; }
    .more { margin-top: 12px; padding: 8px 16px; background: #2a3148; color: #c0c1ff; border: none;
            border-radius: 4px; cursor: pointer; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; }
    .more[disabled] { opacity: 0.5; cursor: not-allowed; }
  `]
})
export class TimelineComponent implements OnInit, OnChanges {
  @Input({ required: true }) subjectId!: string;
  @Input() refreshTick = 0;

  private encountersService = inject(EncountersService);

  items = signal<TimelineEvent[]>([]);
  loading = signal(false);
  loadingMore = signal(false);
  hasMore = signal(false);
  cursor: string | null = null;

  ngOnInit() { this.refresh(); }
  ngOnChanges() { this.refresh(); }

  refresh() {
    if (!this.subjectId) return;
    this.loading.set(true);
    this.cursor = null;
    this.encountersService.timeline(this.subjectId).subscribe({
      next: (res) => {
        this.items.set(res.items);
        this.hasMore.set(res.has_more);
        this.cursor = res.next_cursor;
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadMore() {
    if (!this.cursor) return;
    this.loadingMore.set(true);
    this.encountersService.timeline(this.subjectId, this.cursor).subscribe({
      next: (res) => {
        this.items.update(curr => [...curr, ...res.items]);
        this.hasMore.set(res.has_more);
        this.cursor = res.next_cursor;
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  labelFor(type: TimelineEvent['event_type']): string {
    return {
      encounter: 'Evolução',
      exam: 'Exame',
      prescription: 'Prescrição',
      ai_analysis: 'IA',
    }[type] || type;
  }

  summaryFor(item: TimelineEvent): string {
    const p = item.payload || {};
    switch (item.event_type) {
      case 'encounter':
        return p.chief_complaint || `Encontro: ${p.encounter_type ?? 'consulta'}`;
      case 'exam':
        return `Exame ${p.file_type ?? ''} — status ${p.status}`;
      case 'prescription':
        return `Prescrição ${p.agent_type ?? ''} (${p.item_count ?? 0} itens)`;
      case 'ai_analysis':
        return `Análise ${p.agent_type ?? ''}`;
      default:
        return '';
    }
  }
}
