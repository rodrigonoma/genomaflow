/**
 * LayerToolbarComponent
 *
 * Toolbar de controle das camadas de anotação SVG:
 * - Lista de checkboxes: 1 por métrica disponível (cor + nome + contagem regions)
 * - Slider de opacidade global
 * - Botões "Mostrar todos" / "Ocultar todos"
 *
 * Usa two-way binding via `model()` para `activeLayers` e `opacity`.
 *
 * Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md §6.2
 * Plan: docs/superpowers/plans/2026-05-11-aesthetic-f1-facial.md Task 20
 */
import { Component, computed, input, model, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PhotoOverlayService } from '../services/photo-overlay.service';

// ---------------------------------------------------------------------------
// Public input type
// ---------------------------------------------------------------------------

export interface MetricSummary {
  key: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-layer-toolbar',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    .layer-toolbar {
      font-family: 'Inter', sans-serif;
      padding: 0.75rem 1rem;
      background: rgba(10, 10, 20, 0.85);
      border-radius: 8px;
      min-width: 200px;
    }
    h4 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 13px; font-weight: 600; color: #dae2fd;
      margin: 0 0 0.75rem;
    }
    .layer-row {
      display: flex; align-items: center; gap: 0.5rem;
      cursor: pointer; padding: 0.25rem 0;
      font-size: 12px; color: #9b9aad;
    }
    .layer-row input[type="checkbox"] { cursor: pointer; }
    .color-chip {
      display: inline-block; width: 10px; height: 10px;
      border-radius: 2px; flex-shrink: 0;
    }
    .layer-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .toolbar-actions {
      display: flex; gap: 0.5rem; margin: 0.75rem 0 0;
    }
    .toolbar-actions button {
      flex: 1; padding: 0.3rem 0.5rem;
      font-family: 'Inter', sans-serif; font-size: 11px;
      background: rgba(192,193,255,0.08); color: #c0c1ff;
      border: 1px solid rgba(192,193,255,0.2); border-radius: 4px;
      cursor: pointer;
    }
    .toolbar-actions button:hover { background: rgba(192,193,255,0.16); }
    .opacity-slider {
      margin-top: 0.75rem; font-size: 12px; color: #9b9aad;
    }
    .opacity-slider label { display: block; margin-bottom: 0.25rem; }
    .opacity-slider input[type="range"] { width: 100%; cursor: pointer; }
  `],
  template: `
    <div class="layer-toolbar">
      <h4>Camadas visíveis</h4>

      @for (metric of availableMetrics(); track metric.key) {
        <label class="layer-row">
          <input type="checkbox"
                 [checked]="isActive(metric.key)"
                 (change)="toggle(metric.key)" />
          <span class="color-chip" [style.background]="colorFor(metric.key)"></span>
          <span class="layer-name">{{ metric.key }} ({{ metric.count }})</span>
        </label>
      }

      <div class="toolbar-actions">
        <button (click)="showAll()">Mostrar todos</button>
        <button (click)="hideAll()">Ocultar todos</button>
      </div>

      <div class="opacity-slider">
        <label>Opacidade: {{ Math.round(opacity() * 100) }}%</label>
        <input type="range" min="0" max="100"
               [value]="opacity() * 100"
               (input)="setOpacity(+$any($event).target.value / 100)" />
      </div>
    </div>
  `,
})
export class LayerToolbarComponent {
  // -------------------------------------------------------------------------
  // Dependencies
  // -------------------------------------------------------------------------

  private readonly overlayService = inject(PhotoOverlayService);

  // -------------------------------------------------------------------------
  // Inputs / two-way models
  // -------------------------------------------------------------------------

  readonly availableMetrics = input<MetricSummary[]>([]);
  readonly activeLayers     = model<string[]>([]);
  readonly opacity          = model<number>(0.4);

  // -------------------------------------------------------------------------
  // Expose Math for template
  // -------------------------------------------------------------------------

  readonly Math = Math;

  // -------------------------------------------------------------------------
  // Methods
  // -------------------------------------------------------------------------

  isActive(key: string): boolean {
    return this.activeLayers().includes(key);
  }

  toggle(key: string): void {
    const current = this.activeLayers();
    if (current.includes(key)) {
      this.activeLayers.set(current.filter(k => k !== key));
    } else {
      this.activeLayers.set([...current, key]);
    }
  }

  showAll(): void {
    this.activeLayers.set(this.availableMetrics().map(m => m.key));
  }

  hideAll(): void {
    this.activeLayers.set([]);
  }

  setOpacity(v: number): void {
    this.opacity.set(Math.min(1, Math.max(0, v)));
  }

  colorFor(key: string): string {
    return this.overlayService.colorForMetric(key);
  }
}
