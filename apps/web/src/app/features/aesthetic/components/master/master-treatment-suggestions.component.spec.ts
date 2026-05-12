import '@angular/compiler';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import { MasterTreatmentSuggestionsComponent } from './master-treatment-suggestions.component';
import { AestheticMasterService } from '../../services/aesthetic-master.service';
import type {
  AestheticTreatmentSuggestion,
  SuggestionRun,
  AestheticTreatment,
} from '../../services/aesthetic-master.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSuggestion(
  overrides: Partial<AestheticTreatmentSuggestion> = {}
): AestheticTreatmentSuggestion {
  return {
    id: 'sug-001',
    name: 'Radiofrequência Facial IA',
    category: 'facial_rejuvenescimento',
    indications: ['flacidez', 'envelhecimento'],
    contraindications: ['gravidez'],
    typical_sessions: 6,
    interval_days: 7,
    cost_estimate_brl_min: 200,
    cost_estimate_brl_max: 600,
    evidence_level: 'B',
    description: 'Tratamento gerado por IA',
    protocol_notes: null,
    sources: null,
    status: 'pending_review',
    rejected_reason: null,
    reviewed_by: null,
    reviewed_by_email: null,
    reviewed_at: null,
    promoted_treatment_id: null,
    source_run_id: 'run-abc-def-123',
    generation_model: 'gpt-4o',
    generated_at: '2026-05-01T10:00:00Z',
    ...overrides,
  };
}

function makeRun(overrides: Partial<SuggestionRun> = {}): SuggestionRun {
  return {
    source_run_id: 'run-abc-def-123',
    started_at: '2026-05-01T09:00:00Z',
    generation_model: 'gpt-4o',
    total: 10,
    pending: 5,
    approved: 3,
    rejected: 1,
    superseded: 1,
    ...overrides,
  };
}

function makeApprovedTreatment(): AestheticTreatment {
  return {
    id: 'treat-001',
    tenant_id: null,
    name: 'Radiofrequência Facial IA',
    category: 'facial_rejuvenescimento',
    indications: [],
    contraindications: [],
    typical_sessions: 6,
    interval_days: 7,
    cost_estimate_brl_min: 200,
    cost_estimate_brl_max: 600,
    evidence_level: 'B',
    description: null,
    protocol_notes: null,
    requires_medico: false,
    is_active: true,
    usage_count_30d: 0,
    created_at: '2026-05-01T10:00:00Z',
    updated_at: '2026-05-01T10:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

const mockSvc = {
  listSuggestions: jest.fn(),
  listRuns: jest.fn(),
  approveSuggestion: jest.fn(),
  rejectSuggestion: jest.fn(),
  supersedeSuggestion: jest.fn(),
};

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('MasterTreatmentSuggestionsComponent', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: listSuggestions returns one pending suggestion
    mockSvc.listSuggestions.mockReturnValue(of({ items: [makeSuggestion()] }));
    mockSvc.listRuns.mockReturnValue(of({ items: [makeRun()] }));

    await TestBed.configureTestingModule({
      imports: [MasterTreatmentSuggestionsComponent, NoopAnimationsModule, RouterTestingModule],
      providers: [
        { provide: AestheticMasterService, useValue: mockSvc },
      ],
    }).compileComponents();
  });

  // -------------------------------------------------------------------------
  // Test 1: Loads suggestions on init (tab=queue, status=pending_review)
  // -------------------------------------------------------------------------
  it('carrega sugestões no ngOnInit com tab=queue e status=pending_review', fakeAsync(() => {
    const fixture = TestBed.createComponent(MasterTreatmentSuggestionsComponent);
    fixture.detectChanges();

    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(mockSvc.listSuggestions).toHaveBeenCalledTimes(1);
    expect(mockSvc.listSuggestions).toHaveBeenCalledWith({ status: 'pending_review' });
    expect(comp.tab()).toBe('queue');
    expect(comp.filterStatus()).toBe('pending_review');
    expect(comp.suggestions().length).toBe(1);
    expect(comp.suggestions()[0].name).toBe('Radiofrequência Facial IA');
    expect(comp.loading()).toBe(false);
  }));

  // -------------------------------------------------------------------------
  // Test 2: Reject modal opens, submit calls rejectSuggestion and reloads
  // -------------------------------------------------------------------------
  it('click Rejeitar abre modal, submit chama service.rejectSuggestion e recarrega', fakeAsync(() => {
    const suggestion = makeSuggestion();
    const rejectedSuggestion = makeSuggestion({ status: 'rejected', rejected_reason: 'Não validado clinicamente' });
    mockSvc.rejectSuggestion.mockReturnValue(
      of({ id: suggestion.id, status: 'rejected', rejected_reason: 'Não validado clinicamente' })
    );
    mockSvc.listSuggestions
      .mockReturnValueOnce(of({ items: [suggestion] }))
      .mockReturnValueOnce(of({ items: [rejectedSuggestion] }));

    const fixture = TestBed.createComponent(MasterTreatmentSuggestionsComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;

    // Open reject modal
    comp.openReject(suggestion);
    fixture.detectChanges();

    expect(comp.rejectModal()).toBe(true);
    expect(comp.rejectTarget()?.id).toBe(suggestion.id);

    // Verify modal is in DOM
    const modal = fixture.nativeElement.querySelector('.modal-overlay');
    expect(modal).not.toBeNull();

    // Fill reason and submit
    comp.rejectReason = 'Não validado clinicamente';
    fixture.detectChanges();

    comp.submitReject();
    tick();
    fixture.detectChanges();

    expect(mockSvc.rejectSuggestion).toHaveBeenCalledTimes(1);
    expect(mockSvc.rejectSuggestion).toHaveBeenCalledWith(suggestion.id, 'Não validado clinicamente');
    // Modal closed
    expect(comp.rejectModal()).toBe(false);
    // List reloaded
    expect(mockSvc.listSuggestions).toHaveBeenCalledTimes(2);
    expect(comp.suggestions()[0].status).toBe('rejected');
  }));

  // -------------------------------------------------------------------------
  // Test 3: Approve modal opens, submit calls approveSuggestion and reloads
  // -------------------------------------------------------------------------
  it('click Aprovar abre modal, submit chama service.approveSuggestion e recarrega', fakeAsync(() => {
    const suggestion = makeSuggestion();
    const approvedSuggestion = makeSuggestion({ status: 'approved', promoted_treatment_id: 'treat-001' });
    mockSvc.approveSuggestion.mockReturnValue(
      of({ treatment: makeApprovedTreatment(), suggestion_id: suggestion.id })
    );
    mockSvc.listSuggestions
      .mockReturnValueOnce(of({ items: [suggestion] }))
      .mockReturnValueOnce(of({ items: [approvedSuggestion] }));

    const fixture = TestBed.createComponent(MasterTreatmentSuggestionsComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;

    // Open approve modal
    comp.openApprove(suggestion);
    fixture.detectChanges();

    expect(comp.approveModal()).toBe(true);
    expect(comp.approveTarget()?.id).toBe(suggestion.id);
    // Form pre-populated
    expect(comp.approveForm.name).toBe(suggestion.name);
    expect(comp.approveForm.category).toBe(suggestion.category);

    // Submit
    comp.submitApprove();
    tick();
    fixture.detectChanges();

    expect(mockSvc.approveSuggestion).toHaveBeenCalledTimes(1);
    expect(mockSvc.approveSuggestion).toHaveBeenCalledWith(
      suggestion.id,
      expect.objectContaining({ name: suggestion.name, category: suggestion.category })
    );
    // Modal closed
    expect(comp.approveModal()).toBe(false);
    // List reloaded
    expect(mockSvc.listSuggestions).toHaveBeenCalledTimes(2);
    expect(comp.suggestions()[0].status).toBe('approved');
  }));

  // -------------------------------------------------------------------------
  // Test 4: Tab "Histórico" loads runs via listRuns
  // -------------------------------------------------------------------------
  it('tab Histórico carrega execuções via listRuns', fakeAsync(() => {
    const fixture = TestBed.createComponent(MasterTreatmentSuggestionsComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.tab()).toBe('queue');

    // Switch to history tab
    comp.setTab('history');
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    expect(comp.tab()).toBe('history');
    expect(mockSvc.listRuns).toHaveBeenCalledTimes(1);
    expect(comp.runs().length).toBe(1);
    expect(comp.runs()[0].source_run_id).toBe('run-abc-def-123');
    expect(comp.runs()[0].total).toBe(10);
  }));

  // -------------------------------------------------------------------------
  // Test 5: Submit reject without reason shows local error, does NOT call API
  // -------------------------------------------------------------------------
  it('submitReject sem reason mostra erro local e não chama service.rejectSuggestion', fakeAsync(() => {
    const fixture = TestBed.createComponent(MasterTreatmentSuggestionsComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;

    // Open reject modal
    comp.openReject(makeSuggestion());
    fixture.detectChanges();

    // Leave reason empty
    comp.rejectReason = '';
    fixture.detectChanges();

    comp.submitReject();
    fixture.detectChanges();

    // Should NOT have called the service
    expect(mockSvc.rejectSuggestion).not.toHaveBeenCalled();
    // submitAttempted flag should be set (drives the inline error)
    expect(comp.rejectSubmitAttempted()).toBe(true);
    // Modal should still be open
    expect(comp.rejectModal()).toBe(true);

    // Verify the inline error message appears in DOM
    const errorEl = fixture.nativeElement.querySelector('.field-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain('obrigatório');
  }));

  // -------------------------------------------------------------------------
  // Test 6: Error on listSuggestions shows errorMsg
  // -------------------------------------------------------------------------
  it('exibe mensagem de erro quando service.listSuggestions falha', fakeAsync(() => {
    mockSvc.listSuggestions.mockReturnValue(
      throwError(() => ({ error: { error: 'Não autorizado' } }))
    );

    const fixture = TestBed.createComponent(MasterTreatmentSuggestionsComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.errorMsg()).toBe('Não autorizado');
    expect(comp.suggestions().length).toBe(0);
    expect(comp.loading()).toBe(false);
  }));
});
