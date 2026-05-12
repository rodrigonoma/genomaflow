/**
 * AestheticProfileFormComponent — unit tests
 *
 * F4.5 — aesthetic-profile-form
 *
 * Tests:
 *  1. Load on init populates form signals from service GET response
 *  2. Submit calls service.update and shows computed nutrition panel
 *  3. toggleGoal updates goals in formProfile signal
 *  4. Empty profile → computed() is null → shows empty-state placeholder
 *  5. PUT error → errorMsg signal is set and saving resets to false
 */
import '@angular/compiler';
import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';

import { AestheticProfileFormComponent } from './aesthetic-profile-form.component';
import {
  AestheticProfileService,
  ProfileResponse,
} from '../services/aesthetic-profile.service';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeResponse(overrides: Partial<ProfileResponse> = {}): ProfileResponse {
  return {
    profile: {
      height_cm: 165,
      weight_kg: 62,
      age: 30,
      sex: 'F',
      activity_level: 'moderate',
      goals: ['tone'],
      dietary_restrictions: ['none'],
      allergies: [],
      medical_conditions: [],
    },
    computed: {
      tmb: 1430,
      calories: 1980,
      macros: { protein_g: 148, carbs_g: 198, fat_g: 66 },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AestheticProfileFormComponent', () => {
  let mockSvc: jest.Mocked<Partial<AestheticProfileService>>;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockSvc = {
      get: jest.fn(),
      update: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AestheticProfileFormComponent, NoopAnimationsModule],
      providers: [
        { provide: AestheticProfileService, useValue: mockSvc },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  function createFixture(subjectId = 'subject-001'): ComponentFixture<AestheticProfileFormComponent> {
    const fixture = TestBed.createComponent(AestheticProfileFormComponent);
    fixture.componentRef.setInput('subjectId', subjectId);
    return fixture;
  }

  // -------------------------------------------------------------------------
  // Test 1: Load on init populates form signals
  // -------------------------------------------------------------------------
  it('ngOnInit carrega perfil e popula formProfile e computed', fakeAsync(() => {
    mockSvc.get!.mockReturnValue(of(makeResponse()));

    const fixture = createFixture();
    fixture.detectChanges(); // triggers ngOnInit
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;

    expect(mockSvc.get).toHaveBeenCalledWith('subject-001');
    expect(comp.formProfile().height_cm).toBe(165);
    expect(comp.formProfile().sex).toBe('F');
    expect(comp.computed()?.tmb).toBe(1430);
    expect(comp.loading()).toBe(false);
  }));

  // -------------------------------------------------------------------------
  // Test 2: Submit calls update and shows computed panel
  // -------------------------------------------------------------------------
  it('saveProfile chama service.update e exibe painel computed ao sucesso', fakeAsync(() => {
    mockSvc.get!.mockReturnValue(of(makeResponse()));
    mockSvc.update!.mockReturnValue(of(makeResponse()));

    const fixture = createFixture();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.saveProfile();
    tick();
    // Flush the successMsg auto-clear timer (4000ms)
    tick(4000);
    fixture.detectChanges();

    expect(mockSvc.update).toHaveBeenCalledWith('subject-001', comp.formProfile());
    expect(comp.computed()?.calories).toBe(1980);
    expect(comp.saving()).toBe(false);

    // Computed panel should be visible
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="computed-content"]')).not.toBeNull();
  }));

  // -------------------------------------------------------------------------
  // Test 3: toggleGoal updates goals in formProfile signal
  // -------------------------------------------------------------------------
  it('toggleGoal adiciona e remove objetivos no signal formProfile', fakeAsync(() => {
    mockSvc.get!.mockReturnValue(of(makeResponse({ profile: { goals: [] } })));

    const fixture = createFixture();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;

    // Add fat_loss
    comp.toggleGoal('fat_loss');
    expect(comp.formProfile().goals).toContain('fat_loss');

    // Add wellness
    comp.toggleGoal('wellness');
    expect(comp.formProfile().goals).toContain('wellness');
    expect(comp.formProfile().goals!.length).toBe(2);

    // Remove fat_loss
    comp.toggleGoal('fat_loss');
    expect(comp.formProfile().goals).not.toContain('fat_loss');
    expect(comp.formProfile().goals!.length).toBe(1);
  }));

  // -------------------------------------------------------------------------
  // Test 4: Empty profile → computed is null → shows placeholder
  // -------------------------------------------------------------------------
  it('perfil vazio sem computed mostra placeholder e não exibe painel de dados', fakeAsync(() => {
    mockSvc.get!.mockReturnValue(of({
      profile: {},
      computed: null,
    }));

    const fixture = createFixture();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.computed()).toBeNull();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="computed-empty"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="computed-content"]')).toBeNull();
  }));

  // -------------------------------------------------------------------------
  // Test 5: PUT error → errorMsg signal set
  // -------------------------------------------------------------------------
  it('saveProfile com erro HTTP define errorMsg e reseta saving para false', fakeAsync(() => {
    mockSvc.get!.mockReturnValue(of(makeResponse()));
    mockSvc.update!.mockReturnValue(
      throwError(() => ({ error: { error: 'Validation failed' }, status: 400 }))
    );

    const fixture = createFixture();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.saveProfile();
    tick();
    fixture.detectChanges();

    expect(comp.errorMsg()).toBe('Validation failed');
    expect(comp.saving()).toBe(false);

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="error-bar"]')).not.toBeNull();
  }));

  // -------------------------------------------------------------------------
  // Test 6 (bonus): disclaimer is always visible
  // -------------------------------------------------------------------------
  it('disclaimer CRN aparece no template', fakeAsync(() => {
    mockSvc.get!.mockReturnValue(of(makeResponse()));

    const fixture = createFixture();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const disclaimer = el.querySelector('[data-testid="disclaimer"]');
    expect(disclaimer).not.toBeNull();
    expect(disclaimer!.textContent).toContain('nutricionista');
  }));

  // -------------------------------------------------------------------------
  // Test 7 (bonus): toggleDietary updates dietary_restrictions signal
  // -------------------------------------------------------------------------
  it('toggleDietary adiciona e remove restrições no signal formProfile', fakeAsync(() => {
    mockSvc.get!.mockReturnValue(of(makeResponse({ profile: { dietary_restrictions: [] } })));

    const fixture = createFixture();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;

    comp.toggleDietary('vegan');
    expect(comp.formProfile().dietary_restrictions).toContain('vegan');

    comp.toggleDietary('vegan');
    expect(comp.formProfile().dietary_restrictions).not.toContain('vegan');
  }));
});
