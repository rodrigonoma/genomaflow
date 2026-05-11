import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import {
  PhotoOverlayService,
  METRIC_COLORS,
} from './photo-overlay.service';
import { RegionBbox, RegionPolyline, RegionPolygon } from '../models/analysis.model';

describe('PhotoOverlayService', () => {
  let service: PhotoOverlayService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PhotoOverlayService);
  });

  // -----------------------------------------------------------------------
  // Test 1: colorForMetric — palette entry for known metric
  // -----------------------------------------------------------------------
  it('colorForMetric retorna a cor correta para rugas', () => {
    expect(service.colorForMetric('rugas')).toBe('#60a5fa');
  });

  it('colorForMetric retorna default #94a3b8 para métrica desconhecida', () => {
    expect(service.colorForMetric('unknown_metric')).toBe('#94a3b8');
  });

  // -----------------------------------------------------------------------
  // Test 2: scalePoints — produces correctly formatted SVG points string
  // -----------------------------------------------------------------------
  it('scalePoints converte coordenadas normalizadas para pixels', () => {
    // Points: (0.5, 0.5) and (1.0, 0.0) in a 200×100 canvas
    const points: [number, number][] = [[0.5, 0.5], [1.0, 0.0]];
    const result = service.scalePoints(points, 200, 100);
    expect(result).toBe('100,50 200,0');
  });

  // -----------------------------------------------------------------------
  // Test 3: scaleRegion — converts bbox / polyline correctly
  // -----------------------------------------------------------------------
  it('scaleRegion converte RegionBbox para pixels', () => {
    const bbox: RegionBbox = { type: 'bbox', x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
    const scaled = service.scaleRegion(bbox, 1000, 500);
    // x=100, y=100, width=500, height=200
    expect(scaled).toEqual({ type: 'bbox', x: 100, y: 100, width: 500, height: 200 });
  });

  it('scaleRegion converte RegionPolyline para pixels', () => {
    const poly: RegionPolyline = {
      type: 'polyline',
      points: [{ x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }],
    };
    const scaled = service.scaleRegion(poly, 400, 200);
    expect(scaled).toEqual({
      type: 'polyline',
      points: [{ x: 0, y: 0 }, { x: 400, y: 200 }],
    });
  });

  // -----------------------------------------------------------------------
  // Bonus: METRIC_COLORS contains all 11 facial metrics
  // -----------------------------------------------------------------------
  it('METRIC_COLORS contém as 11 métricas faciais', () => {
    const required = [
      'rugas', 'manchas', 'vermelhidao', 'olheiras', 'poros',
      'acne', 'simetria', 'uniformidade_tom', 'textura', 'firmeza', 'elasticidade',
    ];
    for (const metric of required) {
      expect(METRIC_COLORS[metric]).toBeDefined();
    }
  });
});
