/**
 * QuickCreateDialogComponent — unit tests (série)
 *
 * Testa:
 *  1. Quando preset_series presente, painel de série é renderizado
 *  2. Toggle ON + subject selecionado → chama createSeries com payload correto
 *  3. Toggle OFF → chama single endpoint (agenda.create)
 *  4. Sem preset_series → painel de série não renderizado
 */
import '@angular/compiler';
import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';

import { QuickCreateDialogComponent, QuickCreateDialogData } from './quick-create-dialog.component';
import { AgendaService } from './agenda.service';
import { AuthService } from '../../core/auth/auth.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDialogRef = {
  close: jest.fn(),
};

const mockAgendaService = {
  create: jest.fn(),
  createSeries: jest.fn(),
};

const mockAuthService = {
  currentUser: { module: 'estetica' },
};

function makeDialogData(overrides: Partial<QuickCreateDialogData> = {}): QuickCreateDialogData {
  return {
    start_at: '2030-06-01T09:00:00.000Z',
    default_duration_minutes: 60,
    ...overrides,
  };
}

function createFixture(data: QuickCreateDialogData): ComponentFixture<QuickCreateDialogComponent> {
  TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
  const fixture = TestBed.createComponent(QuickCreateDialogComponent);
  const comp = fixture.componentInstance;
  fixture.detectChanges();
  return fixture;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  jest.clearAllMocks();

  // Default: create returns success
  mockAgendaService.create.mockReturnValue(of({ id: 'apt-1' }));
  mockAgendaService.createSeries.mockReturnValue(of({ count: 3, appointments: [] }));

  await TestBed.configureTestingModule({
    imports: [QuickCreateDialogComponent, HttpClientTestingModule, NoopAnimationsModule],
    providers: [
      { provide: MatDialogRef, useValue: mockDialogRef },
      { provide: MAT_DIALOG_DATA, useValue: makeDialogData() },
      { provide: AgendaService, useValue: mockAgendaService },
      { provide: AuthService, useValue: mockAuthService },
    ],
    schemas: [NO_ERRORS_SCHEMA],
  }).compileComponents();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuickCreateDialogComponent — série', () => {

  // ---- Test 1: painel série visível quando preset_series presente ----

  it('exibe painel de série quando preset_series está presente', () => {
    const data = makeDialogData({ preset_series: { count: 4, interval_days: 21 } });
    const fixture = createFixture(data);
    const el: HTMLElement = fixture.nativeElement;

    const panel = el.querySelector('[data-testid="series-panel"]');
    expect(panel).not.toBeNull();
  });

  it('NÃO exibe painel de série quando preset_series está ausente', () => {
    const data = makeDialogData({ preset_series: undefined });
    const fixture = createFixture(data);
    const el: HTMLElement = fixture.nativeElement;

    const panel = el.querySelector('[data-testid="series-panel"]');
    expect(panel).toBeNull();
  });

  it('inicializa seriesCount e seriesInterval com os valores do preset', () => {
    const data = makeDialogData({ preset_series: { count: 5, interval_days: 14 } });
    const fixture = createFixture(data);
    const comp = fixture.componentInstance;

    expect(comp.seriesCount()).toBe(5);
    expect(comp.seriesInterval()).toBe(14);
  });

  it('seriesCount clampado a máximo 20', () => {
    const data = makeDialogData({ preset_series: { count: 99, interval_days: 7 } });
    const fixture = createFixture(data);
    const comp = fixture.componentInstance;

    expect(comp.seriesCount()).toBe(20);
  });

  it('seriesInterval clampado a máximo 365', () => {
    const data = makeDialogData({ preset_series: { count: 3, interval_days: 999 } });
    const fixture = createFixture(data);
    const comp = fixture.componentInstance;

    expect(comp.seriesInterval()).toBe(365);
  });

  // ---- Test 2: toggle ON + subject selecionado → chama createSeries ----

  it('com toggle ON + subject selecionado → chama createSeries com payload correto', fakeAsync(() => {
    const data = makeDialogData({ preset_series: { count: 3, interval_days: 21 } });
    const fixture = createFixture(data);
    const comp = fixture.componentInstance;

    // Simula seleção de subject
    comp.onSelectSubject({ id: 'sub-001', name: 'Alice', subject_type: 'human' });
    // Toggle ON (já é ON por padrão quando preset_series presente)
    expect(comp.showSeries()).toBe(true);

    comp.submit();
    tick();

    expect(mockAgendaService.createSeries).toHaveBeenCalledTimes(1);
    expect(mockAgendaService.create).not.toHaveBeenCalled();

    const callArg = mockAgendaService.createSeries.mock.calls[0][0];
    expect(callArg.count).toBe(3);
    expect(callArg.interval_days).toBe(21);
    expect(callArg.subject_id).toBe('sub-001');
    expect(callArg.start_at).toBe('2030-06-01T09:00:00.000Z');
  }));

  it('createSeries bem-sucedido → fecha dialog com created:true', fakeAsync(() => {
    const data = makeDialogData({ preset_series: { count: 4, interval_days: 14 } });
    const fixture = createFixture(data);
    const comp = fixture.componentInstance;

    comp.onSelectSubject({ id: 'sub-002', name: 'Bob', subject_type: 'human' });
    comp.submit();
    tick();

    expect(mockDialogRef.close).toHaveBeenCalledWith({ created: true, subject_name: 'Bob' });
  }));

  // ---- Test 3: toggle OFF → chama single endpoint (agenda.create) ----

  it('com toggle OFF → chama single create (não createSeries)', fakeAsync(() => {
    const data = makeDialogData({ preset_series: { count: 4, interval_days: 14 } });
    const fixture = createFixture(data);
    const comp = fixture.componentInstance;

    // Desabilita série
    comp.showSeries.set(false);
    fixture.detectChanges();

    comp.onSelectSubject({ id: 'sub-003', name: 'Carol', subject_type: 'human' });
    comp.submit();
    tick();

    expect(mockAgendaService.create).toHaveBeenCalledTimes(1);
    expect(mockAgendaService.createSeries).not.toHaveBeenCalled();
  }));

  // ---- Test 4: sem preset_series → single create sempre ----

  it('sem preset_series → sempre chama single create mesmo que showSeries seja true', fakeAsync(() => {
    const data = makeDialogData({ preset_series: undefined });
    const fixture = createFixture(data);
    const comp = fixture.componentInstance;

    // Sem preset_series, showSeries inicia false e o toggle nem aparece
    expect(comp.showSeries()).toBe(false);

    comp.onSelectSubject({ id: 'sub-004', name: 'Dave', subject_type: 'human' });
    comp.submit();
    tick();

    expect(mockAgendaService.create).toHaveBeenCalledTimes(1);
    expect(mockAgendaService.createSeries).not.toHaveBeenCalled();
  }));

  // ---- Test 5: erro OVERLAP da série ----

  it('erro OVERLAP da série exibe mensagem correta', fakeAsync(() => {
    mockAgendaService.createSeries.mockReturnValue(
      throwError(() => ({ error: { code: 'OVERLAP', error: 'overlap msg' } }))
    );

    const data = makeDialogData({ preset_series: { count: 2, interval_days: 7 } });
    const fixture = createFixture(data);
    const comp = fixture.componentInstance;

    comp.onSelectSubject({ id: 'sub-005', name: 'Eve', subject_type: 'human' });
    comp.submit();
    tick();

    expect(comp.errorMsg()).toContain('ocupados');
    expect(comp.submitting()).toBe(false);
  }));
});
