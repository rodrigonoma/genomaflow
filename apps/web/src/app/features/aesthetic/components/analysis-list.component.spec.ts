/**
 * AnalysisListComponent — unit tests
 *
 * Plan: docs/superpowers/plans/2026-05-11-aesthetic-f1-facial.md Task 22
 *
 * Testa:
 *  1. Renderiza items após carregamento
 *  2. Click em row emite analysisSelected com o id do item
 *  3. Empty state quando array vazio
 */
import '@angular/compiler';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AnalysisListComponent } from './analysis-list.component';
import { AestheticFacialService } from '../services/aesthetic-facial.service';
import { AestheticAnalysisListItem } from '../models/analysis.model';

// ---------------------------------------------------------------------------
// Mock data helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<AestheticAnalysisListItem> = {}): AestheticAnalysisListItem {
  return {
    id: 'analysis-001',
    tenant_id: 'tenant-001',
    subject_id: 'subject-001',
    user_id: 'user-001',
    analysis_type: 'facial',
    photo_ids: ['photo-001'],
    status: 'done',
    model_metrics: null,
    model_recommendations: null,
    tokens_input: 500,
    tokens_output: 300,
    error_code: null,
    error_message: null,
    baseline_analysis_id: null,
    credits_charged: 5,
    credits_refunded: false,
    deleted_at: null,
    created_at: '2026-05-11T10:00:00.000Z',
    completed_at: '2026-05-11T10:01:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

const mockService = {
  listAnalyses: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnalysisListComponent', () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [AnalysisListComponent],
      providers: [
        { provide: AestheticFacialService, useValue: mockService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  // -------------------------------------------------------------------------
  // Test 1: Renderiza items após carregamento
  // -------------------------------------------------------------------------
  it('renderiza items na tabela após carregamento', async () => {
    const items: AestheticAnalysisListItem[] = [
      makeItem({ id: 'a-001', analysis_type: 'facial', status: 'done', credits_charged: 5 }),
      makeItem({ id: 'a-002', analysis_type: 'eyelids', status: 'pending', credits_charged: 3 }),
    ];
    mockService.listAnalyses.mockReturnValue(of({ items }));

    const fixture: ComponentFixture<AnalysisListComponent> = TestBed.createComponent(AnalysisListComponent);
    fixture.componentRef.setInput('subjectId', 'subject-001');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const rows = el.querySelectorAll('[data-testid="analysis-row"]');
    expect(rows.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Test 2: Click em row emite analysisSelected com o id do item
  // -------------------------------------------------------------------------
  it('click em row emite analysisSelected com o id correto', async () => {
    const items: AestheticAnalysisListItem[] = [
      makeItem({ id: 'a-001' }),
      makeItem({ id: 'a-002' }),
    ];
    mockService.listAnalyses.mockReturnValue(of({ items }));

    const fixture: ComponentFixture<AnalysisListComponent> = TestBed.createComponent(AnalysisListComponent);
    fixture.componentRef.setInput('subjectId', 'subject-001');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const emitted: string[] = [];
    fixture.componentInstance.analysisSelected.subscribe((id: string) => emitted.push(id));

    const el: HTMLElement = fixture.nativeElement;
    const firstRow = el.querySelector('[data-testid="analysis-row"]') as HTMLElement;
    expect(firstRow).not.toBeNull();
    firstRow.click();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toBe('a-001');
  });

  // -------------------------------------------------------------------------
  // Test 3: Empty state quando array vazio
  // -------------------------------------------------------------------------
  it('exibe empty state quando a lista está vazia', async () => {
    mockService.listAnalyses.mockReturnValue(of({ items: [] }));

    const fixture: ComponentFixture<AnalysisListComponent> = TestBed.createComponent(AnalysisListComponent);
    fixture.componentRef.setInput('subjectId', 'subject-001');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const emptyState = el.querySelector('[data-testid="empty-state"]');
    expect(emptyState).not.toBeNull();

    const rows = el.querySelectorAll('[data-testid="analysis-row"]');
    expect(rows.length).toBe(0);
  });
});
