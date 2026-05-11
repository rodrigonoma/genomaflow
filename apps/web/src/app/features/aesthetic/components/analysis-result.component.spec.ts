/**
 * AnalysisResultComponent — unit tests
 *
 * Testa:
 *  1. Só renderiza sections que existem no payload (sem observações → sem section)
 *  2. Score geral calculado corretamente (média dos scores)
 *  3. Disclaimer obrigatório sempre visível
 *  4. Badge "Em breve catálogo" aparece quando in_catalog === false
 *  5. Botão Comparar emite event com analysis.id
 *
 * PhotoOverlayComponent e LayerToolbarComponent são substituídos por NO_ERRORS_SCHEMA
 * para não precisar montar toda a cadeia de dependências SVG.
 */
import '@angular/compiler';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { AnalysisResultComponent } from './analysis-result.component';
import { PhotoOverlayService } from '../services/photo-overlay.service';
import { AestheticAnalysisDetail } from '../models/analysis.model';

// ---------------------------------------------------------------------------
// Mock PhotoOverlayService
// ---------------------------------------------------------------------------

const mockOverlayService = {
  colorForMetric: jest.fn((key: string) => '#94a3b8'),
};

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAnalysis(overrides: Partial<AestheticAnalysisDetail> = {}): AestheticAnalysisDetail {
  return {
    id: 'analysis-001',
    tenant_id: 'tenant-001',
    subject_id: 'subject-001',
    user_id: 'user-001',
    analysis_type: 'facial',
    photo_ids: ['photo-001', 'photo-002'],
    status: 'done',
    model_metrics: null,
    model_recommendations: null,
    tokens_input: 1200,
    tokens_output: 800,
    error_code: null,
    error_message: null,
    baseline_analysis_id: null,
    credits_charged: 5,
    credits_refunded: false,
    deleted_at: null,
    created_at: '2026-05-11T10:00:00.000Z',
    completed_at: '2026-05-11T10:01:30.000Z',
    metrics: {
      rugas: { score: 70, confidence: 'high', regions: [{ type: 'bbox', x: 0.1, y: 0.2, width: 0.3, height: 0.1 }] },
      manchas: { score: 50, confidence: 'medium', regions: [] },
      simetria: { score: 80, confidence: 'low', regions: [] },
    },
    observations: {
      qualitative: 'Pele com sinais de fotoenvelhecimento leve na região periorbital.',
    },
    recommendations: {
      treatment_protocol: [
        {
          treatment_name: 'Peeling Químico Superficial',
          indication_text: 'Indicado para manchas e textura irregular.',
          sessions_recommended: 4,
          interval_days: 21,
          urgency: 'medium',
          expected_outcome: 'Melhora de até 40% na uniformidade do tom.',
          in_catalog: false,
        },
        {
          treatment_name: 'Hidratação Profunda',
          indication_text: 'Indicado para pele ressecada.',
          sessions_recommended: 2,
          interval_days: 14,
          urgency: 'low',
          expected_outcome: 'Melhora na hidratação cutânea.',
          in_catalog: true,
        },
      ],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFixture(analysis: AestheticAnalysisDetail): ComponentFixture<AnalysisResultComponent> {
  const fixture = TestBed.createComponent(AnalysisResultComponent);
  const comp = fixture.componentInstance;
  comp.analysis = analysis;
  comp.photoUrls = signal({ 'photo-001': 'https://cdn.example.com/photo-001.jpg' });
  fixture.detectChanges();
  return fixture;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnalysisResultComponent', () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [AnalysisResultComponent],
      providers: [
        { provide: PhotoOverlayService, useValue: mockOverlayService },
      ],
      schemas: [NO_ERRORS_SCHEMA],  // ignora app-photo-overlay e app-layer-toolbar
    }).compileComponents();
  });

  // -------------------------------------------------------------------------
  // Test 1: Só renderiza sections que existem no payload
  // -------------------------------------------------------------------------
  it('não renderiza section de observações quando observations é null', () => {
    const analysis = makeAnalysis({ observations: null });
    const fixture = createFixture(analysis);
    const el: HTMLElement = fixture.nativeElement;

    const observationsSection = el.querySelector('.observations');
    expect(observationsSection).toBeNull();
  });

  it('não renderiza section de tratamentos quando recommendations é null', () => {
    const analysis = makeAnalysis({ recommendations: null });
    const fixture = createFixture(analysis);
    const el: HTMLElement = fixture.nativeElement;

    const treatmentsSection = el.querySelector('.treatments');
    expect(treatmentsSection).toBeNull();
  });

  it('não renderiza section de lifestyle quando não há lifestyle_recommendations', () => {
    const analysis = makeAnalysis({
      recommendations: {
        treatment_protocol: [],
        lifestyle_recommendations: null,
      },
    });
    const fixture = createFixture(analysis);
    const el: HTMLElement = fixture.nativeElement;

    const lifestyleSection = el.querySelector('.lifestyle');
    expect(lifestyleSection).toBeNull();
  });

  it('renderiza section de observações quando observations.qualitative está presente', () => {
    const analysis = makeAnalysis();
    const fixture = createFixture(analysis);
    const el: HTMLElement = fixture.nativeElement;

    const observationsSection = el.querySelector('.observations');
    expect(observationsSection).not.toBeNull();
    expect(observationsSection!.textContent).toContain('Pele com sinais de fotoenvelhecimento');
  });

  // -------------------------------------------------------------------------
  // Test 2: Score geral calculado corretamente (média dos scores)
  // -------------------------------------------------------------------------
  it('calcula overallScore como média aritmética arredondada dos scores das métricas', () => {
    // scores: 70, 50, 80 → média = 200/3 = 66.666 → arredondado = 67
    const analysis = makeAnalysis();
    const fixture = createFixture(analysis);
    const comp = fixture.componentInstance;

    expect(comp.overallScore()).toBe(67);
  });

  it('renderiza o score geral no DOM', () => {
    const analysis = makeAnalysis();
    const fixture = createFixture(analysis);
    const el: HTMLElement = fixture.nativeElement;

    const scoreValue = el.querySelector('.score-value');
    expect(scoreValue).not.toBeNull();
    expect(scoreValue!.textContent?.trim()).toBe('67');
  });

  it('retorna null para overallScore quando metrics é null', () => {
    const analysis = makeAnalysis({ metrics: null });
    const fixture = createFixture(analysis);
    const comp = fixture.componentInstance;

    expect(comp.overallScore()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 3: Disclaimer obrigatório sempre visível
  // -------------------------------------------------------------------------
  it('disclaimer obrigatório está sempre visível no DOM', () => {
    const analysis = makeAnalysis();
    const fixture = createFixture(analysis);
    const el: HTMLElement = fixture.nativeElement;

    const disclaimer = el.querySelector('[data-testid="mandatory-disclaimer"]');
    expect(disclaimer).not.toBeNull();
    expect(disclaimer!.textContent).toContain('Análise gerada por IA');
    expect(disclaimer!.textContent).toContain('não substituem avaliação clínica presencial');
  });

  it('disclaimer está visível mesmo quando analysis não tem métricas nem recomendações', () => {
    const analysis = makeAnalysis({
      metrics: null,
      observations: null,
      recommendations: null,
    });
    const fixture = createFixture(analysis);
    const el: HTMLElement = fixture.nativeElement;

    const disclaimer = el.querySelector('[data-testid="mandatory-disclaimer"]');
    expect(disclaimer).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 4: Badge "Em breve catálogo" aparece quando in_catalog === false
  // -------------------------------------------------------------------------
  it('badge "Em breve catálogo" aparece para treatment com in_catalog === false', () => {
    const analysis = makeAnalysis();  // inclui peeling com in_catalog: false
    const fixture = createFixture(analysis);
    const el: HTMLElement = fixture.nativeElement;

    const catalogBadges = el.querySelectorAll('.badge-new');
    expect(catalogBadges.length).toBeGreaterThanOrEqual(1);
    expect(catalogBadges[0].textContent?.trim()).toContain('Em breve catálogo');
  });

  it('badge "Em breve catálogo" NÃO aparece quando in_catalog === true', () => {
    const analysis = makeAnalysis({
      recommendations: {
        treatment_protocol: [
          {
            treatment_name: 'Hidratação Profunda',
            indication_text: 'Indicado para pele ressecada.',
            sessions_recommended: 2,
            interval_days: 14,
            urgency: 'low',
            expected_outcome: 'Melhora na hidratação cutânea.',
            in_catalog: true,
          },
        ],
      },
    });
    const fixture = createFixture(analysis);
    const el: HTMLElement = fixture.nativeElement;

    const catalogBadges = el.querySelectorAll('.badge-new');
    expect(catalogBadges.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 5: Botão Comparar emite event com analysis.id
  // -------------------------------------------------------------------------
  it('botão "Comparar análises" emite compareRequested com analysis.id', () => {
    const analysis = makeAnalysis();
    const fixture = createFixture(analysis);
    const comp = fixture.componentInstance;
    const el: HTMLElement = fixture.nativeElement;

    const emittedValues: string[] = [];
    comp.compareRequested.subscribe((id: string) => emittedValues.push(id));

    const compareBtn: HTMLButtonElement | null = el.querySelector('.btn-compare');
    expect(compareBtn).not.toBeNull();
    compareBtn!.click();

    expect(emittedValues).toHaveLength(1);
    expect(emittedValues[0]).toBe('analysis-001');
  });

  // -------------------------------------------------------------------------
  // Extra: metricsList ordenada por chave
  // -------------------------------------------------------------------------
  it('metricsList retorna métricas ordenadas por chave (asc)', () => {
    const analysis = makeAnalysis();
    const fixture = createFixture(analysis);
    const comp = fixture.componentInstance;

    const keys = comp.metricsList().map(([k]) => k);
    // 'manchas', 'rugas', 'simetria'
    expect(keys).toEqual([...keys].sort());
  });

  // -------------------------------------------------------------------------
  // Extra: hasLowConfidence detecta confidence 'low'
  // -------------------------------------------------------------------------
  it('hasLowConfidence retorna true quando há métrica com confidence low', () => {
    const analysis = makeAnalysis();
    const fixture = createFixture(analysis);
    const comp = fixture.componentInstance;

    expect(comp.hasLowConfidence()).toBe(true);
  });

  it('hasLowConfidence retorna false quando não há métrica com confidence low', () => {
    const analysis = makeAnalysis({
      metrics: {
        rugas: { score: 70, confidence: 'high', regions: [] },
        manchas: { score: 50, confidence: 'medium', regions: [] },
      },
    });
    const fixture = createFixture(analysis);
    const comp = fixture.componentInstance;

    expect(comp.hasLowConfidence()).toBe(false);
  });
});
