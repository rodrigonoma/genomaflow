/**
 * TimelinePanelComponent — unit tests (F6.5)
 *
 * Verifica:
 *  1. panelTitle retorna 'Análise Estética' para aesthetic_analysis_completed
 *  2. Renderiza analysis_type e photo_count no DOM
 *  3. Renderiza top_metrics quando presentes
 *  4. openAesthetic emite close event
 */
import '@angular/compiler';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { TimelinePanelComponent } from './timeline-panel.component';
import { TimelineEvent } from './patient-timeline.component';

function makeAestheticEvent(overrides: Partial<TimelineEvent['payload']> = {}): TimelineEvent {
  return {
    event_type: 'aesthetic_analysis_completed',
    event_id: 'ae-001',
    event_at: '2026-05-11T10:00:00.000Z',
    payload: {
      id: 'analysis-001',
      analysis_type: 'facial',
      photo_count: 3,
      top_metrics: [{ name: 'rugas', score: 72 }, { name: 'manchas', score: 55 }],
      ...overrides,
    },
  };
}

describe('TimelinePanelComponent — aesthetic_analysis_completed', () => {
  let fixture: ComponentFixture<TimelinePanelComponent>;
  let comp: TimelinePanelComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TimelinePanelComponent,
        HttpClientTestingModule,
        RouterTestingModule,
        MatSnackBarModule,
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(TimelinePanelComponent);
    comp = fixture.componentInstance;
  });

  it('panelTitle() retorna "Análise Estética" para aesthetic_analysis_completed', () => {
    comp.event = makeAestheticEvent();
    comp.visible = true;
    fixture.detectChanges();

    expect(comp.panelTitle()).toBe('Análise Estética');
  });

  it('renderiza analysis_type e photo_count no DOM quando visible=true', () => {
    comp.event = makeAestheticEvent();
    comp.visible = true;
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('facial');
    expect(el.textContent).toContain('3');
  });

  it('renderiza métricas top_metrics quando presentes', () => {
    comp.event = makeAestheticEvent();
    comp.visible = true;
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('rugas');
    expect(el.textContent).toContain('72/100');
  });

  it('não renderiza metric-list quando top_metrics está vazio', () => {
    comp.event = makeAestheticEvent({ top_metrics: [] });
    comp.visible = true;
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const list = el.querySelector('.metric-list');
    expect(list).toBeNull();
  });

  it('openAesthetic emite close event', () => {
    comp.event = makeAestheticEvent();
    comp.visible = true;
    fixture.detectChanges();

    let closeCalled = false;
    // Intercept the EventEmitter's emit directly
    const originalEmit = comp.close.emit.bind(comp.close);
    comp.close.emit = jest.fn(() => { closeCalled = true; originalEmit(); });

    comp.openAesthetic('analysis-001');
    expect(closeCalled).toBe(true);
  });
});
