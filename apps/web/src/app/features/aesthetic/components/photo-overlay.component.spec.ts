import '@angular/compiler';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { PhotoOverlayComponent } from './photo-overlay.component';
import { PhotoOverlayService } from '../services/photo-overlay.service';
import { Metrics } from '../models/analysis.model';

// ---------------------------------------------------------------------------
// Mock PhotoOverlayService
// ---------------------------------------------------------------------------

const mockOverlayService = {
  colorForMetric: jest.fn((key: string) => {
    const map: Record<string, string> = {
      rugas: '#60a5fa',
      manchas: '#fb923c',
    };
    return map[key] ?? '#94a3b8';
  }),
  scalePoints: jest.fn((points: [number, number][], W: number, H: number) => {
    return points.map(([nx, ny]) => `${Math.round(nx * W)},${Math.round(ny * H)}`).join(' ');
  }),
};

// ---------------------------------------------------------------------------
// Test metrics fixture
// ---------------------------------------------------------------------------

const TEST_METRICS: Metrics = {
  rugas: {
    score: 3,
    confidence: 'high',
    regions: [
      { type: 'bbox', x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
    ],
  },
  manchas: {
    score: 2,
    confidence: 'medium',
    regions: [
      {
        type: 'polyline',
        points: [{ x: 0.0, y: 0.0 }, { x: 0.5, y: 1.0 }],
      },
    ],
  },
  simetria: {
    score: 4,
    confidence: 'low',
    regions: [
      { type: 'line', x1: 0.1, y1: 0.0, x2: 0.9, y2: 1.0 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Helper: trigger img load
// ---------------------------------------------------------------------------

function triggerImgLoad(fixture: ComponentFixture<PhotoOverlayComponent>): void {
  const img: HTMLImageElement | null = fixture.nativeElement.querySelector('img');
  if (img) {
    // set natural dimensions via Object.defineProperty (jsdom doesn't load images)
    Object.defineProperty(img, 'naturalWidth', { value: 1000, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 500, configurable: true });
    img.dispatchEvent(new Event('load'));
  }
  fixture.detectChanges();
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('PhotoOverlayComponent', () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [PhotoOverlayComponent],
      providers: [
        { provide: PhotoOverlayService, useValue: mockOverlayService },
      ],
    }).compileComponents();
  });

  // -------------------------------------------------------------------------
  // Test 1: renders <rect> with correct scaled attributes for bbox region
  // -------------------------------------------------------------------------
  it('renderiza <rect> com atributos escalados para região bbox', () => {
    const fixture = TestBed.createComponent(PhotoOverlayComponent);
    const comp = fixture.componentInstance;

    fixture.componentRef.setInput('photoUrl', 'photo.jpg');
    fixture.componentRef.setInput('metrics', { rugas: TEST_METRICS['rugas'] });
    fixture.componentRef.setInput('activeLayers', ['rugas']);
    fixture.detectChanges();

    triggerImgLoad(fixture);

    const rect: SVGRectElement | null = fixture.nativeElement.querySelector('rect');
    expect(rect).not.toBeNull();

    // bbox: x=0.1, y=0.2, w=0.5, h=0.4 on 1000×500
    expect(Number(rect!.getAttribute('x'))).toBeCloseTo(100, 0);
    expect(Number(rect!.getAttribute('y'))).toBeCloseTo(100, 0);
    expect(Number(rect!.getAttribute('width'))).toBeCloseTo(500, 0);
    expect(Number(rect!.getAttribute('height'))).toBeCloseTo(200, 0);
  });

  // -------------------------------------------------------------------------
  // Test 2: renders <polyline> with points string
  // -------------------------------------------------------------------------
  it('renderiza <polyline> com string de points para região polyline', () => {
    const fixture = TestBed.createComponent(PhotoOverlayComponent);

    fixture.componentRef.setInput('photoUrl', 'photo.jpg');
    fixture.componentRef.setInput('metrics', { manchas: TEST_METRICS['manchas'] });
    fixture.componentRef.setInput('activeLayers', ['manchas']);
    fixture.detectChanges();

    triggerImgLoad(fixture);

    const polyline: SVGPolylineElement | null = fixture.nativeElement.querySelector('polyline');
    expect(polyline).not.toBeNull();
    expect(mockOverlayService.scalePoints).toHaveBeenCalled();
    const pointsAttr = polyline!.getAttribute('points') ?? '';
    expect(pointsAttr.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: layer NOT in activeLayers does NOT appear in DOM
  // -------------------------------------------------------------------------
  it('layer fora de activeLayers não aparece no DOM', () => {
    const fixture = TestBed.createComponent(PhotoOverlayComponent);

    fixture.componentRef.setInput('photoUrl', 'photo.jpg');
    fixture.componentRef.setInput('metrics', TEST_METRICS);
    fixture.componentRef.setInput('activeLayers', ['rugas']); // only rugas
    fixture.detectChanges();

    triggerImgLoad(fixture);

    // Should have one <g> for rugas only
    const groups: NodeListOf<SVGGElement> = fixture.nativeElement.querySelectorAll('g[data-metric]');
    expect(groups.length).toBe(1);
    expect(groups[0].getAttribute('data-metric')).toBe('rugas');
  });

  // -------------------------------------------------------------------------
  // Test 4: opacity input is applied to SVG <g> elements
  // -------------------------------------------------------------------------
  it('propriedade opacity é aplicada nos grupos SVG', () => {
    const fixture = TestBed.createComponent(PhotoOverlayComponent);

    fixture.componentRef.setInput('photoUrl', 'photo.jpg');
    fixture.componentRef.setInput('metrics', { rugas: TEST_METRICS['rugas'] });
    fixture.componentRef.setInput('activeLayers', ['rugas']);
    fixture.componentRef.setInput('opacity', 0.7);
    fixture.detectChanges();

    triggerImgLoad(fixture);

    // V2 Fase 2: opacity agora é aplicada no <g> INTERNO (por region)
    // em vez do <g data-metric> externo (que mantém apenas fill/stroke).
    // Permite severity por região modular opacity individual.
    const layerGroup: SVGGElement | null = fixture.nativeElement.querySelector('g[data-metric]');
    expect(layerGroup).not.toBeNull();
    const regionGroup: SVGGElement | null = layerGroup!.querySelector('g[opacity]');
    expect(regionGroup).not.toBeNull();
    expect(regionGroup!.getAttribute('opacity')).toBe('0.7');
  });

  // -------------------------------------------------------------------------
  // V2 Fase 2: severity-based opacity (per region)
  // -------------------------------------------------------------------------
  it('V2-F2: region.severity sobrescreve opacity global proporcional', () => {
    const fixture = TestBed.createComponent(PhotoOverlayComponent);
    fixture.componentRef.setInput('photoUrl', 'photo.jpg');
    fixture.componentRef.setInput('metrics', {
      rugas: {
        score: 70, confidence: 'high',
        regions: [
          { type: 'bbox', x: 0.1, y: 0.1, width: 0.2, height: 0.2, severity: 80 },
          { type: 'bbox', x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, // sem severity
        ],
      },
    });
    fixture.componentRef.setInput('activeLayers', ['rugas']);
    fixture.componentRef.setInput('opacity', 0.4);
    fixture.detectChanges();
    triggerImgLoad(fixture);

    const groups = fixture.nativeElement.querySelectorAll('g[data-metric] > g[opacity]');
    expect(groups.length).toBe(2);
    // 1ª region: severity 80 → opacity 0.8
    expect(groups[0].getAttribute('opacity')).toBe('0.8');
    // 2ª region: sem severity → fallback pra opacity global (0.4)
    expect(groups[1].getAttribute('opacity')).toBe('0.4');
  });

  it('V2-F2: severityOpacity helper clamp 0.2..0.9', () => {
    const fixture = TestBed.createComponent(PhotoOverlayComponent);
    const comp = fixture.componentInstance;
    expect(comp.severityOpacity({ type: 'bbox', x:0, y:0, width:1, height:1 } as any)).toBeNull();
    expect(comp.severityOpacity({ type: 'bbox', x:0, y:0, width:1, height:1, severity: 0 } as any)).toBe(0.2);
    expect(comp.severityOpacity({ type: 'bbox', x:0, y:0, width:1, height:1, severity: 100 } as any)).toBe(0.9);
    expect(comp.severityOpacity({ type: 'bbox', x:0, y:0, width:1, height:1, severity: 50 } as any)).toBe(0.5);
    expect(comp.severityOpacity({ type: 'bbox', x:0, y:0, width:1, height:1, severity: 80 } as any)).toBe(0.8);
  });
});
