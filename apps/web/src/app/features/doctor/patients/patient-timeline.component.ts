import { Component, Input, OnInit, signal, computed, inject, output } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { environment } from '../../../../environments/environment';

export interface TimelineEvent {
  event_type: string;
  event_id: string;
  event_at: string;
  payload: Record<string, any>;
}

interface EventGroup {
  label: string;
  events: TimelineEvent[];
}

const EVENT_META: Record<string, { icon: string; color: string; label: string }> = {
  registered:                    { icon: 'person_add',              color: '#22c55e', label: 'Cadastro' },
  exam:                          { icon: 'biotech',                 color: '#3b82f6', label: 'Exame' },
  ai_analysis:                   { icon: 'psychology',              color: '#8b5cf6', label: 'Análise IA' },
  appointment:                   { icon: 'calendar_today',          color: '#f59e0b', label: 'Agendamento' },
  video_consultation:            { icon: 'videocam',                color: '#06b6d4', label: 'Teleconsulta' },
  encounter:                     { icon: 'description',             color: '#94a3b8', label: 'Prontuário' },
  prescription:                  { icon: 'medication',              color: '#f97316', label: 'Prescrição' },
  followup:                      { icon: 'notifications',           color: '#64748b', label: 'Follow-up' },
  aesthetic_analysis_completed:  { icon: 'face_retouching_natural', color: '#ec4899', label: 'Análise estética' },
};

const ALL_FILTERS = Object.keys(EVENT_META);

@Component({
  selector: 'app-patient-timeline',
  standalone: true,
  imports: [CommonModule, DatePipe, MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatChipsModule],
  styles: [`
    :host { display:block; padding:1rem; }

    .filter-bar {
      display:flex; gap:.5rem; flex-wrap:wrap; margin-bottom:1.25rem; align-items:center;
    }
    .filter-label { font-size:.75rem; color:#6e6d80; margin-right:.25rem; }
    .filter-chip {
      padding:4px 12px; border-radius:20px; border:1px solid rgba(70,69,84,.4);
      background:transparent; color:#a09fb2; font-size:.75rem; cursor:pointer;
      transition:background 120ms, color 120ms;
    }
    .filter-chip.active { background:#1a2440; color:#c0c1ff; border-color:#c0c1ff; }

    .month-group { margin-bottom:1.5rem; }
    .month-label {
      font-family:'JetBrains Mono',monospace; font-size:.65rem; color:#6e6d80;
      text-transform:uppercase; letter-spacing:.1em;
      display:flex; align-items:center; gap:.5rem; margin-bottom:.75rem;
    }
    .month-label::after { content:''; flex:1; height:1px; background:rgba(70,69,84,.25); }

    .timeline-list { position:relative; padding-left:28px; }
    .timeline-list::before {
      content:''; position:absolute; left:10px; top:0; bottom:0;
      width:2px; background:rgba(70,69,84,.25);
    }

    .event-card {
      position:relative; margin-bottom:.75rem; cursor:pointer;
      background:#111929; border:1px solid rgba(70,69,84,.2);
      border-radius:8px; padding:.625rem .875rem;
      transition:border-color 150ms, background 150ms;
    }
    .event-card:hover { border-color:rgba(192,193,255,.35); background:#151e2f; }

    .event-dot {
      position:absolute; left:-22px; top:12px;
      width:12px; height:12px; border-radius:50%;
      border:2px solid #0b1326;
    }
    .event-header { display:flex; align-items:center; gap:.5rem; }
    .event-icon { font-size:16px !important; width:16px; height:16px; }
    .event-title { font-size:.8rem; color:#dae2fd; flex:1; font-weight:500; }
    .event-date { font-size:.65rem; color:#6e6d80; font-family:'JetBrains Mono',monospace; white-space:nowrap; }
    .event-sub { font-size:.7rem; color:#a09fb2; margin-top:.25rem; }

    .status-badge {
      display:inline-block; font-size:.6rem; padding:1px 6px; border-radius:3px;
      font-family:'JetBrains Mono',monospace; margin-left:.5rem;
    }
    .badge-critical { background:#7f1d1d; color:#fca5a5; }
    .badge-high     { background:#78350f; color:#fde68a; }
    .badge-done     { background:#14532d; color:#86efac; }
    .badge-video    { background:#164e63; color:#67e8f9; }

    .load-more {
      width:100%; margin-top:.5rem; padding:.625rem;
      background:#111929; border:1px dashed rgba(70,69,84,.3);
      border-radius:6px; color:#6e6d80; font-size:.75rem; cursor:pointer;
    }
    .load-more:hover { border-color:rgba(192,193,255,.3); color:#c0c1ff; }
    .load-more:disabled { opacity:.5; cursor:default; }

    .empty { text-align:center; color:#6e6d80; font-size:.8rem; padding:2rem 0; }
    .spinner-wrap { display:flex; justify-content:center; padding:2rem 0; }

    @media (max-width:768px) {
      :host { padding:.75rem; }
      .timeline-list::before { display:none; }
      .event-dot { display:none; }
      .timeline-list { padding-left:0; }
    }
  `],
  template: `
    <div class="filter-bar">
      <span class="filter-label">Filtrar:</span>
      @for (type of allFilters; track type) {
        <button class="filter-chip" [class.active]="activeFilters().has(type)"
                (click)="toggleFilter(type)">
          {{ meta(type).label }}
        </button>
      }
    </div>

    @if (loading() && groups().length === 0) {
      <div class="spinner-wrap"><mat-spinner diameter="32"></mat-spinner></div>
    } @else if (groups().length === 0) {
      <div class="empty">Nenhum evento encontrado.</div>
    } @else {
      @for (group of groups(); track group.label) {
        <div class="month-group">
          <div class="month-label">{{ group.label }}</div>
          <div class="timeline-list">
            @for (ev of group.events; track ev.event_id) {
              <div class="event-card" (click)="select.emit(ev)">
                <div class="event-dot" [style.background]="meta(ev.event_type).color"></div>
                <div class="event-header">
                  <mat-icon class="event-icon" [style.color]="meta(ev.event_type).color">
                    {{ meta(ev.event_type).icon }}
                  </mat-icon>
                  <span class="event-title">{{ cardTitle(ev) }}</span>
                  <span class="event-date">{{ ev.event_at | date:'dd/MM HH:mm' }}</span>
                </div>
                <div class="event-sub">
                  {{ cardSub(ev) }}
                  @if (cardBadge(ev); as b) {
                    <span class="status-badge" [class]="b.cls">{{ b.text }}</span>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      }

      @if (hasMore()) {
        <button class="load-more" [disabled]="loading()" (click)="loadMore()">
          {{ loading() ? 'Carregando...' : 'Carregar mais' }}
        </button>
      }
    }
  `
})
export class PatientTimelineComponent implements OnInit {
  @Input({ required: true }) subjectId!: string;
  select = output<TimelineEvent>();

  private http = inject(HttpClient);

  loading = signal(false);
  private allEvents = signal<TimelineEvent[]>([]);
  private cursor = signal<string | null>(null);
  hasMore = signal(false);
  activeFilters = signal<Set<string>>(new Set(ALL_FILTERS));
  allFilters = ALL_FILTERS;

  groups = computed<EventGroup[]>(() => {
    const active = this.activeFilters();
    const filtered = this.allEvents().filter(e => active.has(e.event_type));
    const map = new Map<string, TimelineEvent[]>();
    for (const ev of filtered) {
      const d = new Date(ev.event_at);
      const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const cap = label.charAt(0).toUpperCase() + label.slice(1);
      if (!map.has(cap)) map.set(cap, []);
      map.get(cap)!.push(ev);
    }
    return Array.from(map.entries()).map(([label, events]) => ({ label, events }));
  });

  ngOnInit() { this.load(); }

  meta(type: string) {
    return EVENT_META[type] ?? { icon: 'circle', color: '#6e6d80', label: type };
  }

  toggleFilter(type: string) {
    const s = new Set(this.activeFilters());
    s.has(type) ? s.delete(type) : s.add(type);
    this.activeFilters.set(s);
  }

  loadMore() { this.load(this.cursor()); }

  private load(cursor?: string | null) {
    this.loading.set(true);
    const params = cursor ? `?cursor=${cursor}&limit=50` : '?limit=50';
    this.http.get<any>(`${environment.apiUrl}/patients/${this.subjectId}/timeline${params}`).subscribe({
      next: (res) => {
        this.allEvents.update(prev => [...prev, ...(res.items ?? [])]);
        this.cursor.set(res.next_cursor ?? null);
        this.hasMore.set(res.has_more ?? false);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  cardTitle(ev: TimelineEvent): string {
    const p = ev.payload;
    switch (ev.event_type) {
      case 'registered':         return `Cadastro: ${p['name'] ?? 'Paciente'}`;
      case 'exam':               return p['file_type'] ? `Exame — ${p['file_type']}` : 'Exame enviado';
      case 'ai_analysis':        return `Análise IA — ${p['agent_type'] ?? ''}`;
      case 'appointment':        return p['appointment_type'] ?? 'Agendamento';
      case 'video_consultation': return `Teleconsulta ${p['modality'] === 'complete' ? 'completa' : 'simples'}`;
      case 'encounter':          return p['chief_complaint']
        ? `Prontuário: ${(p['chief_complaint'] as string).slice(0, 60)}` : 'Prontuário';
      case 'prescription':       return `Prescrição (${p['item_count'] ?? 0} item${(p['item_count'] ?? 0) !== 1 ? 's' : ''})`;
      case 'followup':                      return 'Follow-up enviado';
      case 'aesthetic_analysis_completed': {
        const analysisType = p['analysis_type'] ?? 'estética';
        return `Análise ${analysisType} concluída`;
      }
      default:                   return ev.event_type;
    }
  }

  cardSub(ev: TimelineEvent): string {
    const p = ev.payload;
    switch (ev.event_type) {
      case 'video_consultation': {
        const mins = p['duration_seconds'] ? Math.ceil(p['duration_seconds'] / 60) : null;
        const cred = p['credits_debited'];
        return [mins ? `${mins} min` : null, cred ? `${cred} crédito${cred !== 1 ? 's' : ''}` : null]
          .filter(Boolean).join(' · ');
      }
      case 'appointment':  return p['status'] ?? '';
      case 'encounter':    return p['source'] === 'video_ai' ? 'Gerado por IA' : 'Manual';
      case 'followup':     return `${p['notification_type'] ?? ''} · ${p['channel'] ?? ''}`;
      case 'aesthetic_analysis_completed': {
        const type = p['analysis_type'] || 'estética';
        const photoCount = p['photo_count'] || 0;
        return `Análise ${type} concluída · ${photoCount} foto${photoCount === 1 ? '' : 's'}`;
      }
      default:             return '';
    }
  }

  cardBadge(ev: TimelineEvent): { text: string; cls: string } | null {
    if (ev.event_type === 'exam') {
      const al = ev.payload['alert_level'];
      if (al === 'critical') return { text: 'crítico', cls: 'status-badge badge-critical' };
      if (al === 'high')     return { text: 'alto',    cls: 'status-badge badge-high' };
    }
    if (ev.event_type === 'video_consultation' && ev.payload['status'] === 'done') {
      return { text: 'concluída', cls: 'status-badge badge-video' };
    }
    if (ev.event_type === 'encounter' && ev.payload['signed_at']) {
      return { text: 'assinado', cls: 'status-badge badge-done' };
    }
    return null;
  }
}
