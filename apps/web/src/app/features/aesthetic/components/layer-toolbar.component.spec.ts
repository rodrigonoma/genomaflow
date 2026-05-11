import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { LayerToolbarComponent } from './layer-toolbar.component';
import { PhotoOverlayService } from '../services/photo-overlay.service';

// ---------------------------------------------------------------------------
// Mock PhotoOverlayService
// ---------------------------------------------------------------------------

const mockOverlayService = {
  colorForMetric: jest.fn((key: string) => '#60a5fa'),
};

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('LayerToolbarComponent', () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [LayerToolbarComponent],
      providers: [
        { provide: PhotoOverlayService, useValue: mockOverlayService },
      ],
    }).compileComponents();
  });

  // -------------------------------------------------------------------------
  // Test 1: toggle adds/removes a metric key from activeLayers
  // -------------------------------------------------------------------------
  it('toggle adiciona e remove metric de activeLayers', () => {
    const fixture = TestBed.createComponent(LayerToolbarComponent);
    const comp = fixture.componentInstance;

    fixture.componentRef.setInput('availableMetrics', [
      { key: 'rugas', count: 3 },
      { key: 'manchas', count: 2 },
    ]);
    fixture.componentRef.setInput('activeLayers', []);
    fixture.detectChanges();

    // Toggle rugas on
    comp.toggle('rugas');
    expect(comp.activeLayers()).toContain('rugas');

    // Toggle rugas off
    comp.toggle('rugas');
    expect(comp.activeLayers()).not.toContain('rugas');
  });

  // -------------------------------------------------------------------------
  // Test 2: showAll selects all available metrics
  // -------------------------------------------------------------------------
  it('showAll seleciona todas as métricas disponíveis', () => {
    const fixture = TestBed.createComponent(LayerToolbarComponent);
    const comp = fixture.componentInstance;

    fixture.componentRef.setInput('availableMetrics', [
      { key: 'rugas', count: 3 },
      { key: 'manchas', count: 2 },
      { key: 'acne', count: 1 },
    ]);
    fixture.componentRef.setInput('activeLayers', []);
    fixture.detectChanges();

    comp.showAll();

    expect(comp.activeLayers()).toEqual(['rugas', 'manchas', 'acne']);
  });

  // -------------------------------------------------------------------------
  // Test 3: hideAll clears activeLayers
  // -------------------------------------------------------------------------
  it('hideAll limpa todas as camadas ativas', () => {
    const fixture = TestBed.createComponent(LayerToolbarComponent);
    const comp = fixture.componentInstance;

    fixture.componentRef.setInput('availableMetrics', [
      { key: 'rugas', count: 3 },
      { key: 'manchas', count: 2 },
    ]);
    fixture.componentRef.setInput('activeLayers', ['rugas', 'manchas']);
    fixture.detectChanges();

    comp.hideAll();

    expect(comp.activeLayers()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Test 4: setOpacity updates opacity model (clamped to 0-1)
  // -------------------------------------------------------------------------
  it('setOpacity atualiza opacity model com clamp 0-1', () => {
    const fixture = TestBed.createComponent(LayerToolbarComponent);
    const comp = fixture.componentInstance;

    fixture.componentRef.setInput('availableMetrics', []);
    fixture.componentRef.setInput('activeLayers', []);
    fixture.componentRef.setInput('opacity', 0.4);
    fixture.detectChanges();

    comp.setOpacity(0.75);
    expect(comp.opacity()).toBeCloseTo(0.75);

    // Clamp above 1
    comp.setOpacity(1.5);
    expect(comp.opacity()).toBe(1);

    // Clamp below 0
    comp.setOpacity(-0.1);
    expect(comp.opacity()).toBe(0);
  });
});
