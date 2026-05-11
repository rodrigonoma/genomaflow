import { Component, EventEmitter, Output, ChangeDetectionStrategy } from '@angular/core';
import { AnalysisType } from '../models/analysis.model';

interface RegionCard {
  key: AnalysisType;
  label: string;
  iconEmoji: string;
  description: string;
  sensitive?: boolean;
}

const REGIONS: RegionCard[] = [
  { key: 'facial',    label: 'Facial',            iconEmoji: '👤', description: '11 métricas' },
  { key: 'eyelids',   label: 'Pálpebras',         iconEmoji: '👁️', description: '5 métricas' },
  { key: 'neck',      label: 'Pescoço',           iconEmoji: '🦴', description: '5 métricas' },
  { key: 'breast',    label: 'Mama / Tórax',      iconEmoji: '🔒', description: '4 métricas — região sensível', sensitive: true },
  { key: 'arms',      label: 'Braços',            iconEmoji: '💪', description: '5 métricas' },
  { key: 'abdomen',   label: 'Abdômen',           iconEmoji: '🤰', description: '5 métricas — região sensível', sensitive: true },
  { key: 'legs',      label: 'Coxas',             iconEmoji: '🦵', description: '6 métricas' },
  { key: 'glutes',    label: 'Glúteos',           iconEmoji: '🍑', description: '4 métricas — região sensível', sensitive: true },
  { key: 'full_body', label: 'Silhueta completa', iconEmoji: '🚶', description: '4 métricas globais' },
  { key: 'other',     label: 'Outra',             iconEmoji: '➕', description: 'genérica' },
];

@Component({
  selector: 'app-region-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="region-picker">
      <h3>Selecione a região anatômica</h3>
      <div class="region-grid">
        @for (region of regions; track region.key) {
          <button class="region-card"
                  [class.sensitive]="region.sensitive"
                  [attr.data-testid]="'region-card'"
                  [attr.data-region]="region.key"
                  (click)="select(region.key)">
            <span class="emoji">{{ region.iconEmoji }}</span>
            <span class="label">{{ region.label }}</span>
            <span class="desc">{{ region.description }}</span>
          </button>
        }
      </div>
      <p class="note">Regiões marcadas como "sensível" exigem consentimento operacional reforçado (F5).</p>
    </div>
  `,
  styles: [`
    .region-picker { padding: 1.5rem; }
    .region-picker h3 { margin: 0 0 1rem; font-size: 1.25rem; }
    .region-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;
    }
    @media (max-width: 640px) { .region-grid { grid-template-columns: repeat(2, 1fr); } }
    .region-card {
      display: flex; flex-direction: column; align-items: center; padding: 1.5rem 1rem;
      background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.15);
      border-radius: 12px; cursor: pointer; color: inherit;
      transition: background .15s, border-color .15s;
    }
    .region-card:hover { background: rgba(168,85,247,.15); border-color: rgba(168,85,247,.5); }
    .region-card.sensitive { border-color: rgba(251,191,36,.4); }
    .emoji { font-size: 2rem; margin-bottom: .5rem; }
    .label { font-weight: 600; }
    .desc { font-size: .8rem; opacity: .7; margin-top: .25rem; text-align: center; }
    .note { margin-top: 1rem; font-size: .8rem; opacity: .6; }
  `],
})
export class RegionPickerComponent {
  readonly regions = REGIONS;

  @Output() regionSelected = new EventEmitter<AnalysisType>();

  select(region: AnalysisType): void {
    this.regionSelected.emit(region);
  }
}
