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

const mockDialogData = {
  subject_id: 'sub-uuid-001',
  reinforced_regions: ['face', 'neck'],
};

const mockDialogRef = {
  close: jest.fn(),
};

const mockAestheticService = {
  createConsent: jest.fn(),
};

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('ConsentModalComponent', () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [ConsentModalComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: AestheticFacialService, useValue: mockAestheticService },
      ],
    }).compileComponents();
  });

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
  // Test 2: Confirmar button enabled when checkbox true AND name >= 3 chars
  // -------------------------------------------------------------------------
  it('botão Confirmar habilita quando checkbox marcado e nome ≥ 3 chars', () => {
    const fixture = TestBed.createComponent(ConsentModalComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.patchValue({ lgpdAware: true, signerName: 'Dra' });
    fixture.detectChanges();

    expect(comp.canConfirm()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 3: confirm() chama createConsent e fecha com true
  // -------------------------------------------------------------------------
  it('confirm() chama createConsent com dados corretos e fecha o dialog com true', () => {
    mockAestheticService.createConsent.mockReturnValue(of({ id: 'consent-uuid-001' }));

    const fixture = TestBed.createComponent(ConsentModalComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.patchValue({ lgpdAware: true, signerName: 'Dra. Ana Lima' });
    fixture.detectChanges();

    comp.confirm();

    expect(mockAestheticService.createConsent).toHaveBeenCalledWith({
      subject_id: 'sub-uuid-001',
      notes: 'Dra. Ana Lima',
      reinforced_regions: ['face', 'neck'],
    });
    expect(mockDialogRef.close).toHaveBeenCalledWith(true);
  });
});
