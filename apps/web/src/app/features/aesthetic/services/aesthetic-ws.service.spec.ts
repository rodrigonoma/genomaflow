/**
 * AestheticWsService — unit tests
 *
 * Plan: docs/superpowers/plans/2026-05-11-aesthetic-f1-facial.md Task 25
 *
 * Testa:
 *  1. emit() entrega evento para subscribers de events$
 *  2. subscribers distintos recebem o mesmo evento
 */
import { AestheticWsService, AestheticEvent } from './aesthetic-ws.service';

describe('AestheticWsService', () => {
  let service: AestheticWsService;

  beforeEach(() => {
    service = new AestheticWsService();
  });

  // -------------------------------------------------------------------------
  // Test 1: emit → subscriber recebe o evento
  // -------------------------------------------------------------------------
  it('emit() entrega o evento para subscribers de events$', (done) => {
    const expected: AestheticEvent = {
      kind: 'analysis_done',
      analysis_id: 'analysis-001',
      subject_id: 'subject-001',
    };

    service.events$.subscribe((event) => {
      expect(event).toEqual(expected);
      done();
    });

    service.emit(expected);
  });

  // -------------------------------------------------------------------------
  // Test 2: dois subscribers recebem o mesmo evento
  // -------------------------------------------------------------------------
  it('dois subscribers recebem o mesmo evento emitido', () => {
    const received1: AestheticEvent[] = [];
    const received2: AestheticEvent[] = [];

    service.events$.subscribe((e) => received1.push(e));
    service.events$.subscribe((e) => received2.push(e));

    const ev: AestheticEvent = {
      kind: 'analysis_failed',
      analysis_id: 'analysis-002',
      subject_id: 'subject-002',
      error_code: 'timeout',
    };

    service.emit(ev);

    expect(received1).toHaveLength(1);
    expect(received1[0]).toEqual(ev);
    expect(received2).toHaveLength(1);
    expect(received2[0]).toEqual(ev);
  });

  // -------------------------------------------------------------------------
  // Test 3: events$ não emite antes de emit() ser chamado
  // -------------------------------------------------------------------------
  it('events$ não emite antes de emit() ser chamado', () => {
    const received: AestheticEvent[] = [];
    service.events$.subscribe((e) => received.push(e));
    // No emit call
    expect(received).toHaveLength(0);
  });
});
