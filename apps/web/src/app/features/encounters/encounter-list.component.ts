import { Component, Input, OnInit, OnChanges, signal, inject, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EncountersService, ClinicalEncounter } from './encounters.service';

/**
 * Lista profissional de encounters (evoluções clínicas) para a aba Prontuário.
 *
 * UX:
 * - Cards compactos: data + tipo + origem + queixa snippet sempre visíveis.
 * - Click no card abre/fecha detalhes inline (toggle).
 * - Filtros opcionais por origem (manual, video_ai) e tipo (chip selecionável).
 * - Indicação visual de assinado (cadeado), origem (badge IA / consulta de vídeo).
 *
 * Decisão (2026-05-09): substituiu render anterior que despejava todos os campos
 * inline (queixa, anamnese, exame, hipótese, conduta, retorno, vitals) sem clique
 * — virava um muro de texto não navegável.
 */
@Component({
  selector: 'app-encounter-list',
  standalone: true,
  imports: [CommonModule, DatePipe, MatIconModule, MatTooltipModule],
  template: `
    @if (loading()) {
      <p class="muted">Carregando evoluções…</p>
    } @else if (items().length === 0) {
      <div class="empty">
        <mat-icon>description</mat-icon>
        <div class="empty-title">Sem registros clínicos ainda</div>
        <div class="empty-sub">
          Aqui ficam os registros do prontuário deste paciente: consultas, retornos, evoluções clínicas,
          procedimentos e telemedicina. Para começar, clique em <strong>Nova evolução</strong> acima.
        </div>
      </div>
    } @else {
      <!-- Toolbar: contador + filtros -->
      <div class="toolbar">
        <div class="count">{{ items().length }} {{ items().length === 1 ? 'evolução' : 'evoluções' }}</div>
        <div class="filters">
          @for (f of typeFilters(); track f.value) {
            <button class="chip"
                    [class.active]="activeTypeFilter() === f.value"
                    (click)="setTypeFilter(f.value)">
              {{ f.label }} @if (f.count > 0) { · {{ f.count }} }
            </button>
          }
        </div>
      </div>

      <!-- Cards -->
      <ul class="list">
        @for (e of filtered(); track e.id) {
          @let expanded = expandedId() === e.id;
          <li class="encounter" [class.expanded]="expanded">
            <!-- Header sempre visível, clicável -->
            <button class="header" (click)="toggle(e.id)" [attr.aria-expanded]="expanded">
              <div class="hdr-row1">
                <span class="type-badge" [class.ai]="e.source === 'video_ai'">
                  {{ encounterTypeLabel(e.encounter_type) }}
                  @if (e.source === 'video_ai') { · IA }
                </span>
                <span class="date">{{ e.created_at | date:'dd/MM/yyyy HH:mm' }}</span>
                @if (e.signed_at) {
                  <span class="signed" matTooltip="Assinado em {{ e.signed_at | date:'dd/MM/yyyy HH:mm' }}">
                    <mat-icon class="ic">lock</mat-icon> assinado
                  </span>
                } @else {
                  <span class="draft" matTooltip="Rascunho — não assinado">rascunho</span>
                }
                <mat-icon class="chevron" [class.open]="expanded">expand_more</mat-icon>
              </div>
              @if (e.chief_complaint) {
                <div class="snippet">
                  <strong>Queixa:</strong> {{ e.chief_complaint | slice:0:120 }}{{ (e.chief_complaint?.length ?? 0) > 120 ? '…' : '' }}
                </div>
              }
              @if (e.professional_email && !e.chief_complaint) {
                <div class="snippet muted-sm">{{ e.professional_email }}</div>
              }
            </button>

            <!-- Detalhes expandidos -->
            @if (expanded) {
              <div class="details">
                @if (e.professional_email) {
                  <div class="meta-line"><mat-icon class="ic-sm">person</mat-icon> {{ e.professional_email }}</div>
                }

                @if (hasVitals(e)) {
                  <div class="vitals-grid">
                    @if (e.weight_kg != null) { <div class="vital"><span class="vk">Peso</span><span class="vv">{{ e.weight_kg }} kg</span></div> }
                    @if (e.temperature_c != null) { <div class="vital"><span class="vk">Temp.</span><span class="vv">{{ e.temperature_c }} °C</span></div> }
                    @if (e.heart_rate_bpm != null) { <div class="vital"><span class="vk">FC</span><span class="vv">{{ e.heart_rate_bpm }} bpm</span></div> }
                    @if (e.respiratory_rate_rpm != null) { <div class="vital"><span class="vk">FR</span><span class="vv">{{ e.respiratory_rate_rpm }} rpm</span></div> }
                    @if (e.blood_pressure_systolic && e.blood_pressure_diastolic) {
                      <div class="vital"><span class="vk">PA</span><span class="vv">{{ e.blood_pressure_systolic }}×{{ e.blood_pressure_diastolic }}</span></div>
                    }
                    @if (e.pain_score != null) { <div class="vital"><span class="vk">Dor</span><span class="vv">{{ e.pain_score }}/10</span></div> }
                    @if (e.hydration) { <div class="vital"><span class="vk">Hidr.</span><span class="vv">{{ e.hydration }}</span></div> }
                    @if (e.mucosa) { <div class="vital"><span class="vk">Muc.</span><span class="vv">{{ e.mucosa }}</span></div> }
                  </div>
                }

                <div class="sections">
                  @if (e.chief_complaint) { <div class="section"><div class="sec-label">Queixa principal</div><div class="sec-body">{{ e.chief_complaint }}</div></div> }
                  @if (e.anamnesis) { <div class="section"><div class="sec-label">Anamnese</div><div class="sec-body">{{ e.anamnesis }}</div></div> }
                  @if (e.physical_exam) { <div class="section"><div class="sec-label">Exame físico</div><div class="sec-body">{{ e.physical_exam }}</div></div> }
                  @if (e.hypothesis) { <div class="section"><div class="sec-label">Hipótese diagnóstica</div><div class="sec-body">{{ e.hypothesis }}</div></div> }
                  @if (e.conduct) { <div class="section"><div class="sec-label">Conduta</div><div class="sec-body">{{ e.conduct }}</div></div> }
                  @if (e.return_recommendation) { <div class="section"><div class="sec-label">Retorno</div><div class="sec-body">{{ e.return_recommendation }}</div></div> }
                  @if (e.medical_history) { <div class="section"><div class="sec-label">Histórico médico</div><div class="sec-body">{{ e.medical_history }}</div></div> }
                  @if (e.medications_in_use) { <div class="section"><div class="sec-label">Medicações em uso</div><div class="sec-body">{{ e.medications_in_use }}</div></div> }
                  @if (e.allergies) { <div class="section alergias"><div class="sec-label">Alergias</div><div class="sec-body">{{ e.allergies }}</div></div> }
                </div>

                @if ((e.attachments?.length ?? 0) > 0) {
                  <div class="attachments">
                    <div class="att-label">Anexos ({{ e.attachments.length }})</div>
                    <div class="att-list">
                      @for (a of e.attachments; track a.id || a.s3_key || $index) {
                        <span class="att-chip"><mat-icon class="ic-sm">attach_file</mat-icon> {{ a.filename || a.name || 'anexo' }}</span>
                      }
                    </div>
                  </div>
                }
              </div>
            }
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

    .empty { display:flex; flex-direction:column; align-items:center; gap:8px;
             padding:48px 24px; color:#7c7b8f; text-align:center; }
    .empty mat-icon { font-size:32px; width:32px; height:32px; opacity:.6; }
    .empty-title { font-family:'Space Grotesk',sans-serif; font-weight:600; color:#a09fb2; font-size:.95rem; }
    .empty-sub { font-size:.8rem; color:#6e6d80; max-width:340px; }

    .toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px;
               margin-bottom:12px; flex-wrap:wrap; }
    .count { font-family:'JetBrains Mono',monospace; font-size:11px; color:#7c7b8f;
             text-transform:uppercase; letter-spacing:.1em; }
    .filters { display:flex; gap:6px; flex-wrap:wrap; }
    .chip { background:transparent; border:1px solid rgba(70,69,84,.4); color:#a09fb2;
            border-radius:14px; padding:4px 10px; font-size:.7rem; cursor:pointer;
            font-family:'JetBrains Mono',monospace; transition:all 120ms; }
    .chip:hover { color:#dae2fd; border-color:rgba(192,193,255,.4); }
    .chip.active { background:rgba(192,193,255,.12); border-color:#c0c1ff; color:#c0c1ff; }

    .list { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:8px; }
    .encounter { background:#131b2e; border:1px solid rgba(70,69,84,.25); border-left:2px solid rgba(192,193,255,.5);
                 border-radius:0 6px 6px 0; overflow:hidden; transition:border-color 150ms; }
    .encounter.expanded { border-left-color:#c0c1ff; box-shadow:0 0 0 1px rgba(192,193,255,.18); }
    .encounter:hover { border-color:rgba(192,193,255,.35); }

    .header { width:100%; background:transparent; border:none; padding:12px 16px;
              text-align:left; cursor:pointer; color:inherit; }
    .header:hover { background:rgba(192,193,255,.04); }
    .hdr-row1 { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }

    .type-badge { background:rgba(192,193,255,.16); color:#c0c1ff; padding:2px 8px; border-radius:3px;
                  font-size:.625rem; text-transform:uppercase; letter-spacing:.1em;
                  font-family:'JetBrains Mono',monospace; font-weight:600; }
    .type-badge.ai { background:rgba(168,85,247,.18); color:#d8b4fe; }
    .date { color:#a09fb2; font-size:.75rem; font-family:'JetBrains Mono',monospace; }
    .signed { color:#86efac; font-size:.7rem; display:inline-flex; align-items:center; gap:3px; }
    .signed .ic { font-size:13px; width:13px; height:13px; }
    .draft { color:#fcd34d; font-size:.65rem; font-family:'JetBrains Mono',monospace;
             text-transform:uppercase; letter-spacing:.1em;
             border:1px solid rgba(252,211,77,.4); border-radius:3px; padding:1px 5px; }
    .chevron { margin-left:auto; color:#6e6d80; transition:transform 200ms; font-size:18px; width:18px; height:18px; }
    .chevron.open { transform:rotate(180deg); color:#c0c1ff; }

    .snippet { font-size:.825rem; color:#dae2fd; margin-top:6px; line-height:1.5; }
    .snippet strong { color:#c0c1ff; font-weight:600; }
    .muted-sm { color:#6e6d80; font-size:.75rem; }

    .details { padding:0 16px 14px 16px; border-top:1px solid rgba(70,69,84,.2); }

    .meta-line { display:flex; align-items:center; gap:6px; color:#a09fb2; font-size:.75rem;
                 padding:8px 0; }
    .ic-sm { font-size:13px; width:13px; height:13px; }

    .vitals-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(90px, 1fr));
                   gap:6px; margin:10px 0; padding:10px;
                   background:rgba(70,69,84,.1); border-radius:5px; }
    .vital { display:flex; flex-direction:column; align-items:center; gap:2px; }
    .vk { font-size:.6rem; color:#7c7b8f; font-family:'JetBrains Mono',monospace;
          text-transform:uppercase; letter-spacing:.08em; }
    .vv { font-size:.85rem; color:#dae2fd; font-weight:600; }

    .sections { display:flex; flex-direction:column; gap:10px; margin-top:8px; }
    .section { padding:8px 10px; background:#0e1525; border:1px solid rgba(70,69,84,.15);
               border-radius:4px; }
    .sec-label { font-size:.65rem; color:#7c7b8f; text-transform:uppercase; letter-spacing:.08em;
                 font-family:'JetBrains Mono',monospace; margin-bottom:4px; }
    .sec-body { font-size:.825rem; color:#dae2fd; line-height:1.55; white-space:pre-wrap; word-break:break-word; }
    .section.alergias .sec-body { color:#fca5a5; }

    .attachments { margin-top:12px; }
    .att-label { font-size:.65rem; color:#7c7b8f; text-transform:uppercase;
                 letter-spacing:.08em; font-family:'JetBrains Mono',monospace; margin-bottom:6px; }
    .att-list { display:flex; gap:6px; flex-wrap:wrap; }
    .att-chip { display:inline-flex; align-items:center; gap:4px; background:#171f33;
                border:1px solid rgba(70,69,84,.3); padding:3px 8px; border-radius:3px;
                font-size:.7rem; color:#c0c1ff; }

    .more { margin-top:12px; padding:8px 16px; background:#2a3148; color:#c0c1ff; border:none;
            border-radius:4px; cursor:pointer; font-size:.7rem; text-transform:uppercase;
            letter-spacing:.1em; font-family:'JetBrains Mono',monospace; }
    .more[disabled] { opacity:0.5; cursor:not-allowed; }
  `]
})
export class EncounterListComponent implements OnInit, OnChanges {
  @Input({ required: true }) subjectId!: string;
  @Input() refreshTick = 0;

  private encountersService = inject(EncountersService);

  items = signal<ClinicalEncounter[]>([]);
  loading = signal(false);
  loadingMore = signal(false);
  hasMore = signal(false);
  cursor: string | null = null;
  expandedId = signal<string | null>(null);
  activeTypeFilter = signal<string>('all'); // 'all' | encounter_type | 'video_ai'

  typeFilters = computed(() => {
    const all = this.items();
    const counts: Record<string, number> = { ['all']: all.length };
    for (const e of all) {
      counts[e.encounter_type] = (counts[e.encounter_type] || 0) + 1;
      if (e.source === 'video_ai') counts['video_ai'] = (counts['video_ai'] || 0) + 1;
    }
    const labels: Record<string, string> = {
      ['all']: 'Todas', consulta: 'Consulta', retorno: 'Retorno', evolucao: 'Evolução',
      procedimento: 'Procedimento', telemedicina: 'Telemedicina', outro: 'Outro',
      video_ai: '🎥 Vídeo IA',
    };
    const result: { value: string; label: string; count: number }[] = [];
    result.push({ value: 'all', label: labels['all'], count: counts['all'] || 0 });
    for (const k of Object.keys(counts)) {
      if (k === 'all' || (counts[k] || 0) === 0) continue;
      result.push({ value: k, label: labels[k] || k, count: counts[k] });
    }
    return result;
  });

  filtered = computed(() => {
    const f = this.activeTypeFilter();
    if (f === 'all') return this.items();
    if (f === 'video_ai') return this.items().filter(e => e.source === 'video_ai');
    return this.items().filter(e => e.encounter_type === f);
  });

  ngOnInit() { this.refresh(); }
  ngOnChanges() { this.refresh(); }

  refresh() {
    if (!this.subjectId) return;
    this.loading.set(true);
    this.cursor = null;
    this.encountersService.list(this.subjectId).subscribe({
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
    this.encountersService.list(this.subjectId, this.cursor).subscribe({
      next: (res) => {
        this.items.update(curr => [...curr, ...res.items]);
        this.hasMore.set(res.has_more);
        this.cursor = res.next_cursor;
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  toggle(id: string) {
    this.expandedId.update(curr => curr === id ? null : id);
  }

  setTypeFilter(value: string) {
    this.activeTypeFilter.set(value);
    this.expandedId.set(null);
  }

  encounterTypeLabel(t: string): string {
    const map: Record<string, string> = {
      consulta: 'Consulta', retorno: 'Retorno', evolucao: 'Evolução',
      procedimento: 'Procedimento', telemedicina: 'Telemedicina', outro: 'Outro',
    };
    return map[t] || t;
  }

  hasVitals(e: ClinicalEncounter): boolean {
    return !!(e.weight_kg != null || e.temperature_c != null || e.heart_rate_bpm != null
      || e.respiratory_rate_rpm != null || e.blood_pressure_systolic
      || e.pain_score != null || e.hydration || e.mucosa);
  }
}
