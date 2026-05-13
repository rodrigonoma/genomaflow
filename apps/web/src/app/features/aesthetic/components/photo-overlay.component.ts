/**
 * PhotoOverlayComponent
 *
 * Renderiza <img> + <svg> overlay com regiões anotadas por métrica.
 * Cada camada (layer) = uma chave de métrica do mapa `metrics`.
 * Apenas as chaves em `activeLayers` são exibidas no SVG.
 *
 * Inputs (signals):
 *   photoUrl     — URL da foto a exibir
 *   metrics      — mapa Record<string, MetricData> com regions[] normalizadas (0–1)
 *   activeLayers — lista de chaves de métricas visíveis
 *   opacity      — 0-1, aplicado em cada <g> do SVG
 *
 * Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md §6.2
 * Plan: docs/superpowers/plans/2026-05-11-aesthetic-f1-facial.md Task 19
 */
import {
  Component,
  ElementRef,
  ViewChild,
  computed,
  input,
  signal,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { PhotoOverlayService } from '../services/photo-overlay.service';
import { Metrics, Region, RegionBbox, RegionPolyline, RegionPolygon, RegionLine, RegionPoint } from '../models/analysis.model';

// ---------------------------------------------------------------------------
// Internal shape for a computed visible layer
// ---------------------------------------------------------------------------

interface VisibleLayer {
  key: string;
  color: string;
  regions: Region[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-photo-overlay',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    .photo-overlay-container { position: relative; display: inline-block; }
    .photo-overlay-container img { display: block; max-width: 100%; }
    .photo-overlay-container svg {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none;
    }
  `],
  template: `
    <div class="photo-overlay-container">
      <img [src]="photoUrl()" #photo (load)="onPhotoLoaded()" />
      @if (loaded()) {
        <svg [attr.viewBox]="'0 0 ' + photoW() + ' ' + photoH()"
             preserveAspectRatio="xMidYMid slice">
          @for (layer of visibleLayers(); track layer.key) {
            <g [attr.data-metric]="layer.key"
               [attr.fill]="layer.color"
               [attr.stroke]="layer.color">
              @for (region of layer.regions; track $index) {
                <g [attr.opacity]="severityOpacity(region) ?? opacity()"
                   [attr.data-severity]="region.severity ?? null">
                  @switch (region.type) {
                    @case ('bbox') {
                      <rect [attr.x]="asBbox(region).x * photoW()"
                            [attr.y]="asBbox(region).y * photoH()"
                            [attr.width]="asBbox(region).width * photoW()"
                            [attr.height]="asBbox(region).height * photoH()" />
                    }
                    @case ('polyline') {
                      <polyline [attr.points]="scalePoints(asPolyline(region).points)"
                                fill="none" stroke-width="2" />
                    }
                    @case ('polygon') {
                      <polygon [attr.points]="scalePoints(asPolygon(region).points)" />
                    }
                    @case ('line') {
                      <line [attr.x1]="asLine(region).x1 * photoW()"
                            [attr.y1]="asLine(region).y1 * photoH()"
                            [attr.x2]="asLine(region).x2 * photoW()"
                            [attr.y2]="asLine(region).y2 * photoH()"
                            stroke-width="2" />
                    }
                    @case ('point') {
                      <circle [attr.cx]="asPoint(region).x * photoW()"
                              [attr.cy]="asPoint(region).y * photoH()"
                              r="6" />
                    }
                  }
                </g>
              }
            </g>
          }
        </svg>
      }
    </div>
  `,
})
export class PhotoOverlayComponent {
  // -------------------------------------------------------------------------
  // Dependencies
  // -------------------------------------------------------------------------

  private readonly overlayService = inject(PhotoOverlayService);

  // -------------------------------------------------------------------------
  // Inputs
  // -------------------------------------------------------------------------

  readonly photoUrl    = input<string>('');
  readonly metrics     = input<Metrics>({});
  readonly activeLayers = input<string[]>([]);
  readonly opacity     = input<number>(0.4);

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  readonly loaded = signal(false);
  readonly photoW = signal(0);
  readonly photoH = signal(0);

  @ViewChild('photo') photoRef!: ElementRef<HTMLImageElement>;

  // -------------------------------------------------------------------------
  // Computed
  // -------------------------------------------------------------------------

  readonly visibleLayers = computed<VisibleLayer[]>(() => {
    const metricsMap = this.metrics();
    return this.activeLayers()
      .filter(key => !!metricsMap[key])
      .map(key => ({
        key,
        color: this.overlayService.colorForMetric(key),
        regions: metricsMap[key].regions,
      }));
  });

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  onPhotoLoaded(): void {
    const img = this.photoRef?.nativeElement;
    if (!img) return;
    this.photoW.set(img.naturalWidth || img.offsetWidth || 1000);
    this.photoH.set(img.naturalHeight || img.offsetHeight || 500);
    this.loaded.set(true);
  }

  // -------------------------------------------------------------------------
  // Template helpers — narrow Region discriminated union
  // -------------------------------------------------------------------------

  asBbox(region: Region): RegionBbox       { return region as RegionBbox; }
  asPolyline(region: Region): RegionPolyline { return region as RegionPolyline; }
  asPolygon(region: Region): RegionPolygon  { return region as RegionPolygon; }
  asLine(region: Region): RegionLine        { return region as RegionLine; }
  asPoint(region: Region): RegionPoint      { return region as RegionPoint; }

  /**
   * V2 Fase 2: opacity proporcional à severity (0-100, 100=grave).
   * Retorna null se region não tem severity → fallback pra opacity global.
   * Clamp 0.2..0.9 — sempre visível, mas modulação clara entre regiões.
   */
  severityOpacity(region: Region): number | null {
    const sev = region.severity;
    if (typeof sev !== 'number') return null;
    return Math.max(0.2, Math.min(0.9, sev / 100));
  }

  scalePoints(points: Array<{ x: number; y: number }>): string {
    const tuples: [number, number][] = points.map(p => [p.x, p.y]);
    return this.overlayService.scalePoints(tuples, this.photoW(), this.photoH());
  }
}
