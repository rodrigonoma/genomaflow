/**
 * PhotoOverlayService
 *
 * Helpers para renderização de anotações SVG sobre fotos de análise estética:
 * - Palette de cores por métrica facial/corporal
 * - Escala de coordenadas normalizadas (0-1) para pixels
 * - Geração de string "points" para SVG polyline/polygon
 *
 * Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md §6.2
 */
import { Injectable } from '@angular/core';
import {
  Region,
  RegionBbox,
  RegionPolyline,
  RegionPolygon,
  RegionLine,
  RegionPoint,
} from '../models/analysis.model';

// ---------------------------------------------------------------------------
// Palette de cores por métrica
// ---------------------------------------------------------------------------

/** Mapa nome-da-métrica → cor hex usada nos overlays SVG. */
export const METRIC_COLORS: Record<string, string> = {
  // --- 11 métricas faciais ---
  rugas:            '#60a5fa', // blue-400
  manchas:          '#fb923c', // orange-400
  vermelhidao:      '#f87171', // red-400
  olheiras:         '#a78bfa', // violet-400
  poros:            '#9ca3af', // gray-400
  acne:             '#ef4444', // red-500
  simetria:         '#34d399', // emerald-400
  uniformidade_tom: '#fbbf24', // amber-400
  textura:          '#e879f9', // fuchsia-400
  firmeza:          '#22d3ee', // cyan-400
  elasticidade:     '#22d3ee', // cyan-400 (mesma família)

  // --- Métricas corporais (extensão futura) ---
  culote_frente:    '#f59e0b', // amber-500
  culote_lado:      '#f59e0b',
  gluteos_frente:   '#84cc16', // lime-400
  gluteos_lado:     '#84cc16',
  flacidez_abdominal: '#f97316', // orange-500
  gordura_localizada: '#facc15', // yellow-400
};

// ---------------------------------------------------------------------------
// Tipos auxiliares — versões escalonadas das regiões
// ---------------------------------------------------------------------------

export type ScaledRegion =
  | { type: 'bbox'; x: number; y: number; width: number; height: number }
  | { type: 'polyline'; points: Array<{ x: number; y: number }> }
  | { type: 'polygon';  points: Array<{ x: number; y: number }> }
  | { type: 'line';     x1: number; y1: number; x2: number; y2: number }
  | { type: 'point';    x: number; y: number };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class PhotoOverlayService {

  /**
   * Returns the color hex for a given metric name.
   * Falls back to a neutral slate-400 (#94a3b8) for unknown metrics.
   */
  colorForMetric(metric: string): string {
    return METRIC_COLORS[metric] ?? '#94a3b8';
  }

  /**
   * Converts an array of normalized [x, y] pairs (0-1) to the SVG
   * `points` attribute format: "x1,y1 x2,y2 ...".
   *
   * @param points Array of [normX, normY] tuples
   * @param W Canvas/image width in pixels
   * @param H Canvas/image height in pixels
   */
  scalePoints(points: [number, number][], W: number, H: number): string {
    return points
      .map(([nx, ny]) => `${Math.round(nx * W)},${Math.round(ny * H)}`)
      .join(' ');
  }

  /**
   * Scales a Region (whose coordinates are normalized 0-1) to pixel coordinates
   * given the display width W and height H.
   */
  scaleRegion(region: Region, W: number, H: number): ScaledRegion {
    switch (region.type) {
      case 'bbox': {
        const r = region as RegionBbox;
        return {
          type: 'bbox',
          x:      Math.round(r.x * W),
          y:      Math.round(r.y * H),
          width:  Math.round(r.width * W),
          height: Math.round(r.height * H),
        };
      }

      case 'polyline': {
        const r = region as RegionPolyline;
        return {
          type: 'polyline',
          points: r.points.map(p => ({
            x: Math.round(p.x * W),
            y: Math.round(p.y * H),
          })),
        };
      }

      case 'polygon': {
        const r = region as RegionPolygon;
        return {
          type: 'polygon',
          points: r.points.map(p => ({
            x: Math.round(p.x * W),
            y: Math.round(p.y * H),
          })),
        };
      }

      case 'line': {
        const r = region as RegionLine;
        return {
          type: 'line',
          x1: Math.round(r.x1 * W),
          y1: Math.round(r.y1 * H),
          x2: Math.round(r.x2 * W),
          y2: Math.round(r.y2 * H),
        };
      }

      case 'point': {
        const r = region as RegionPoint;
        return {
          type: 'point',
          x: Math.round(r.x * W),
          y: Math.round(r.y * H),
        };
      }
    }
  }
}
