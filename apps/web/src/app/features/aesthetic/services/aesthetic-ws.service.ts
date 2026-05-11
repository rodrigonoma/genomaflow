/**
 * AestheticWsService
 *
 * Bridge between the generic WsService and the aesthetic feature.
 * WsService calls emit() when it receives events with kind 'analysis_done'
 * or 'analysis_failed'. Components subscribe via events$ to react reactively.
 *
 * Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md
 * Plan: docs/superpowers/plans/2026-05-11-aesthetic-f1-facial.md Task 25
 */
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

// ---------------------------------------------------------------------------
// Event type
// ---------------------------------------------------------------------------

export interface AestheticEvent {
  kind: 'analysis_done' | 'analysis_failed';
  analysis_id: string;
  subject_id: string;
  error_code?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class AestheticWsService {
  private readonly subject = new Subject<AestheticEvent>();

  /** Observable stream of aesthetic WS events. */
  readonly events$ = this.subject.asObservable();

  /**
   * Called by WsService when an aesthetic WS event arrives.
   * Not for direct use by components — subscribe to events$ instead.
   */
  emit(event: AestheticEvent): void {
    this.subject.next(event);
  }
}
