import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';

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

  // Inter-tenant chat events
  chatInvitationReceived$ = new Subject<{ invitation_id: string; from_tenant_id: string; from_tenant_name: string; message: string | null }>();
  chatInvitationAccepted$ = new Subject<{ invitation_id: string; conversation_id: string; counterpart_tenant_name: string }>();
  chatMessageReceived$    = new Subject<{ conversation_id: string; message_id: string; sender_tenant_id: string; body_preview: string; created_at: string }>();
  chatUnreadChange$       = new Subject<{ conversation_id: string; delta?: number; absolute?: number }>();
  chatReactionChanged$    = new Subject<{ conversation_id: string; message_id: string; emoji: string; count: number; action: 'added'|'removed' }>();

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
    // Em prod, ALB só roteia /api/* pra API (o resto vai pro nginx do Angular).
    // Em dev, proxy.conf.json mapeia /exams/subscribe direto com ws:true.
    // Então em prod incluímos o API_PREFIX (/api); em dev mantemos path raw.
    const basePath = environment.production ? environment.apiUrl : '';
    const url = `${protocol}//${location.host}${basePath}/exams/subscribe?token=${this.token}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.zone.run(() => this.reconnect$.next());
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>;
        const kind = (msg['event'] ?? msg['type']) as string;
        this.zone.run(() => {
          if (kind === 'exam:error') {
            this.examError$.next({ exam_id: msg['exam_id'] as string, error_message: msg['error_message'] as string });
          } else if (kind === 'billing:alert') {
            this.billingAlert$.next({ balance: msg['balance'] as number });
          } else if (kind === 'billing:exhausted') {
            this.billingExhausted$.next();
          } else if (kind === 'chat:invitation_received') {
            this.chatInvitationReceived$.next(msg as any);
          } else if (kind === 'chat:invitation_accepted') {
            this.chatInvitationAccepted$.next(msg as any);
          } else if (kind === 'chat:message_received') {
            this.chatMessageReceived$.next(msg as any);
          } else if (kind === 'chat:unread_change') {
            this.chatUnreadChange$.next(msg as any);
          } else if (kind === 'chat:reaction_changed') {
            this.chatReactionChanged$.next(msg as any);
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
