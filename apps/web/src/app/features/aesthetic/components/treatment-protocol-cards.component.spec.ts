import '@angular/compiler';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TreatmentProtocolCardsComponent, TreatmentProtocolCardItem } from './treatment-protocol-cards.component';

describe('TreatmentProtocolCardsComponent', () => {
  let fixture: ComponentFixture<TreatmentProtocolCardsComponent>;
  let component: TreatmentProtocolCardsComponent;

  const ITEMS: TreatmentProtocolCardItem[] = [
    {
      treatment_id: 'tx1', treatment_name: 'Criolipólise',
      indication_text: 'Culote', sessions_recommended: 3, interval_days: 60,
      urgency: 'media', expected_outcome: 'Redução 20%',
      in_catalog: true, requires_medico: false,
      cost_estimate_brl_min: 1500, cost_estimate_brl_max: 3500,
    },
    {
      treatment_name: 'Plasma de Argônio',
      indication_text: 'Mancha solar', sessions_recommended: 2, interval_days: 30,
      urgency: 'baixa', expected_outcome: 'Clareamento',
      in_catalog: false,
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TreatmentProtocolCardsComponent] }).compileComponents();
    fixture = TestBed.createComponent(TreatmentProtocolCardsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('items', ITEMS);
    fixture.detectChanges();
  });

  test('renderiza um card por item', () => {
    const cards = fixture.nativeElement.querySelectorAll('[data-testid="treatment-card"]');
    expect(cards.length).toBe(2);
  });

  test('mostra badge "Em breve catálogo" quando in_catalog=false', () => {
    const badges = fixture.nativeElement.querySelectorAll('[data-testid="badge-new"]');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent.trim()).toBe('Em breve catálogo');
  });

  test('desabilita botão Agendar quando in_catalog=false', () => {
    const buttons = fixture.nativeElement.querySelectorAll('[data-testid="schedule-btn"]');
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
  });

  test('emite schedule com item ao clicar (apenas in_catalog=true)', () => {
    let emitted: TreatmentProtocolCardItem | null = null;
    component.schedule.subscribe((it: TreatmentProtocolCardItem) => { emitted = it; });
    const buttons = fixture.nativeElement.querySelectorAll('[data-testid="schedule-btn"]');
    buttons[0].click();
    expect(emitted).not.toBeNull();
    expect((emitted as TreatmentProtocolCardItem).treatment_id).toBe('tx1');
    buttons[1].click(); // disabled — should not emit
    expect((emitted as TreatmentProtocolCardItem).treatment_id).toBe('tx1'); // still tx1, no overwrite
  });

  test('formatCost retorna range quando min e max', () => {
    const result = component.formatCost(ITEMS[0]);
    expect(result).toContain('R$');
    expect(result).toContain('1.500');
    expect(result).toContain('3.500');
  });

  test('renderiza mensagem vazia quando items é lista vazia', () => {
    fixture.componentRef.setInput('items', []);
    fixture.detectChanges();
    const empty = fixture.nativeElement.querySelector('.empty');
    expect(empty).not.toBeNull();
    expect(empty.textContent).toContain('Nenhum tratamento sugerido');
  });
});
