import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class WsService {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private destroyed = false;
  private token: string | null = null;

  examUpdates$ = new Subject<{ exam_id: string }>();

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

    this.ws.onopen = () => { this.reconnectDelay = 1000; };

    this.ws.onmessage = (event) => {
      try {
        this.examUpdates$.next(JSON.parse(event.data));
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
