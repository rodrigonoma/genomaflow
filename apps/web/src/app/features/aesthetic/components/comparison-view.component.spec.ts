/**
 * ComparisonViewComponent — unit tests
 *
 * Plan: docs/superpowers/plans/2026-05-11-aesthetic-f1-facial.md Task 23
 *
 * Testa:
 *  1. Dropdown change dispara compareAnalyses no service
 *  2. Tabela mostra deltas corretos do comparison signal
 *  3. Color coding: positivo verde, negativo vermelho
 */
import '@angular/compiler';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { ComparisonViewComponent } from './comparison-view.component';
import { AestheticFacialService } from '../services/aesthetic-facial.service';
import { AestheticAnalysisDetail, AestheticAnalysisListItem, CompareResult } from '../models/analysis.model';

// ---------------------------------------------------------------------------
// Mock data helpers
// ---------------------------------------------------------------------------

function makeBaseline(id: string): AestheticAnalysisListItem {
  return {
    id,
    tenant_id: 'tenant-001',
    subject_id: 'subject-001',
    user_id: 'user-001',
    analysis_type: 'facial',
    photo_ids: [],
    status: 'done',
    model_metrics: null,
    model_recommendations: null,
    tokens_input: null,
    tokens_output: null,
    error_code: null,
    error_message: null,
    baseline_analysis_id: null,
    credits_charged: 5,
    credits_refunded: false,
    deleted_at: null,
    created_at: '2026-05-01T10:00:00.000Z',
    completed_at: '2026-05-01T10:01:00.000Z',
  };
}

function makeDetail(id: string): AestheticAnalysisDetail {
  return {
    ...makeBaseline(id),
    metrics: null,
    observations: null,
    recommendations: null,
  };
}

const mockCompareResult: CompareResult = {
  baseline_id: 'baseline-001',
  current_id: 'current-001',
  deltas: {
    rugas: 15,
    manchas: -5,
    simetria: 8,
  },
  overall_change: 18,
};

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

const mockService = {
  compareAnalyses: jest.fn(),
  getAnalysis: jest.fn(),
  getPhotoUrl: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComparisonViewComponent', () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [ComparisonViewComponent],
      providers: [
        { provide: AestheticFacialService, useValue: mockService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  // -------------------------------------------------------------------------
  // Test 1: Dropdown change dispara compareAnalyses no service
  // -------------------------------------------------------------------------
  it('ao selecionar baseline, chama compareAnalyses com os ids corretos', async () => {
    mockService.compareAnalyses.mockReturnValue(of(mockCompareResult));
    mockService.getAnalysis.mockReturnValue(of(makeDetail('any')));
    mockService.getPhotoUrl.mockReturnValue(of({ url: '', expires_at: '' }));

    const baselines = [makeBaseline('baseline-001'), makeBaseline('baseline-002')];

    const fixture: ComponentFixture<ComparisonViewComponent> = TestBed.createComponent(ComparisonViewComponent);
    fixture.componentRef.setInput('currentAnalysisId', 'current-001');
    fixture.componentRef.setInput('availableBaselines', baselines);
    fixture.detectChanges();
    await fixture.whenStable();

    // Simulate selecting a baseline via the component method
    fixture.componentInstance.onBaselineChange('baseline-001');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockService.compareAnalyses).toHaveBeenCalledWith('current-001', 'baseline-001');
  });

  // -------------------------------------------------------------------------
  // Test 2: Tabela mostra deltas corretos do comparison signal
  // -------------------------------------------------------------------------
  it('tabela exibe as linhas de delta após comparação', async () => {
    mockService.compareAnalyses.mockReturnValue(of(mockCompareResult));
    mockService.getAnalysis.mockReturnValue(of(makeDetail('any')));
    mockService.getPhotoUrl.mockReturnValue(of({ url: '', expires_at: '' }));

    const baselines = [makeBaseline('baseline-001')];

    const fixture: ComponentFixture<ComparisonViewComponent> = TestBed.createComponent(ComparisonViewComponent);
    fixture.componentRef.setInput('currentAnalysisId', 'current-001');
    fixture.componentRef.setInput('availableBaselines', baselines);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.onBaselineChange('baseline-001');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const deltaRows = el.querySelectorAll('[data-testid="delta-row"]');
    // rugas, manchas, simetria = 3 rows
    expect(deltaRows.length).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Test 3: Color coding: positivo verde, negativo vermelho
  // -------------------------------------------------------------------------
  it('delta positivo recebe classe delta-positive (verde), negativo recebe delta-negative (vermelho)', async () => {
    mockService.compareAnalyses.mockReturnValue(of(mockCompareResult));
    mockService.getAnalysis.mockReturnValue(of(makeDetail('any')));
    mockService.getPhotoUrl.mockReturnValue(of({ url: '', expires_at: '' }));

    const baselines = [makeBaseline('baseline-001')];

    const fixture: ComponentFixture<ComparisonViewComponent> = TestBed.createComponent(ComparisonViewComponent);
    fixture.componentRef.setInput('currentAnalysisId', 'current-001');
    fixture.componentRef.setInput('availableBaselines', baselines);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.onBaselineChange('baseline-001');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const positiveCells = el.querySelectorAll('.delta-positive');
    const negativeCells = el.querySelectorAll('.delta-negative');

    // rugas (+15) e simetria (+8) = 2 positivos, manchas (-5) = 1 negativo
    expect(positiveCells.length).toBeGreaterThanOrEqual(2);
    expect(negativeCells.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Test 4: toggleBaselineOverlay alterna o signal showBaselineOverlay
  // -------------------------------------------------------------------------
  it('toggleBaselineOverlay alterna showBaselineOverlay signal', () => {
    const fixture: ComponentFixture<ComparisonViewComponent> = TestBed.createComponent(ComparisonViewComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.showBaselineOverlay()).toBe(true);
    component.toggleBaselineOverlay();
    expect(component.showBaselineOverlay()).toBe(false);
  });
});
