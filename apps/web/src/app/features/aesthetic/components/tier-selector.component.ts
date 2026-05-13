/**
 * TierSelectorComponent
 *
 * Wizard step inicial do fluxo de análise estética V2: 2 cards lado-a-lado
 * permitindo o esteticista escolher entre Análise Rápida 2D (standard, 5cr)
 * ou Análise Avançada — Captura Guiada (advanced, 10cr, com landmarks).
 *
 * Custos exibidos vêm via @Input — defaults batem com os COST_TABLE atuais
 * do backend (apps/api/src/routes/aesthetic-analyses.js).
 *
 * Spec: docs/superpowers/specs/2026-05-12-aesthetic-v2-fase1-design.md §16.2
 */
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type AnalysisTier = 'standard' | 'advanced';

@Component({
  selector: 'app-tier-selector',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    :host { display: block; }

    .tier-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      margin-top: 0.5rem;
    }
    @media (max-width: 720px) {
      .tier-grid { grid-template-columns: 1fr; }
    }

    .tier-card {
      position: relative;
      border-radius: 14px;
      padding: 1.5rem 1.25rem 1.25rem;
      cursor: pointer;
      transition: transform .15s, box-shadow .15s, border-color .15s;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      min-height: 320px;
    }
    .tier-card:focus-visible { outline: 2px solid #c0c1ff; outline-offset: 3px; }
    .tier-card:hover { transform: translateY(-2px); }

    .tier-card.standard {
      background: rgba(192, 193, 255, 0.06);
      border: 2px solid rgba(192, 193, 255, 0.18);
      color: #dae2fd;
    }
    .tier-card.standard:hover {
      border-color: rgba(192, 193, 255, 0.45);
      box-shadow: 0 6px 18px rgba(192, 193, 255, 0.08);
    }

    .tier-card.advanced {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.10) 0%, rgba(236, 72, 153, 0.10) 100%);
      border: 2px solid rgba(245, 158, 11, 0.45);
      color: #fef3c7;
    }
    .tier-card.advanced:hover {
      border-color: #f59e0b;
      box-shadow: 0 10px 28px rgba(245, 158, 11, 0.18);
    }

    .badge-precisao {
      position: absolute;
      top: -10px;
      right: 16px;
      background: linear-gradient(90deg, #f59e0b, #ec4899);
      color: #ffffff;
      padding: 0.25rem 0.7rem;
      border-radius: 999px;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    }

    h3 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 600;
      line-height: 1.3;
    }

    .features {
      margin: 0;
      padding-left: 1.1rem;
      font-size: 0.85rem;
      line-height: 1.5;
      color: inherit;
      opacity: 0.85;
      flex: 1;
    }
    .features li { margin-bottom: 0.25rem; }

    .cost-row {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      margin-top: auto;
    }
    .cost {
      font-size: 1.6rem;
      font-weight: 700;
    }
    .standard .cost { color: #c0c1ff; }
    .advanced .cost { color: #fbbf24; }
    .cost-unit { font-size: 0.78rem; opacity: 0.7; }

    .cta {
      width: 100%;
      padding: 0.65rem 1rem;
      border-radius: 8px;
      border: none;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity .15s;
    }
    .cta:hover { opacity: 0.9; }

    .standard .cta {
      background: rgba(192, 193, 255, 0.18);
      color: #c0c1ff;
    }
    .advanced .cta {
      background: linear-gradient(90deg, #f59e0b, #ec4899);
      color: #ffffff;
    }
  `],
  template: `
    <div class="tier-grid" role="radiogroup" aria-label="Escolha o tipo de análise">

      <!-- ============ STANDARD ============ -->
      <div class="tier-card standard"
           role="radio"
           tabindex="0"
           [attr.aria-checked]="false"
           data-testid="tier-card-standard"
           (click)="emit('standard')"
           (keydown.enter)="emit('standard')"
           (keydown.space)="emit('standard'); $event.preventDefault()">
        <h3>Análise Rápida 2D</h3>
        <ul class="features">
          <li>1 a 3 fotos avulsas</li>
          <li>IA Visual (40+ métricas)</li>
          <li>Recomendador de protocolo</li>
          <li>PDF da análise</li>
        </ul>
        <div class="cost-row">
          <span class="cost">{{ standardCost }}</span>
          <span class="cost-unit">créditos</span>
        </div>
        <button class="cta" type="button" data-testid="btn-tier-standard">
          Começar análise rápida
        </button>
      </div>

      <!-- ============ ADVANCED ============ -->
      <div class="tier-card advanced"
           role="radio"
           tabindex="0"
           [attr.aria-checked]="false"
           data-testid="tier-card-advanced"
           (click)="emit('advanced')"
           (keydown.enter)="emit('advanced')"
           (keydown.space)="emit('advanced'); $event.preventDefault()">
        <span class="badge-precisao" aria-label="Tier premium com precisão geométrica">
          ✨ PRECISÃO
        </span>
        <h3>Análise Avançada — Captura Guiada</h3>
        <ul class="features">
          <li>5 fotos padronizadas (faciais) ou 4 (corporais)</li>
          <li>Landmarks + 10 métricas geométricas</li>
          <li>Comparação evolutiva válida (mesma escala)</li>
          <li>Base para Pseudo-3D futuro</li>
        </ul>
        <div class="cost-row">
          <span class="cost">{{ advancedCost }}</span>
          <span class="cost-unit">créditos</span>
        </div>
        <button class="cta" type="button" data-testid="btn-tier-advanced">
          Começar análise avançada
        </button>
      </div>

    </div>
  `,
})
export class TierSelectorComponent {
  /** Custo do tier standard (default 5 — bate com AESTHETIC_FACIAL_COST). */
  @Input() standardCost = 5;

  /** Custo do tier advanced (default 10 — AESTHETIC_FACIAL_COST_ADVANCED). */
  @Input() advancedCost = 10;

  /** Emite ao clicar em um dos cards. Pai roteia para o fluxo apropriado. */
  @Output() tierSelected = new EventEmitter<AnalysisTier>();

  emit(tier: AnalysisTier): void {
    this.tierSelected.emit(tier);
  }
}
