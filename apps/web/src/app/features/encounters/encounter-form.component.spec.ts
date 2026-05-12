'use strict';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { EncounterFormComponent } from './encounter-form.component';

describe('EncounterFormComponent — F6.7 vínculo análise estética', () => {
  let fixture: ComponentFixture<EncounterFormComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EncounterFormComponent, HttpClientTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(EncounterFormComponent);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  test('estetica module — ngOnInit dispara GET /aesthetic/analyses com subject_id', () => {
    fixture.componentInstance.module = 'estetica';
    fixture.componentInstance.subjectId = 'subj-001';
    fixture.detectChanges(); // triggers ngOnInit

    const req = httpMock.expectOne((r) => /aesthetic\/analyses/.test(r.url));
    expect(req.request.params.get('subject_id')).toBe('subj-001');
    expect(req.request.params.get('limit')).toBe('20');

    req.flush({
      items: [
        {
          id: 'aa1',
          analysis_type: 'facial',
          status: 'done',
          created_at: '2026-05-11T10:00:00Z',
          completed_at: '2026-05-11T10:05:00Z',
          tenant_id: 't1',
          subject_id: 'subj-001',
          user_id: 'u1',
          photo_ids: [],
          model_metrics: null,
          model_recommendations: null,
          tokens_input: null,
          tokens_output: null,
          error_code: null,
          error_message: null,
          baseline_analysis_id: null,
          credits_charged: 1,
          credits_refunded: false,
          deleted_at: null,
        },
      ],
    });

    fixture.detectChanges();
    expect(fixture.componentInstance.recentAnalyses().length).toBe(1);
    expect(fixture.componentInstance.recentAnalyses()[0].id).toBe('aa1');
    expect(fixture.componentInstance.loadingAnalyses()).toBe(false);
  });

  test('human module — NÃO dispara GET /aesthetic/analyses', () => {
    fixture.componentInstance.module = 'human';
    fixture.componentInstance.subjectId = 'subj-001';
    fixture.detectChanges();

    httpMock.expectNone((r) => /aesthetic\/analyses/.test(r.url));
    expect(fixture.componentInstance.recentAnalyses().length).toBe(0);
  });

  test('veterinary module — NÃO dispara GET /aesthetic/analyses', () => {
    fixture.componentInstance.module = 'veterinary';
    fixture.componentInstance.subjectId = 'subj-001';
    fixture.detectChanges();

    httpMock.expectNone((r) => /aesthetic\/analyses/.test(r.url));
    expect(fixture.componentInstance.recentAnalyses().length).toBe(0);
  });

  test('estetica module — payload submit inclui related_aesthetic_analysis_id selecionado', () => {
    fixture.componentInstance.module = 'estetica';
    fixture.componentInstance.subjectId = 'subj-002';
    fixture.detectChanges();

    // Flush the analyses list request
    const analysesReq = httpMock.expectOne((r) => /aesthetic\/analyses/.test(r.url));
    analysesReq.flush({ items: [] });

    // Simulate selecting an analysis
    fixture.componentInstance.selectedAnalysisId.set('aa-selected');

    // Trigger submit
    const form = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));

    // Intercept the POST /encounters call
    const saveReq = httpMock.expectOne((r) => /\/encounters$/.test(r.url) && r.method === 'POST');
    expect(saveReq.request.body.related_aesthetic_analysis_id).toBe('aa-selected');
    expect(saveReq.request.body.subject_id).toBe('subj-002');

    saveReq.flush({
      id: 'enc1',
      tenant_id: 't1',
      subject_id: 'subj-002',
      professional_user_id: 'u1',
      appointment_id: null,
      encounter_type: 'consulta',
      chief_complaint: null,
      anamnesis: null,
      physical_exam: null,
      hypothesis: null,
      conduct: null,
      return_recommendation: null,
      attachments: [],
      signed_at: null,
      signed_by_user_id: null,
      created_at: '2026-05-11T10:00:00Z',
      updated_at: '2026-05-11T10:00:00Z',
    });
  });

  test('estetica module — payload submit inclui related_aesthetic_analysis_id null quando nenhuma análise selecionada', () => {
    fixture.componentInstance.module = 'estetica';
    fixture.componentInstance.subjectId = 'subj-003';
    fixture.detectChanges();

    const analysesReq = httpMock.expectOne((r) => /aesthetic\/analyses/.test(r.url));
    analysesReq.flush({ items: [] });

    // No analysis selected (default null)
    const form = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));

    const saveReq = httpMock.expectOne((r) => /\/encounters$/.test(r.url) && r.method === 'POST');
    expect(saveReq.request.body.related_aesthetic_analysis_id).toBeNull();

    saveReq.flush({
      id: 'enc2',
      tenant_id: 't1',
      subject_id: 'subj-003',
      professional_user_id: 'u1',
      appointment_id: null,
      encounter_type: 'consulta',
      chief_complaint: null,
      anamnesis: null,
      physical_exam: null,
      hypothesis: null,
      conduct: null,
      return_recommendation: null,
      attachments: [],
      signed_at: null,
      signed_by_user_id: null,
      created_at: '2026-05-11T10:00:00Z',
      updated_at: '2026-05-11T10:00:00Z',
    });
  });
});

// ── §9.3 — Auto-suggest análise mais recente (TODO#7) ────────────────────────

describe('EncounterFormComponent — §9.3 auto-suggest análise estética', () => {
  let fixture: ComponentFixture<EncounterFormComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EncounterFormComponent, HttpClientTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(EncounterFormComponent);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // Helper: análise com data relativa a now
  function makeAnalysis(id: string, daysAgo: number, status = 'done') {
    const ts = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    return {
      id,
      analysis_type: 'facial',
      status,
      created_at: ts,
      completed_at: ts,
      tenant_id: 't1',
      subject_id: 'subj-001',
      user_id: 'u1',
      photo_ids: [],
      model_metrics: null,
      model_recommendations: null,
      tokens_input: null,
      tokens_output: null,
      error_code: null,
      error_message: null,
      baseline_analysis_id: null,
      credits_charged: 1,
      credits_refunded: false,
      deleted_at: null,
    };
  }

  test('sem related_id + análise recente (≤30d) status done → pré-seleciona e autoSuggested=true', () => {
    fixture.componentInstance.module = 'estetica';
    fixture.componentInstance.subjectId = 'subj-001';
    fixture.componentInstance.existingEncounter = null;
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => /aesthetic\/analyses/.test(r.url));
    req.flush({ items: [makeAnalysis('aa-recent', 5)] });
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedAnalysisId()).toBe('aa-recent');
    expect(fixture.componentInstance.autoSuggested()).toBe(true);
  });

  test('com related_id já setado → usa o existingEncounter.related_id, autoSuggested=false', () => {
    fixture.componentInstance.module = 'estetica';
    fixture.componentInstance.subjectId = 'subj-001';
    fixture.componentInstance.existingEncounter = { related_aesthetic_analysis_id: 'aa-saved' };
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => /aesthetic\/analyses/.test(r.url));
    req.flush({ items: [makeAnalysis('aa-recent', 5)] });
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedAnalysisId()).toBe('aa-saved');
    expect(fixture.componentInstance.autoSuggested()).toBe(false);
  });

  test('análise mais recente é >30 dias → selectedAnalysisId fica null, autoSuggested=false', () => {
    fixture.componentInstance.module = 'estetica';
    fixture.componentInstance.subjectId = 'subj-001';
    fixture.componentInstance.existingEncounter = null;
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => /aesthetic\/analyses/.test(r.url));
    req.flush({ items: [makeAnalysis('aa-old', 45)] }); // 45 days old > 30
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedAnalysisId()).toBeNull();
    expect(fixture.componentInstance.autoSuggested()).toBe(false);
  });

  test('usuário muda dropdown manualmente → autoSuggested vira false', () => {
    fixture.componentInstance.module = 'estetica';
    fixture.componentInstance.subjectId = 'subj-001';
    fixture.componentInstance.existingEncounter = null;
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => /aesthetic\/analyses/.test(r.url));
    req.flush({ items: [makeAnalysis('aa-recent', 10)] });
    fixture.detectChanges();

    // auto-suggested first
    expect(fixture.componentInstance.autoSuggested()).toBe(true);

    // user manually changes
    fixture.componentInstance.onAnalysisChange('aa-other');
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedAnalysisId()).toBe('aa-other');
    expect(fixture.componentInstance.autoSuggested()).toBe(false);
  });

  test('múltiplas análises dentro de 30d → escolhe a mais recente', () => {
    fixture.componentInstance.module = 'estetica';
    fixture.componentInstance.subjectId = 'subj-001';
    fixture.componentInstance.existingEncounter = null;
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => /aesthetic\/analyses/.test(r.url));
    // aa-older is 20 days ago, aa-newer is 3 days ago
    req.flush({ items: [makeAnalysis('aa-older', 20), makeAnalysis('aa-newer', 3)] });
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedAnalysisId()).toBe('aa-newer');
    expect(fixture.componentInstance.autoSuggested()).toBe(true);
  });
});
