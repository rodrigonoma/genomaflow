import { Component, Input, OnInit, OnChanges, signal, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { EncountersService, ClinicalEncounter } from './encounters.service';

@Component({
  selector: 'app-encounter-list',
  standalone: true,
  imports: [CommonModule, DatePipe],
  template: `
    @if (loading()) {
      <p class="muted">Carregando evoluções…</p>
    } @else if (items().length === 0) {
      <p class="muted">Nenhuma evolução registrada para este paciente.</p>
    } @else {
      <ul class="list">
        @for (e of items(); track e.id) {
          <li class="encounter">
            <header>
              <span class="type">{{ e.encounter_type }}</span>
              <span class="date">{{ e.created_at | date:'dd/MM/yyyy HH:mm' }}</span>
              @if (e.signed_at) {
                <span class="signed" title="Assinado">🔒 Assinado</span>
              }
            </header>
            @if (e.chief_complaint) {
              <p><strong>Queixa:</strong> {{ e.chief_complaint }}</p>
            }
            @if (e.anamnesis) {
              <p><strong>Anamnese:</strong> {{ e.anamnesis }}</p>
            }
            @if (e.physical_exam) {
              <p><strong>Exame físico:</strong> {{ e.physical_exam }}</p>
            }
            @if (e.hypothesis) {
              <p><strong>Hipótese:</strong> {{ e.hypothesis }}</p>
            }
            @if (e.conduct) {
              <p><strong>Conduta:</strong> {{ e.conduct }}</p>
            }
            @if (e.return_recommendation) {
              <p><strong>Retorno:</strong> {{ e.return_recommendation }}</p>
            }
            @if (e.weight_kg || e.temperature_c || e.heart_rate_bpm) {
              <p class="vitals">
                @if (e.weight_kg) { <span>{{ e.weight_kg }}kg</span> }
                @if (e.temperature_c) { <span>{{ e.temperature_c }}°C</span> }
                @if (e.heart_rate_bpm) { <span>FC {{ e.heart_rate_bpm }}</span> }
                @if (e.respiratory_rate_rpm) { <span>FR {{ e.respiratory_rate_rpm }}</span> }
                @if (e.blood_pressure_systolic && e.blood_pressure_diastolic) {
                  <span>PA {{ e.blood_pressure_systolic }}×{{ e.blood_pressure_diastolic }}</span>
                }
                @if (e.hydration) { <span>Hidr {{ e.hydration }}</span> }
                @if (e.mucosa) { <span>Muc {{ e.mucosa }}</span> }
              </p>
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
    .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
    .encounter { background: #171f33; border-left: 2px solid #c0c1ff; padding: 12px 16px; border-radius: 0 4px 4px 0; }
    header { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
    .type { background: #c0c1ff; color: #4b4d83; padding: 2px 8px; border-radius: 3px; font-size: 0.625rem;
            text-transform: uppercase; letter-spacing: 0.1em; font-family: 'JetBrains Mono', monospace; font-weight: 600; }
    .date { color: #c7c5d0; font-size: 0.75rem; font-family: 'JetBrains Mono', monospace; }
    .signed { color: #ffd166; font-size: 0.75rem; }
    p { margin: 4px 0; font-size: 0.875rem; color: #dbe2fd; }
    p strong { color: #c0c1ff; font-weight: 600; }
    .vitals { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; padding-top: 8px;
              border-top: 1px solid #2a3148; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: #c7c5d0; }
    .more { margin-top: 12px; padding: 8px 16px; background: #2a3148; color: #c0c1ff; border: none;
            border-radius: 4px; cursor: pointer; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; }
    .more[disabled] { opacity: 0.5; cursor: not-allowed; }
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
}
