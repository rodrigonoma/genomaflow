import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class WsService {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private destroyed = false;
  private token: string | null = null;

  constructor(private zone: NgZone) {}

  examUpdates$      = new Subject<{ exam_id: string }>();
  examError$        = new Subject<{ exam_id: string; error_message: string }>();
  billingAlert$     = new Subject<{ balance: number }>();
  billingExhausted$ = new Subject<void>();
  reconnect$        = new Subject<void>();

  connect(token: string): void {
    this.disconnect();
    this.token = token;
    this.destroyed = false;
    this.reconnectDelay = 1000;
    this.openConnection();
  }

  private openConnection(): void {
    if (!this.token || this.destroyed) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/exams/subscribe?token=${this.token}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.zone.run(() => this.reconnect$.next());
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>;
        this.zone.run(() => {
          if (msg['type'] === 'exam:error') {
            this.examError$.next({ exam_id: msg['exam_id'] as string, error_message: msg['error_message'] as string });
          } else if (msg['type'] === 'billing:alert') {
            this.billingAlert$.next({ balance: msg['balance'] as number });
          } else if (msg['type'] === 'billing:exhausted') {
            this.billingExhausted$.next();
          } else {
            this.examUpdates$.next(msg as { exam_id: string });
          }
        });
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = () => {
      if (!this.destroyed) {
        setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
          this.openConnection();
        }, this.reconnectDelay);
      }
    };
  }

  disconnect(): void {
    this.destroyed = true;
    this.token = null;
    this.ws?.close();
    this.ws = null;
  }
}
