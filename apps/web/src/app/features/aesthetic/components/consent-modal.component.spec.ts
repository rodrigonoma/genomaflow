import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { ConsentModalComponent } from './consent-modal.component';
import { AestheticFacialService } from '../services/aesthetic-facial.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDialogRef = {
  close: jest.fn(),
};

const mockAestheticService = {
  createConsent: jest.fn(),
};

// ---------------------------------------------------------------------------
// Helper: create TestBed with given dialog data
// ---------------------------------------------------------------------------

async function setupModule(dialogData: { subject_id: string; reinforced_regions?: string[] }) {
  jest.clearAllMocks();
  await TestBed.configureTestingModule({
    imports: [ConsentModalComponent, NoopAnimationsModule],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: dialogData },
      { provide: MatDialogRef, useValue: mockDialogRef },
      { provide: AestheticFacialService, useValue: mockAestheticService },
    ],
  }).compileComponents();
}

// ---------------------------------------------------------------------------
// Specs — standard mode (no reinforced_regions)
// ---------------------------------------------------------------------------

describe('ConsentModalComponent — modo padrão (sem reinforced_regions)', () => {
  beforeEach(() => setupModule({ subject_id: 'sub-uuid-001' }));

  // -------------------------------------------------------------------------
  // Test 1: Confirmar button disabled when checkbox false OR name < 3 chars
  // -------------------------------------------------------------------------
  it('botão Confirmar fica desabilitado quando checkbox false ou nome < 3 chars', () => {
    const fixture = TestBed.createComponent(ConsentModalComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    // Initial state — both invalid
    expect(comp.canConfirm()).toBe(false);

    // Checkbox true, name still empty
    comp.form.patchValue({ lgpdAware: true, signerName: '' });
    fixture.detectChanges();
    expect(comp.canConfirm()).toBe(false);

    // Checkbox true, name only 2 chars
    comp.form.patchValue({ lgpdAware: true, signerName: 'AB' });
    fixture.detectChanges();
    expect(comp.canConfirm()).toBe(false);

    // Checkbox false, name valid
    comp.form.patchValue({ lgpdAware: false, signerName: 'Dra. Ana' });
    fixture.detectChanges();
    expect(comp.canConfirm()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 2: Confirmar enabled when lgpdAware + signerName >= 3 (no reinforcedAck needed)
  // -------------------------------------------------------------------------
  it('botão Confirmar habilita sem reinforcedAck quando reinforced_regions ausente', () => {
    const fixture = TestBed.createComponent(ConsentModalComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.patchValue({ lgpdAware: true, signerName: 'Dra' });
    fixture.detectChanges();

    expect(comp.canConfirm()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 3: confirm() chama createConsent sem reinforced_regions
  // -------------------------------------------------------------------------
  it('confirm() chama createConsent sem reinforced_regions e fecha com true', () => {
    mockAestheticService.createConsent.mockReturnValue(of({ id: 'consent-uuid-001' }));

    const fixture = TestBed.createComponent(ConsentModalComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.patchValue({ lgpdAware: true, signerName: 'Dr. João' });
    fixture.detectChanges();

    comp.confirm();

    expect(mockAestheticService.createConsent).toHaveBeenCalledWith({
      subject_id: 'sub-uuid-001',
      notes: 'Dr. João',
      reinforced_regions: undefined,
    });
    expect(mockDialogRef.close).toHaveBeenCalledWith(true);
  });

  // -------------------------------------------------------------------------
  // Test 4: hasReinforced é false quando reinforced_regions ausente
  // -------------------------------------------------------------------------
  it('hasReinforced é false quando reinforced_regions está ausente', () => {
    const fixture = TestBed.createComponent(ConsentModalComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.hasReinforced).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Specs — reinforced mode (com reinforced_regions)
// ---------------------------------------------------------------------------

describe('ConsentModalComponent — modo reforçado (com reinforced_regions)', () => {
  const mockDialogDataReinforced = {
    subject_id: 'sub-uuid-001',
    reinforced_regions: ['breast'],
  };

  beforeEach(() => setupModule(mockDialogDataReinforced));

  // -------------------------------------------------------------------------
  // Test 5: hasReinforced é true quando reinforced_regions presente
  // -------------------------------------------------------------------------
  it('hasReinforced é true quando reinforced_regions tem itens', () => {
    const fixture = TestBed.createComponent(ConsentModalComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.hasReinforced).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: canConfirm é false sem reinforcedAck mesmo com lgpd + nome válidos
  // -------------------------------------------------------------------------
  it('canConfirm é false quando reinforcedAck não marcado, mesmo com lgpd e nome válidos', () => {
    const fixture = TestBed.createComponent(ConsentModalComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.patchValue({ lgpdAware: true, signerName: 'Dra. Ana Lima', reinforcedAck: false });
    fixture.detectChanges();

    expect(comp.canConfirm()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 7: canConfirm é true quando lgpd + nome + reinforcedAck todos marcados
  // -------------------------------------------------------------------------
  it('canConfirm é true quando reinforcedAck marcado + lgpd + nome válidos', () => {
    const fixture = TestBed.createComponent(ConsentModalComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.patchValue({ lgpdAware: true, signerName: 'Dra. Ana Lima', reinforcedAck: true });
    fixture.detectChanges();

    expect(comp.canConfirm()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 8: confirm() chama createConsent com reinforced_regions e fecha com true
  // -------------------------------------------------------------------------
  it('confirm() chama createConsent com reinforced_regions e fecha com true', () => {
    mockAestheticService.createConsent.mockReturnValue(of({ id: 'consent-uuid-002' }));

    const fixture = TestBed.createComponent(ConsentModalComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.patchValue({ lgpdAware: true, signerName: 'Dra. Ana Lima', reinforcedAck: true });
    fixture.detectChanges();

    comp.confirm();

    expect(mockAestheticService.createConsent).toHaveBeenCalledWith({
      subject_id: 'sub-uuid-001',
      notes: 'Dra. Ana Lima',
      reinforced_regions: ['breast'],
    });
    expect(mockDialogRef.close).toHaveBeenCalledWith(true);
  });

  // -------------------------------------------------------------------------
  // Test 9: disclaimer de região sensível renderizado no template
  // -------------------------------------------------------------------------
  it('disclaimer reinforced-warning é renderizado no template', () => {
    const fixture = TestBed.createComponent(ConsentModalComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="reinforced-disclaimer"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="reinforced-ack"]')).not.toBeNull();
  });
});
