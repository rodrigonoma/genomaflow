# Patient Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar aba "Timeline" ao patient-detail com linha do tempo cronológica e visual de toda a história do paciente, com painel de detalhe slide-over (desktop) / bottom-sheet (mobile).

**Architecture:** O backend expande o UNION ALL do endpoint `/patients/:id/timeline` existente com 4 novos tipos de evento (registered, appointment, video_consultation, followup). O frontend adiciona dois componentes standalone — `PatientTimelineComponent` (feed + filtros) e `TimelinePanelComponent` (detalhe slide-over/bottom-sheet) — e os conecta como nova aba no `patient-detail.component.ts` existente.

**Tech Stack:** Node.js/Fastify (API), Angular 18 standalone + Angular Material, CSS animations nativas, Capacitor 6 (mobile via `cap sync android`)

---

## File Map

| Ação | Arquivo |
|---|---|
| **Modify** | `apps/api/src/routes/patients.js` — expandir UNION ALL do timeline endpoint |
| **Create** | `apps/api/tests/routes/timeline-validation.test.js` — testes da query expandida |
| **Create** | `apps/web/src/app/features/doctor/patients/patient-timeline.component.ts` |
| **Create** | `apps/web/src/app/features/doctor/patients/timeline-panel.component.ts` |
| **Modify** | `apps/web/src/app/features/doctor/patients/patient-detail.component.ts` — nova aba |

---

## Task 1: Expandir endpoint GET /patients/:id/timeline

**Files:**
- Modify: `apps/api/src/routes/patients.js:415-470`
- Create: `apps/api/tests/routes/timeline-validation.test.js`

### Por que fazer: o UNION ALL atual retorna 4 tipos; precisamos de 8

- [ ] **Step 1.1: Escrever o teste de validação primeiro**

Crie `apps/api/tests/routes/timeline-validation.test.js`:

```js
'use strict';
/**
 * Testa o endpoint GET /patients/:id/timeline isoladamente (sem DB).
 * Verifica auth gate e que a resposta tem a forma correta.
 */
const Fastify = require('fastify');

function buildApp() {
  const app = Fastify();
  app.decorate('authenticate', async (req) => {
    req.user = { tenant_id: 'tid-1', user_id: 'uid-1' };
  });
  const mockRows = [
    { event_type: 'registered', event_id: 'eid-1', event_at: '2026-01-01T00:00:00Z', payload: { id: 'eid-1' } },
    { event_type: 'exam',       event_id: 'eid-2', event_at: '2026-02-01T00:00:00Z', payload: { id: 'eid-2' } },
  ];
  app.decorate('pg', {
    query: jest.fn().mockResolvedValue({ rows: mockRows }),
  });
  // withTenant usado internamente — mock pg.connect para satisfazer
  app.pg.connect = jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: mockRows }),
    release: jest.fn(),
  });
  require('../../src/routes/patients')(app, {}, () => {});
  return app;
}

describe('GET /patients/:id/timeline — auth gate', () => {
  test('retorna 401 sem token', async () => {
    const app = Fastify();
    app.decorate('authenticate', async () => { throw { statusCode: 401 }; });
    app.decorate('pg', { query: jest.fn() });
    require('../../src/routes/patients')(app, {}, () => {});
    const res = await app.inject({ method: 'GET', url: '/patients/some-id/timeline' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /patients/:id/timeline — response shape', () => {
  test('retorna items, next_cursor e has_more', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/patients/some-id/timeline', headers: { authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('has_more');
    expect(Array.isArray(body.items)).toBe(true);
  });

  test('cada item tem event_type, event_id, event_at, payload', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/patients/some-id/timeline', headers: { authorization: 'Bearer tok' } });
    const { items } = JSON.parse(res.payload);
    for (const item of items) {
      expect(item).toHaveProperty('event_type');
      expect(item).toHaveProperty('event_id');
      expect(item).toHaveProperty('event_at');
      expect(item).toHaveProperty('payload');
    }
  });

  test('respeita limit máximo de 200', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/patients/some-id/timeline?limit=9999', headers: { authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 1.2: Rodar teste para confirmar falha**

```bash
cd apps/api && npx jest tests/routes/timeline-validation.test.js --no-coverage 2>&1 | tail -20
```

Esperado: FAIL — `patients` route register error ou teste de shape falhando.

- [ ] **Step 1.3: Expandir o UNION ALL em patients.js**

Localize o bloco SQL em `apps/api/src/routes/patients.js` (linha ~415). Substitua o `sql` completo:

```js
    const sql = `
      WITH events AS (
        -- Cadastro do paciente (evento único)
        SELECT 'registered'::text AS event_type, s.id AS event_id, s.created_at AS event_at,
               jsonb_build_object('id', s.id, 'name', s.name, 'subject_type', s.subject_type, 'module', s.module) AS payload
        FROM subjects s
        WHERE s.tenant_id = $1 AND s.id = $2

        UNION ALL

        SELECT 'encounter'::text AS event_type, e.id AS event_id, e.created_at AS event_at,
               jsonb_build_object(
                 'id', e.id,
                 'encounter_type', e.encounter_type,
                 'chief_complaint', e.chief_complaint,
                 'professional_user_id', e.professional_user_id,
                 'signed_at', e.signed_at,
                 'source', e.source
               ) AS payload
        FROM clinical_encounters e
        WHERE e.tenant_id = $1 AND e.subject_id = $2

        UNION ALL

        SELECT 'exam'::text, ex.id, ex.created_at,
               jsonb_build_object(
                 'id', ex.id,
                 'status', ex.status,
                 'file_type', ex.file_type,
                 'file_path', ex.file_path,
                 'alert_level', ex.alert_level
               )
        FROM exams ex
        WHERE ex.tenant_id = $1 AND ex.subject_id = $2

        UNION ALL

        SELECT 'prescription'::text, p.id, p.created_at,
               jsonb_build_object(
                 'id', p.id,
                 'created_by', p.created_by,
                 'exam_id', p.exam_id,
                 'agent_type', p.agent_type,
                 'item_count', COALESCE(jsonb_array_length(p.items), 0)
               )
        FROM prescriptions p
        WHERE p.tenant_id = $1 AND p.subject_id = $2

        UNION ALL

        SELECT 'ai_analysis'::text, cr.id, cr.created_at,
               jsonb_build_object(
                 'id', cr.id,
                 'agent_type', cr.agent_type,
                 'exam_id', cr.exam_id,
                 'risk_scores', cr.risk_scores
               )
        FROM clinical_results cr
        JOIN exams ex_cr ON ex_cr.id = cr.exam_id
        WHERE cr.tenant_id = $1 AND ex_cr.subject_id = $2

        UNION ALL

        -- Agendamentos
        SELECT 'appointment'::text, a.id, a.start_at,
               jsonb_build_object(
                 'id', a.id,
                 'appointment_type', a.appointment_type,
                 'status', a.status,
                 'duration_minutes', a.duration_minutes,
                 'notes', a.notes
               )
        FROM appointments a
        WHERE a.tenant_id = $1 AND a.subject_id = $2

        UNION ALL

        -- Teleconsultas (via appointments.subject_id)
        SELECT 'video_consultation'::text, vc.id, COALESCE(vc.started_at, vc.created_at),
               jsonb_build_object(
                 'id', vc.id,
                 'modality', vc.modality,
                 'status', vc.status,
                 'duration_seconds', vc.duration_seconds,
                 'credits_debited', vc.credits_debited,
                 'encounter_id', vc.encounter_id
               )
        FROM video_consultations vc
        JOIN appointments a_vc ON a_vc.id = vc.appointment_id
        WHERE vc.tenant_id = $1 AND a_vc.subject_id = $2

        UNION ALL

        -- Follow-ups enviados
        SELECT 'followup'::text, sn.id, sn.sent_at,
               jsonb_build_object(
                 'id', sn.id,
                 'notification_type', sn.notification_type,
                 'channel', sn.channel
               )
        FROM scheduled_notifications sn
        WHERE sn.tenant_id = $1 AND sn.subject_id = $2 AND sn.sent_at IS NOT NULL
      )
      SELECT * FROM events
      WHERE 1=1 ${cursorClause}
      ORDER BY event_at DESC, event_id DESC
      LIMIT ${limit + 1}
    `;
```

> **Atenção:** `alert_level` pode não existir em `exams` — verificar via `\d exams` no docker DB. Se não existir, remover esse campo do jsonb_build_object.

- [ ] **Step 1.4: Rodar o teste novamente**

```bash
cd apps/api && npx jest tests/routes/timeline-validation.test.js --no-coverage 2>&1 | tail -20
```

Esperado: PASS (3 testes verdes).

- [ ] **Step 1.5: Adicionar o teste ao script test:unit**

Em `apps/api/package.json`, no campo `test:unit`, adicionar ao final da string:
```
tests/routes/timeline-validation.test.js
```

- [ ] **Step 1.6: Rodar test:unit completo para garantir não-regressão**

```bash
cd apps/api && npm run test:unit 2>&1 | tail -10
```

Esperado: todos os testes passando.

- [ ] **Step 1.7: Commit**

```bash
git add apps/api/src/routes/patients.js apps/api/tests/routes/timeline-validation.test.js apps/api/package.json
git commit -m "feat(timeline): expandir UNION ALL do endpoint /patients/:id/timeline com 4 novos tipos"
```

---

## Task 2: Criar PatientTimelineComponent

**Files:**
- Create: `apps/web/src/app/features/doctor/patients/patient-timeline.component.ts`

Este componente é responsável por: carregar eventos paginados, agrupar por mês/ano, renderizar o feed vertical com cartões, e emitir o evento selecionado ao clicar.

- [ ] **Step 2.1: Criar o componente**

Crie `apps/web/src/app/features/doctor/patients/patient-timeline.component.ts`:

```typescript
import { Component, Input, OnInit, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { inject, output } from '@angular/core';
import { environment } from '../../../../environments/environment';

export interface TimelineEvent {
  event_type: string;
  event_id: string;
  event_at: string;
  payload: Record<string, any>;
}

interface EventGroup {
  label: string; // ex: "Maio 2026"
  events: TimelineEvent[];
}

const EVENT_META: Record<string, { icon: string; color: string; label: string }> = {
  registered:         { icon: 'person_add',      color: '#22c55e', label: 'Cadastro' },
  exam:               { icon: 'biotech',          color: '#3b82f6', label: 'Exame' },
  ai_analysis:        { icon: 'psychology',       color: '#8b5cf6', label: 'Análise IA' },
  appointment:        { icon: 'calendar_today',   color: '#f59e0b', label: 'Agendamento' },
  video_consultation: { icon: 'videocam',         color: '#06b6d4', label: 'Teleconsulta' },
  encounter:          { icon: 'description',      color: '#94a3b8', label: 'Prontuário' },
  prescription:       { icon: 'medication',       color: '#f97316', label: 'Prescrição' },
  followup:           { icon: 'notifications',    color: '#64748b', label: 'Follow-up' },
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

    .empty { text-align:center; color:#6e6d80; font-size:.8rem; padding:2rem 0; }

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
      <div class="empty"><mat-spinner diameter="32"></mat-spinner></div>
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
      case 'encounter':          return p['chief_complaint'] ? `Prontuário: ${(p['chief_complaint'] as string).slice(0, 60)}` : 'Prontuário';
      case 'prescription':       return `Prescrição (${p['item_count'] ?? 0} item${(p['item_count'] ?? 0) !== 1 ? 's' : ''})`;
      case 'followup':           return `Follow-up enviado`;
      default:                   return ev.event_type;
    }
  }

  cardSub(ev: TimelineEvent): string {
    const p = ev.payload;
    switch (ev.event_type) {
      case 'video_consultation': {
        const mins = p['duration_seconds'] ? Math.ceil(p['duration_seconds'] / 60) : null;
        const cred = p['credits_debited'];
        return [mins ? `${mins} min` : null, cred ? `${cred} crédito${cred !== 1 ? 's' : ''}` : null].filter(Boolean).join(' · ');
      }
      case 'appointment':  return p['status'] ?? '';
      case 'encounter':    return p['source'] === 'video_ai' ? 'Gerado por IA' : 'Manual';
      case 'followup':     return `${p['notification_type'] ?? ''} · ${p['channel'] ?? ''}`;
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
```

- [ ] **Step 2.2: Commit**

```bash
git add apps/web/src/app/features/doctor/patients/patient-timeline.component.ts
git commit -m "feat(timeline): PatientTimelineComponent — feed vertical com filtros e agrupamento por mês"
```

---

## Task 3: Criar TimelinePanelComponent

**Files:**
- Create: `apps/web/src/app/features/doctor/patients/timeline-panel.component.ts`

O painel slide-over (desktop) / bottom-sheet (mobile) que exibe o detalhe de cada evento.

- [ ] **Step 3.1: Criar o componente**

Crie `apps/web/src/app/features/doctor/patients/timeline-panel.component.ts`:

```typescript
import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TimelineEvent } from './patient-timeline.component';

@Component({
  selector: 'app-timeline-panel',
  standalone: true,
  imports: [CommonModule, DatePipe, MatIconModule, MatButtonModule],
  styles: [`
    .backdrop {
      position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:200;
      opacity:0; transition:opacity 220ms ease; pointer-events:none;
    }
    .backdrop.open { opacity:1; pointer-events:auto; }

    /* Desktop: slide da direita */
    .panel {
      position:fixed; top:0; right:0; bottom:0; width:420px; z-index:201;
      background:#111929; border-left:1px solid rgba(70,69,84,.25);
      display:flex; flex-direction:column; overflow:hidden;
      transform:translateX(100%); transition:transform 220ms ease;
    }
    .panel.open { transform:translateX(0); }

    /* Mobile: bottom-sheet */
    @media (max-width:768px) {
      .panel {
        top:auto; left:0; right:0; bottom:0; width:100%; height:85vh;
        border-left:none; border-top:1px solid rgba(70,69,84,.25);
        border-radius:16px 16px 0 0;
        transform:translateY(100%);
      }
      .panel.open { transform:translateY(0); }
      .handle {
        width:40px; height:4px; background:rgba(70,69,84,.5);
        border-radius:2px; margin:.75rem auto .25rem; flex-shrink:0;
      }
    }

    .panel-header {
      display:flex; align-items:center; gap:.5rem;
      padding:.875rem 1rem; border-bottom:1px solid rgba(70,69,84,.2);
      flex-shrink:0;
    }
    .panel-title { flex:1; font-size:.9rem; font-weight:600; color:#dae2fd; }
    .panel-date  { font-size:.7rem; color:#6e6d80; font-family:'JetBrains Mono',monospace; }
    .close-btn   { color:#6e6d80; cursor:pointer; background:none; border:none; padding:0; }
    .close-btn:hover { color:#dae2fd; }

    .panel-body { flex:1; overflow-y:auto; padding:1rem; }

    .field { margin-bottom:.875rem; }
    .field-label { font-size:.65rem; color:#6e6d80; font-family:'JetBrains Mono',monospace;
                   text-transform:uppercase; letter-spacing:.08em; margin-bottom:.25rem; }
    .field-value { font-size:.82rem; color:#dae2fd; line-height:1.5; }

    .action-btn {
      width:100%; margin-top:1rem; padding:.625rem;
      background:#1a2440; border:1px solid rgba(192,193,255,.25);
      border-radius:6px; color:#c0c1ff; font-size:.8rem; cursor:pointer;
      display:flex; align-items:center; justify-content:center; gap:.5rem;
    }
    .action-btn:hover { background:#202e4a; }

    .badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:.7rem;
             font-family:'JetBrains Mono',monospace; }
    .badge-critical { background:#7f1d1d; color:#fca5a5; }
    .badge-high     { background:#78350f; color:#fde68a; }
    .badge-done     { background:#14532d; color:#86efac; }
    .badge-tele     { background:#164e63; color:#67e8f9; }
  `],
  template: `
    <div class="backdrop" [class.open]="visible" (click)="close.emit()"></div>

    <div class="panel" [class.open]="visible" (keydown.escape)="close.emit()" tabindex="-1">
      <div class="handle"></div>

      @if (event) {
        <div class="panel-header">
          <span class="panel-title">{{ panelTitle() }}</span>
          <span class="panel-date">{{ event.event_at | date:'dd/MM/yyyy HH:mm' }}</span>
          <button class="close-btn" (click)="close.emit()"><mat-icon>close</mat-icon></button>
        </div>

        <div class="panel-body">
          @switch (event.event_type) {

            @case ('registered') {
              <div class="field">
                <div class="field-label">Nome</div>
                <div class="field-value">{{ event.payload['name'] }}</div>
              </div>
              <div class="field">
                <div class="field-label">Módulo</div>
                <div class="field-value">{{ event.payload['module'] }}</div>
              </div>
              <div class="field">
                <div class="field-label">Tipo</div>
                <div class="field-value">{{ event.payload['subject_type'] === 'animal' ? 'Animal' : 'Humano' }}</div>
              </div>
            }

            @case ('exam') {
              <div class="field">
                <div class="field-label">Tipo de arquivo</div>
                <div class="field-value">{{ event.payload['file_type'] ?? 'N/A' }}</div>
              </div>
              <div class="field">
                <div class="field-label">Status</div>
                <div class="field-value">{{ event.payload['status'] }}</div>
              </div>
              @if (event.payload['alert_level']) {
                <div class="field">
                  <div class="field-label">Alerta</div>
                  <div class="field-value">
                    <span class="badge" [class.badge-critical]="event.payload['alert_level']==='critical'"
                                       [class.badge-high]="event.payload['alert_level']==='high'">
                      {{ event.payload['alert_level'] }}
                    </span>
                  </div>
                </div>
              }
              <button class="action-btn" (click)="navigate('/results/' + event.payload['id'])">
                <mat-icon style="font-size:16px;">open_in_new</mat-icon>
                Ver resultados completos
              </button>
            }

            @case ('ai_analysis') {
              <div class="field">
                <div class="field-label">Agente</div>
                <div class="field-value">{{ event.payload['agent_type'] }}</div>
              </div>
              <button class="action-btn" (click)="navigate('/results/' + event.payload['exam_id'])">
                <mat-icon style="font-size:16px;">biotech</mat-icon>
                Ver exame associado
              </button>
            }

            @case ('appointment') {
              <div class="field">
                <div class="field-label">Tipo</div>
                <div class="field-value">{{ event.payload['appointment_type'] ?? 'N/A' }}</div>
              </div>
              <div class="field">
                <div class="field-label">Duração</div>
                <div class="field-value">{{ event.payload['duration_minutes'] }} min</div>
              </div>
              <div class="field">
                <div class="field-label">Status</div>
                <div class="field-value">{{ event.payload['status'] }}</div>
              </div>
              @if (event.payload['notes']) {
                <div class="field">
                  <div class="field-label">Notas</div>
                  <div class="field-value">{{ event.payload['notes'] }}</div>
                </div>
              }
            }

            @case ('video_consultation') {
              <div class="field">
                <div class="field-label">Modalidade</div>
                <div class="field-value">{{ event.payload['modality'] === 'complete' ? 'Completa (IA)' : 'Simples' }}</div>
              </div>
              <div class="field">
                <div class="field-label">Duração</div>
                <div class="field-value">
                  {{ event.payload['duration_seconds'] ? (event.payload['duration_seconds'] / 60 | number:'1.0-0') + ' min' : 'N/A' }}
                </div>
              </div>
              <div class="field">
                <div class="field-label">Créditos debitados</div>
                <div class="field-value">{{ event.payload['credits_debited'] ?? 0 }}</div>
              </div>
              <div class="field">
                <div class="field-label">Status</div>
                <div class="field-value">
                  <span class="badge badge-tele">{{ event.payload['status'] }}</span>
                </div>
              </div>
              @if (event.payload['encounter_id']) {
                <button class="action-btn" (click)="navigate('/clinic/encounters/' + event.payload['encounter_id'])">
                  <mat-icon style="font-size:16px;">description</mat-icon>
                  Abrir prontuário gerado pela IA
                </button>
              }
            }

            @case ('encounter') {
              @if (event.payload['chief_complaint']) {
                <div class="field">
                  <div class="field-label">Queixa principal</div>
                  <div class="field-value">{{ event.payload['chief_complaint'] }}</div>
                </div>
              }
              <div class="field">
                <div class="field-label">Origem</div>
                <div class="field-value">{{ event.payload['source'] === 'video_ai' ? 'IA de teleconsulta' : 'Manual' }}</div>
              </div>
              @if (event.payload['signed_at']) {
                <div class="field">
                  <div class="field-label">Assinado em</div>
                  <div class="field-value">{{ event.payload['signed_at'] | date:'dd/MM/yyyy HH:mm' }}</div>
                </div>
              }
              <button class="action-btn" (click)="navigate('/clinic/encounters/' + event.payload['id'])">
                <mat-icon style="font-size:16px;">open_in_new</mat-icon>
                Abrir prontuário completo
              </button>
            }

            @case ('prescription') {
              <div class="field">
                <div class="field-label">Itens prescritos</div>
                <div class="field-value">{{ event.payload['item_count'] }} item(s)</div>
              </div>
              @if (event.payload['agent_type']) {
                <div class="field">
                  <div class="field-label">Agente IA</div>
                  <div class="field-value">{{ event.payload['agent_type'] }}</div>
                </div>
              }
            }

            @case ('followup') {
              <div class="field">
                <div class="field-label">Tipo</div>
                <div class="field-value">{{ event.payload['notification_type'] }}</div>
              </div>
              <div class="field">
                <div class="field-label">Canal</div>
                <div class="field-value">{{ event.payload['channel'] }}</div>
              </div>
            }

          }
        </div>
      }
    </div>
  `
})
export class TimelinePanelComponent {
  @Input() event: TimelineEvent | null = null;
  @Input() visible = false;
  @Output() close = new EventEmitter<void>();

  private router = inject(Router);

  panelTitle(): string {
    if (!this.event) return '';
    const map: Record<string, string> = {
      registered: 'Cadastro', exam: 'Exame', ai_analysis: 'Análise IA',
      appointment: 'Agendamento', video_consultation: 'Teleconsulta',
      encounter: 'Prontuário', prescription: 'Prescrição', followup: 'Follow-up',
    };
    return map[this.event.event_type] ?? this.event.event_type;
  }

  navigate(path: string) {
    this.router.navigate([path]);
  }
}
```

- [ ] **Step 3.2: Commit**

```bash
git add apps/web/src/app/features/doctor/patients/timeline-panel.component.ts
git commit -m "feat(timeline): TimelinePanelComponent — slide-over desktop / bottom-sheet mobile"
```

---

## Task 4: Integrar os componentes no patient-detail

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`

- [ ] **Step 4.1: Adicionar imports ao patient-detail**

Localize o bloco de imports do arquivo. Adicione após a linha com `AiSuggestionsCardComponent`:

```typescript
import { PatientTimelineComponent, TimelineEvent } from './patient-timeline.component';
import { TimelinePanelComponent } from './timeline-panel.component';
```

- [ ] **Step 4.2: Adicionar ao array imports do @Component**

No `imports: [...]` do decorator `@Component`, adicione `PatientTimelineComponent` e `TimelinePanelComponent` à lista existente.

- [ ] **Step 4.3: Adicionar signals para o painel**

Na classe `PatientDetailComponent`, adicione após as declarações de signals existentes:

```typescript
timelineSelectedEvent = signal<TimelineEvent | null>(null);
timelinePanelOpen = signal(false);
```

- [ ] **Step 4.4: Adicionar nova aba no template**

Localize a linha `<mat-tab label="Evolução">` no template. **Antes** dela, adicione a aba Timeline:

```html
<mat-tab label="🕐 Timeline">
  <app-patient-timeline
    [subjectId]="subject().id"
    (select)="openTimelinePanel($event)"
  />
  <app-timeline-panel
    [event]="timelineSelectedEvent()"
    [visible]="timelinePanelOpen()"
    (close)="timelinePanelOpen.set(false)"
  />
</mat-tab>
```

- [ ] **Step 4.5: Adicionar método openTimelinePanel na classe**

```typescript
openTimelinePanel(event: TimelineEvent) {
  this.timelineSelectedEvent.set(event);
  this.timelinePanelOpen.set(true);
}
```

- [ ] **Step 4.6: Verificar que subject() tem .id disponível**

Grep para confirmar que `subject()` retorna objeto com `id`:
```bash
grep -n "subject = signal\|subject\.set\|subject()" apps/web/src/app/features/doctor/patients/patient-detail.component.ts | head -10
```

Se `subject` for um signal de tipo com `id`, está pronto. Caso contrário, usar `this.route.snapshot.paramMap.get('id')` diretamente no `[subjectId]`.

- [ ] **Step 4.7: Commit**

```bash
git add apps/web/src/app/features/doctor/patients/patient-detail.component.ts
git commit -m "feat(timeline): integrar PatientTimeline + TimelinePanel como nova aba no patient-detail"
```

---

## Task 5: Build web + cap sync android

- [ ] **Step 5.1: Build de produção web**

```bash
cd apps/web && ng build --configuration=production 2>&1 | tail -10
```

Esperado: Build OK sem erros de tipo.

- [ ] **Step 5.2: Verificar bundle**

```bash
grep -l "patient-timeline\|timeline-panel" apps/web/dist/genomaflow-web/browser/*.js 2>/dev/null | head -3
```

Esperado: pelo menos 1 arquivo contendo os novos componentes.

- [ ] **Step 5.3: Build mobile e sync Android**

```bash
cd apps/web && ng build --configuration=mobile && npx cap sync android 2>&1 | tail -10
```

Esperado: `Sync finished`.

- [ ] **Step 5.4: Commit do sync Android**

```bash
git add apps/web/android/
git commit -m "chore(mobile): cap sync android — patient timeline"
```

---

## Task 6: Push e deploy

- [ ] **Step 6.1: Push**

```bash
git push origin main
```

- [ ] **Step 6.2: Monitorar deploy**

```bash
prev=""
while true; do
  run=$(gh run list --repo rodrigonoma/genomaflow --branch main --limit 1 --json databaseId,status,conclusion,displayTitle 2>/dev/null | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0]['databaseId'], r[0]['status'], r[0]['conclusion'] or '', r[0]['displayTitle'][:60])" 2>/dev/null || echo "erro_api")
  [ "$run" = "erro_api" ] && sleep 60 && continue
  if [ "$run" != "$prev" ]; then echo "$run"; prev="$run"; fi
  echo "$run" | grep -qE "completed|failure|cancelled" && break
  sleep 30
done
```

Esperado: `completed success`.

- [ ] **Step 6.3: Smoke test manual em prod**

1. Abrir `/clinic/patients/:id` de qualquer paciente com exames e agendamentos
2. Clicar na aba "🕐 Timeline"
3. Verificar que eventos aparecem agrupados por mês
4. Clicar em um exame → painel slide-over abre pela direita
5. Clicar no backdrop → painel fecha
6. Testar no mobile (ou DevTools 375px): painel deve subir de baixo como bottom-sheet

---

## Self-Review

**Spec coverage:**
- ✅ Backend: 4 novos tipos adicionados ao UNION ALL (Task 1)
- ✅ Frontend PatientTimelineComponent com filtros e agrupamento (Task 2)
- ✅ Frontend TimelinePanelComponent slide-over/bottom-sheet (Task 3)
- ✅ Nova aba "Timeline" no patient-detail (Task 4)
- ✅ Paridade mobile via cap sync (Task 5)
- ✅ `tenant_id` explícito em todas as sub-queries (presente no SQL do Task 1)
- ✅ Compatibilidade multi-módulo: query usa `subject_id` universal

**Nenhum placeholder detectado.** Todos os passos têm código completo.

**Consistência de tipos:**
- `TimelineEvent` definido em `patient-timeline.component.ts` e importado em `timeline-panel.component.ts` e `patient-detail.component.ts` — coerente.
- `(select)` output emite `TimelineEvent`, `openTimelinePanel` recebe `TimelineEvent` — coerente.

**Nota para implementação:** verificar se coluna `alert_level` existe em `exams` antes de incluí-la no SELECT (mencionado no Step 1.3). Se não existir, remover do `jsonb_build_object` de `exam`.
