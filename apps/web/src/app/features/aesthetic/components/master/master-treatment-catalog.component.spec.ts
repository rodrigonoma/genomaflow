import '@angular/compiler';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import { MasterTreatmentCatalogComponent } from './master-treatment-catalog.component';
import { AestheticMasterService } from '../../services/aesthetic-master.service';
import type { AestheticTreatment } from '../../services/aesthetic-master.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTreatment(overrides: Partial<AestheticTreatment> = {}): AestheticTreatment {
  return {
    id: 'uuid-001',
    tenant_id: null,
    name: 'Radiofrequência Facial',
    category: 'facial_rejuvenescimento',
    indications: ['flacidez', 'envelhecimento'],
    contraindications: ['gravidez'],
    typical_sessions: 6,
    interval_days: 7,
    cost_estimate_brl_min: 300,
    cost_estimate_brl_max: 800,
    evidence_level: 'B',
    description: 'Tratamento de rejuvenescimento',
    protocol_notes: null,
    requires_medico: false,
    is_active: true,
    usage_count_30d: 12,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

const mockSvc = {
  list: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('MasterTreatmentCatalogComponent', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: list returns one treatment
    mockSvc.list.mockReturnValue(of({ items: [makeTreatment()] }));

    await TestBed.configureTestingModule({
      imports: [MasterTreatmentCatalogComponent, NoopAnimationsModule, RouterTestingModule],
      providers: [
        { provide: AestheticMasterService, useValue: mockSvc },
      ],
    }).compileComponents();
  });

  // -------------------------------------------------------------------------
  // Test 1: Loads list on init
  // -------------------------------------------------------------------------
  it('carrega lista de tratamentos no ngOnInit', fakeAsync(() => {
    const fixture = TestBed.createComponent(MasterTreatmentCatalogComponent);
    fixture.detectChanges(); // triggers ngOnInit

    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(mockSvc.list).toHaveBeenCalledTimes(1);
    expect(comp.treatments().length).toBe(1);
    expect(comp.treatments()[0].name).toBe('Radiofrequência Facial');
    expect(comp.loading()).toBe(false);
  }));

  // -------------------------------------------------------------------------
  // Test 2: openCreate() opens the modal
  // -------------------------------------------------------------------------
  it('openCreate() exibe o modal de criação', fakeAsync(() => {
    const fixture = TestBed.createComponent(MasterTreatmentCatalogComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.showModal()).toBe(false);
    expect(comp.editing()).toBeNull();

    comp.openCreate();
    fixture.detectChanges();

    expect(comp.showModal()).toBe(true);
    expect(comp.editing()).toBeNull();
    expect(comp.form.name).toBe('');

    // Verify DOM contains the modal
    const overlay = fixture.nativeElement.querySelector('.modal-overlay');
    expect(overlay).not.toBeNull();
    const title = fixture.nativeElement.querySelector('.modal-title');
    expect(title?.textContent?.trim()).toBe('Novo tratamento');
  }));

  // -------------------------------------------------------------------------
  // Test 3: save() calls create and reloads list
  // -------------------------------------------------------------------------
  it('save() chama service.create e recarrega a lista', fakeAsync(() => {
    const newTreatment = makeTreatment({ id: 'uuid-002', name: 'Drenagem Linfática' });
    mockSvc.create.mockReturnValue(of(newTreatment));
    // After save, list returns 2 items
    mockSvc.list
      .mockReturnValueOnce(of({ items: [makeTreatment()] }))
      .mockReturnValueOnce(of({ items: [makeTreatment(), newTreatment] }));

    const fixture = TestBed.createComponent(MasterTreatmentCatalogComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.openCreate();

    // Fill required fields
    comp.form.name = 'Drenagem Linfática';
    comp.form.category = 'wellness_drenagem';
    fixture.detectChanges();

    expect(comp.formValid()).toBe(true);

    comp.save();
    tick();
    fixture.detectChanges();

    expect(mockSvc.create).toHaveBeenCalledTimes(1);
    expect(mockSvc.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Drenagem Linfática', category: 'wellness_drenagem' })
    );
    // Modal closed
    expect(comp.showModal()).toBe(false);
    // List reloaded — 2 calls total
    expect(mockSvc.list).toHaveBeenCalledTimes(2);
    expect(comp.treatments().length).toBe(2);
  }));

  // -------------------------------------------------------------------------
  // Test 4: deleteOne() — confirmed → calls remove and reloads
  // -------------------------------------------------------------------------
  it('deleteOne() com confirmação chama service.remove e recarrega lista', fakeAsync(() => {
    const treatment = makeTreatment();
    mockSvc.remove.mockReturnValue(of(undefined));
    mockSvc.list
      .mockReturnValueOnce(of({ items: [treatment] }))
      .mockReturnValueOnce(of({ items: [] }));

    // Mock window.confirm to return true
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    const fixture = TestBed.createComponent(MasterTreatmentCatalogComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.treatments().length).toBe(1);

    comp.deleteOne(treatment);
    tick();
    fixture.detectChanges();

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Radiofrequência Facial')
    );
    expect(mockSvc.remove).toHaveBeenCalledWith('uuid-001');
    expect(mockSvc.list).toHaveBeenCalledTimes(2);
    expect(comp.treatments().length).toBe(0);
  }));

  // -------------------------------------------------------------------------
  // Test 5: deleteOne() — cancelled → does NOT call remove
  // -------------------------------------------------------------------------
  it('deleteOne() cancelado não chama service.remove', fakeAsync(() => {
    jest.spyOn(window, 'confirm').mockReturnValue(false);

    const fixture = TestBed.createComponent(MasterTreatmentCatalogComponent);
    fixture.detectChanges();
    tick();

    const comp = fixture.componentInstance;
    comp.deleteOne(makeTreatment());

    expect(mockSvc.remove).not.toHaveBeenCalled();
  }));

  // -------------------------------------------------------------------------
  // Test 6: Error on list shows errorMsg
  // -------------------------------------------------------------------------
  it('exibe mensagem de erro quando service.list falha', fakeAsync(() => {
    mockSvc.list.mockReturnValue(throwError(() => ({ error: { error: 'Não autorizado' } })));

    const fixture = TestBed.createComponent(MasterTreatmentCatalogComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.errorMsg()).toBe('Não autorizado');
    expect(comp.treatments().length).toBe(0);
    expect(comp.loading()).toBe(false);
  }));
});
