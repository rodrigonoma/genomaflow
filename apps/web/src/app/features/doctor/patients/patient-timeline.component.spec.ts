/**
 * PatientTimelineComponent — unit tests (F6.5)
 *
 * Verifica:
 *  1. EVENT_META tem entrada para aesthetic_analysis_completed com ícone e cor corretos
 *  2. cardTitle retorna string correta para aesthetic_analysis_completed
 *  3. cardSub retorna string com tipo e contagem de fotos
 */
import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PatientTimelineComponent, TimelineEvent } from './patient-timeline.component';

function makeAestheticEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    event_type: 'aesthetic_analysis_completed',
    event_id: 'ae-001',
    event_at: '2026-05-11T10:00:00.000Z',
    payload: {
      id: 'analysis-001',
      analysis_type: 'facial',
      photo_count: 3,
      top_metrics: [{ name: 'rugas', score: 72 }, { name: 'manchas', score: 55 }],
    },
    ...overrides,
  };
}

describe('PatientTimelineComponent — aesthetic_analysis_completed', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PatientTimelineComponent, HttpClientTestingModule],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  it('meta() retorna label "Análise estética" para aesthetic_analysis_completed', () => {
    const fixture = TestBed.createComponent(PatientTimelineComponent);
    fixture.componentInstance.subjectId = 'subject-001';
    const meta = fixture.componentInstance.meta('aesthetic_analysis_completed');

    expect(meta.label).toBe('Análise estética');
    expect(meta.icon).toBe('face_retouching_natural');
    expect(meta.color).toBe('#ec4899');
  });

  it('cardTitle retorna "Análise facial concluída" para evento aesthetic_analysis_completed', () => {
    const fixture = TestBed.createComponent(PatientTimelineComponent);
    fixture.componentInstance.subjectId = 'subject-001';
    const ev = makeAestheticEvent();

    const title = fixture.componentInstance.cardTitle(ev);
    expect(title).toBe('Análise facial concluída');
  });

  it('cardSub inclui tipo e contagem de fotos', () => {
    const fixture = TestBed.createComponent(PatientTimelineComponent);
    fixture.componentInstance.subjectId = 'subject-001';
    const ev = makeAestheticEvent();

    const sub = fixture.componentInstance.cardSub(ev);
    expect(sub).toContain('facial');
    expect(sub).toContain('3 fotos');
  });

  it('cardSub usa singular "foto" quando photo_count === 1', () => {
    const fixture = TestBed.createComponent(PatientTimelineComponent);
    fixture.componentInstance.subjectId = 'subject-001';
    const ev = makeAestheticEvent({
      payload: { id: 'analysis-002', analysis_type: 'pescoço', photo_count: 1 },
    });

    const sub = fixture.componentInstance.cardSub(ev);
    expect(sub).toContain('1 foto');
    expect(sub).not.toContain('1 fotos');
  });

  it('meta() retorna fallback para event_type desconhecido', () => {
    const fixture = TestBed.createComponent(PatientTimelineComponent);
    fixture.componentInstance.subjectId = 'subject-001';
    const meta = fixture.componentInstance.meta('unknown_type');

    expect(meta.icon).toBe('circle');
    expect(meta.color).toBe('#6e6d80');
  });
});
