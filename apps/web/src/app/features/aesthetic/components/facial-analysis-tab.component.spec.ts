/**
 * FacialAnalysisTabComponent — unit tests
 *
 * Plan: docs/superpowers/plans/2026-05-11-aesthetic-f1-facial.md Task 24
 *
 * Strategy: NO_ERRORS_SCHEMA + direct signal manipulation for step transitions.
 * MatDialog is not tested here because the component's standalone imports bring
 * in the full Material overlay stack which requires more infrastructure than
 * jsdom provides. Consent-modal integration is covered in consent-modal.component.spec.ts.
 *
 * Testa:
 *  1. Renderiza estado idle inicialmente (3 botões)
 *  2. startNewAnalysis chama getConsent; sem consent → step=consent_check;
 *     com consent → step=guide
 *  3. step=result renderiza result-state
 *  4. WS event analysis_done → step=result
 */
import '@angular/compiler';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of, throwError, Subject } from 'rxjs';

import { FacialAnalysisTabComponent } from './facial-analysis-tab.component';
import { AestheticFacialService } from '../services/aesthetic-facial.service';
import { AestheticWsService, AestheticEvent } from '../services/aesthetic-ws.service';
import { AestheticAnalysisDetail } from '../models/analysis.model';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeDetail(overrides: Partial<AestheticAnalysisDetail> = {}): AestheticAnalysisDetail {
  return {
    id: 'analysis-001',
    tenant_id: 'tenant-001',
    subject_id: 'subject-001',
    user_id: 'user-001',
    analysis_type: 'facial',
    photo_ids: [],
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
    metrics: null,
    observations: null,
    recommendations: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FacialAnalysisTabComponent', () => {
  let wsEventsSubject: Subject<AestheticEvent>;
  let mockFacialService: jest.Mocked<Partial<AestheticFacialService>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    wsEventsSubject = new Subject<AestheticEvent>();

    mockFacialService = {
      getConsent:     jest.fn(),
      createConsent:  jest.fn(),
      getAnalysis:    jest.fn(),
      createAnalysis: jest.fn(),
      getPhotoUrl:    jest.fn(),
      listAnalyses:   jest.fn().mockReturnValue(of({ items: [] })),
    };

    await TestBed.configureTestingModule({
      imports: [FacialAnalysisTabComponent, NoopAnimationsModule, HttpClientTestingModule, MatDialogModule],
      providers: [
        { provide: AestheticFacialService, useValue: mockFacialService },
        {
          provide: AestheticWsService,
          useValue: { events$: wsEventsSubject.asObservable() },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  function createFixture(): ComponentFixture<FacialAnalysisTabComponent> {
    const fixture = TestBed.createComponent(FacialAnalysisTabComponent);
    fixture.componentRef.setInput('subject', { id: 'subject-001', name: 'Maria Silva' });
    fixture.detectChanges();
    return fixture;
  }

  // -------------------------------------------------------------------------
  // Test 1: Idle state — 3 buttons
  // -------------------------------------------------------------------------
  it('renderiza 3 botões no estado idle inicialmente', () => {
    const fixture = createFixture();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-testid="idle-actions"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="btn-nova-analise"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="btn-historico"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="btn-comparar"]')).not.toBeNull();
  });

  it('step inicial é idle', () => {
    const fixture = createFixture();
    expect(fixture.componentInstance.step()).toBe('idle');
  });

  // -------------------------------------------------------------------------
  // Test 2: Consent check transitions via getConsent mock
  // -------------------------------------------------------------------------
  it('getConsent retorna consent válido → step=guide (sem dialog)', () => {
    mockFacialService.getConsent!.mockReturnValue(of({
      id: 'c-001',
      subject_id: 'subject-001',
      revoked_at: null,
    } as any));

    const fixture = createFixture();
    const comp = fixture.componentInstance;

    // startNewAnalysis() now goes to region_pick; then onRegionSelected() triggers consent check
    comp.startNewAnalysis();
    fixture.detectChanges();
    expect(comp.step()).toBe('region_pick');

    comp.onRegionSelected('facial');
    fixture.detectChanges();

    expect(comp.step()).toBe('guide');
    expect(mockFacialService.getConsent).toHaveBeenCalledWith('subject-001');
  });

  it('getConsent retorna error 500 → step=idle e error setado', () => {
    mockFacialService.getConsent!.mockReturnValue(
      throwError(() => ({ status: 500, message: 'Server error' })),
    );

    const fixture = createFixture();
    const comp = fixture.componentInstance;

    // Must go through region_pick then onRegionSelected to trigger consent check
    comp.startNewAnalysis();
    comp.onRegionSelected('facial');
    fixture.detectChanges();

    expect(comp.step()).toBe('idle');
    expect(comp.error()).not.toBeNull();
  });

  it('click Histórico → step=list', () => {
    const fixture = createFixture();
    const el: HTMLElement = fixture.nativeElement;

    const btn: HTMLButtonElement | null = el.querySelector('[data-testid="btn-historico"]');
    btn!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.step()).toBe('list');
  });

  it('click Comparar → step=compare', () => {
    const fixture = createFixture();
    const el: HTMLElement = fixture.nativeElement;

    const btn: HTMLButtonElement | null = el.querySelector('[data-testid="btn-comparar"]');
    btn!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.step()).toBe('compare');
  });

  // -------------------------------------------------------------------------
  // Test 3: Result state renders correctly
  // -------------------------------------------------------------------------
  it('step=result com currentAnalysis definida renderiza result-state', () => {
    const fixture = createFixture();
    const comp = fixture.componentInstance;

    comp.step.set('result');
    comp.currentAnalysis.set(makeDetail());
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="result-state"]')).not.toBeNull();
  });

  it('step=list renderiza list-state', () => {
    const fixture = createFixture();
    const comp = fixture.componentInstance;

    comp.step.set('list');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="list-state"]')).not.toBeNull();
  });

  it('step=processing renderiza processing-state', () => {
    const fixture = createFixture();
    const comp = fixture.componentInstance;

    comp.step.set('processing');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="processing-state"]')).not.toBeNull();
  });

  it('click Voltar no result → step=idle', () => {
    const fixture = createFixture();
    const comp = fixture.componentInstance;

    comp.step.set('result');
    comp.currentAnalysis.set(makeDetail());
    fixture.detectChanges();

    const btnBack = fixture.nativeElement.querySelector('[data-testid="btn-back-idle"]') as HTMLButtonElement;
    expect(btnBack).not.toBeNull();
    btnBack.click();
    fixture.detectChanges();

    expect(comp.step()).toBe('idle');
  });

  // -------------------------------------------------------------------------
  // Test 4: WS event analysis_done → fetch detail → result
  // -------------------------------------------------------------------------
  it('WS analysis_done para o analysis atual → getAnalysis chamado e step=result', (done) => {
    const detail = makeDetail({ id: 'analysis-001' });
    mockFacialService.getAnalysis!.mockReturnValue(of(detail));

    const fixture = createFixture();
    const comp = fixture.componentInstance;

    comp.step.set('processing');
    comp.currentAnalysisId.set('analysis-001');
    fixture.detectChanges();

    wsEventsSubject.next({
      kind: 'analysis_done',
      analysis_id: 'analysis-001',
      subject_id: 'subject-001',
    });

    // _fetchAnalysisAndAdvance uses async/await for photo URLs
    setTimeout(() => {
      fixture.detectChanges();
      expect(mockFacialService.getAnalysis).toHaveBeenCalledWith('analysis-001');
      expect(comp.step()).toBe('result');
      expect(comp.currentAnalysis()?.id).toBe('analysis-001');
      done();
    }, 50);
  });

  it('WS analysis_failed → step=idle e error setado', (done) => {
    const fixture = createFixture();
    const comp = fixture.componentInstance;

    comp.step.set('processing');
    comp.currentAnalysisId.set('analysis-001');
    fixture.detectChanges();

    wsEventsSubject.next({
      kind: 'analysis_failed',
      analysis_id: 'analysis-001',
      subject_id: 'subject-001',
      error_code: 'vision_error',
    });

    setTimeout(() => {
      fixture.detectChanges();
      expect(comp.step()).toBe('idle');
      expect(comp.error()).toContain('vision_error');
      done();
    });
  });

  it('WS event para outro analysis_id é ignorado', (done) => {
    const fixture = createFixture();
    const comp = fixture.componentInstance;

    comp.step.set('processing');
    comp.currentAnalysisId.set('analysis-001');
    fixture.detectChanges();

    wsEventsSubject.next({
      kind: 'analysis_done',
      analysis_id: 'analysis-DIFFERENT',
      subject_id: 'subject-001',
    });

    setTimeout(() => {
      fixture.detectChanges();
      expect(comp.step()).toBe('processing');
      expect(mockFacialService.getAnalysis).not.toHaveBeenCalled();
      done();
    });
  });

  it('onPhotosSelected salva arquivos e avança para upload', () => {
    const fixture = createFixture();
    const comp = fixture.componentInstance;

    comp.step.set('guide');
    fixture.detectChanges();

    const fakeFile = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    comp.onPhotosSelected([fakeFile]);
    fixture.detectChanges();

    expect(comp.selectedFiles()).toEqual([fakeFile]);
    expect(comp.step()).toBe('upload');
  });

  // -------------------------------------------------------------------------
  // TODO#2: initialAnalysisId deep-link
  // -------------------------------------------------------------------------

  it('initialAnalysisId definido → getAnalysis chamado e step=result (deep-link)', (done) => {
    const detail = makeDetail({ id: 'analysis-deep-001' });
    mockFacialService.getAnalysis!.mockReturnValue(of(detail));

    const fixture = TestBed.createComponent(FacialAnalysisTabComponent);
    fixture.componentRef.setInput('subject', { id: 'subject-001', name: 'Maria Silva' });
    // Set initialAnalysisId before detectChanges so ngOnInit fires with it
    fixture.componentInstance.initialAnalysisId = 'analysis-deep-001';
    fixture.detectChanges();

    setTimeout(() => {
      fixture.detectChanges();
      expect(mockFacialService.getAnalysis).toHaveBeenCalledWith('analysis-deep-001');
      expect(fixture.componentInstance.step()).toBe('result');
      expect(fixture.componentInstance.currentAnalysis()?.id).toBe('analysis-deep-001');
      done();
    }, 50);
  });

  it('initialAnalysisId: getAnalysis falha → error setado, step permanece idle', (done) => {
    mockFacialService.getAnalysis!.mockReturnValue(
      throwError(() => new Error('Not found')),
    );

    const fixture = TestBed.createComponent(FacialAnalysisTabComponent);
    fixture.componentRef.setInput('subject', { id: 'subject-001', name: 'Maria Silva' });
    fixture.componentInstance.initialAnalysisId = 'analysis-bad';
    fixture.detectChanges();

    setTimeout(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.step()).toBe('idle');
      expect(fixture.componentInstance.error()).toContain('Not found');
      done();
    }, 50);
  });

  it('ngOnChanges com novo initialAnalysisId → recarrega análise', (done) => {
    const detail1 = makeDetail({ id: 'analysis-001' });
    const detail2 = makeDetail({ id: 'analysis-002' });
    mockFacialService.getAnalysis!
      .mockReturnValueOnce(of(detail1))
      .mockReturnValueOnce(of(detail2));

    const fixture = createFixture();
    const comp = fixture.componentInstance;

    // Simulate ngOnChanges with new value
    comp.initialAnalysisId = 'analysis-002';
    comp.ngOnChanges({
      initialAnalysisId: {
        currentValue: 'analysis-002',
        previousValue: null,
        firstChange: false,
        isFirstChange: () => false,
      },
    });

    setTimeout(() => {
      fixture.detectChanges();
      expect(mockFacialService.getAnalysis).toHaveBeenLastCalledWith('analysis-002');
      expect(comp.step()).toBe('result');
      done();
    }, 50);
  });

  // -------------------------------------------------------------------------
  // F2 Task 5: region_pick tests
  // -------------------------------------------------------------------------
  it('Nova análise abre region_pick antes do consent_check', () => {
    const fixture = createFixture();
    const comp = fixture.componentInstance;

    comp.startNewAnalysis();
    expect(comp.step()).toBe('region_pick');
  });

  it('region selection avança pra consent_check com analysis_type correto', () => {
    // Use a Subject that never emits so the step stays at consent_check
    // (which is the in-flight state while getConsent is pending)
    const { Subject } = require('rxjs');
    const pending$ = new Subject();
    mockFacialService.getConsent!.mockReturnValue(pending$.asObservable());

    const fixture = createFixture();
    const comp = fixture.componentInstance;

    comp.startNewAnalysis();
    comp.onRegionSelected('legs');

    expect(comp.selectedRegion()).toBe('legs');
    expect(comp.step()).toBe('consent_check');
  });

  it('região sensível + consent válido COM reinforced para região → avança direto para guide', () => {
    // Consent exists AND reinforced_regions already covers 'abdomen'
    mockFacialService.getConsent!.mockReturnValue(of({
      id: 'c-002',
      subject_id: 'subject-001',
      revoked_at: null,
      reinforced_regions: ['abdomen'],
    } as any));

    const fixture = createFixture();
    const comp = fixture.componentInstance;

    comp.startNewAnalysis();
    comp.onRegionSelected('abdomen');
    fixture.detectChanges();

    expect(comp.step()).toBe('guide');
  });
});

// ---------------------------------------------------------------------------
// F5 Task 4: Sensitive region reinforced consent gate — needs separate TestBed
// (MatDialog mock must be provided before compileComponents)
// ---------------------------------------------------------------------------

describe('FacialAnalysisTabComponent — F5 reinforced consent gate', () => {
  let wsEventsSubject: Subject<AestheticEvent>;
  let mockFacialService: jest.Mocked<Partial<AestheticFacialService>>;
  let mockDialog: { open: jest.Mock };
  let mockDialogRef: { afterClosed: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    wsEventsSubject = new Subject<AestheticEvent>();
    mockDialogRef = { afterClosed: jest.fn().mockReturnValue(of(undefined)) };
    mockDialog = { open: jest.fn().mockReturnValue(mockDialogRef) };

    mockFacialService = {
      getConsent:     jest.fn(),
      createConsent:  jest.fn(),
      getAnalysis:    jest.fn(),
      createAnalysis: jest.fn(),
      getPhotoUrl:    jest.fn(),
      listAnalyses:   jest.fn().mockReturnValue(of({ items: [] })),
    };

    await TestBed.configureTestingModule({
      imports: [FacialAnalysisTabComponent, NoopAnimationsModule, HttpClientTestingModule, MatDialogModule],
      providers: [
        { provide: AestheticFacialService, useValue: mockFacialService },
        {
          provide: AestheticWsService,
          useValue: { events$: wsEventsSubject.asObservable() },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  function createFixture(): ComponentFixture<FacialAnalysisTabComponent> {
    const fixture = TestBed.createComponent(FacialAnalysisTabComponent);
    fixture.componentRef.setInput('subject', { id: 'subject-001', name: 'Maria Silva' });
    fixture.detectChanges();
    return fixture;
  }

  it('região sensível + consent válido sem reinforced_regions → step=consent_ask (modal reforçado)', () => {
    // Consent exists but reinforced_regions is null (not covering 'breast')
    mockFacialService.getConsent!.mockReturnValue(of({
      id: 'c-001',
      subject_id: 'subject-001',
      revoked_at: null,
      reinforced_regions: null,
    } as any));

    const fixture = createFixture();
    const comp = fixture.componentInstance;

    // Use a Subject so afterClosed doesn't emit synchronously and reset step to idle
    const afterClosedSubject = new Subject<boolean | undefined>();
    const dialogInstance: MatDialog = (comp as any)['dialog'];
    const dialogSpy = jest.spyOn(dialogInstance, 'open').mockReturnValue(
      { afterClosed: () => afterClosedSubject.asObservable() } as any,
    );

    comp.startNewAnalysis();
    comp.onRegionSelected('breast');
    fixture.detectChanges();

    // Step should be consent_ask (set before dialog.open is called)
    expect(comp.step()).toBe('consent_ask');
    // Dialog was opened with reinforced_regions containing 'breast'
    expect(dialogSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({ reinforced_regions: ['breast'] }),
      }),
    );
  });
});
