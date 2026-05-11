import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface TreatmentProtocolCardItem {
  treatment_id?: string | null;
  treatment_name: string;
  indication_text?: string;
  sessions_recommended?: number;
  interval_days?: number;
  urgency?: string;
  expected_outcome?: string;
  in_catalog?: boolean;
  requires_medico?: boolean;
  cost_estimate_brl_min?: number | null;
  cost_estimate_brl_max?: number | null;
}

@Component({
  selector: 'app-treatment-protocol-cards',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .cards { display: flex; flex-direction: column; gap: 0.75rem; }
    .card {
      border: 1px solid rgba(150,150,200,0.18);
      border-radius: 10px;
      padding: 1rem;
      background: rgba(20,20,40,0.65);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    h5 {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      color: #e6ecff;
      font-size: 1rem;
      font-weight: 600;
    }
    .badge {
      font-size: 0.7rem;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-new { background: rgba(255,200,80,0.18); color: #ffc850; }
    .badge-medico { background: rgba(220,80,180,0.22); color: #f088c8; }
    .urgency-baixa, .urgency-low { background: rgba(120,200,140,0.2); color: #80d090; }
    .urgency-media, .urgency-medium { background: rgba(240,200,90,0.2); color: #f0c850; }
    .urgency-alta, .urgency-high { background: rgba(240,100,100,0.2); color: #f06868; }
    p { margin: 0; color: #b8c0d8; font-size: 0.9rem; line-height: 1.4; }
    .meta { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.85rem; color: #95a0bc; }
    .outcome { font-style: italic; color: #9ec0e8; }
    .cost { color: #80d090; font-weight: 500; }
    .actions { display: flex; gap: 0.5rem; margin-top: 0.25rem; }
    button.schedule {
      background: linear-gradient(90deg, #5b8def, #7a5bef);
      color: #fff;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      font-size: 0.85rem;
    }
    button.schedule:hover { opacity: 0.92; }
    button.schedule:disabled { opacity: 0.45; cursor: not-allowed; }
    .empty { color: #95a0bc; font-style: italic; }
  `],
  template: `
    @if (items().length === 0) {
      <p class="empty">Nenhum tratamento sugerido.</p>
    } @else {
      <div class="cards">
        @for (t of items(); track t.treatment_id || t.treatment_name) {
          <article class="card" data-testid="treatment-card">
            <h5>
              <span>{{ t.treatment_name }}</span>
              @if (t.in_catalog === false) {
                <span class="badge badge-new" data-testid="badge-new">Em breve catálogo</span>
              }
              @if (t.requires_medico) {
                <span class="badge badge-medico">Requer médico</span>
              }
              @if (t.urgency) {
                <span class="badge urgency-{{ t.urgency }}">{{ t.urgency }}</span>
              }
            </h5>
            @if (t.indication_text) {
              <p>{{ t.indication_text }}</p>
            }
            <div class="meta">
              @if (t.sessions_recommended != null) {
                <span>{{ t.sessions_recommended }} sessões</span>
              }
              @if (t.interval_days != null) {
                <span>· intervalo de {{ t.interval_days }} dias</span>
              }
              @if (formatCost(t)) {
                <span class="cost">{{ formatCost(t) }}</span>
              }
            </div>
            @if (t.expected_outcome) {
              <p class="outcome">{{ t.expected_outcome }}</p>
            }
            <div class="actions">
              <button
                type="button"
                class="schedule"
                data-testid="schedule-btn"
                [disabled]="t.in_catalog === false"
                (click)="onSchedule(t)">
                Agendar agora
              </button>
            </div>
          </article>
        }
      </div>
    }
  `,
})
export class TreatmentProtocolCardsComponent {
  readonly items = input.required<TreatmentProtocolCardItem[]>();
  readonly schedule = output<TreatmentProtocolCardItem>();

  onSchedule(item: TreatmentProtocolCardItem): void {
    if (item.in_catalog === false) return; // disabled UX
    this.schedule.emit(item);
  }

  formatCost(t: TreatmentProtocolCardItem): string | null {
    if (t.cost_estimate_brl_min == null && t.cost_estimate_brl_max == null) return null;
    const fmt = (v: number) =>
      v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    if (t.cost_estimate_brl_min != null && t.cost_estimate_brl_max != null) {
      return `R$ ${fmt(t.cost_estimate_brl_min)} – ${fmt(t.cost_estimate_brl_max)}`;
    }
    if (t.cost_estimate_brl_min != null) return `a partir de R$ ${fmt(t.cost_estimate_brl_min)}`;
    return `até R$ ${fmt(t.cost_estimate_brl_max!)}`;
  }
}
