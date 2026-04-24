import { Component, EventEmitter, Input, Output, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Subscription } from 'rxjs';
import { ChatService } from './chat.service';
import { WsService } from '../../core/ws/ws.service';
import { InterTenantConversation } from '../../shared/models/chat.models';

@Component({
  selector: 'app-conversation-list',
  standalone: true,
  imports: [CommonModule, DatePipe],
  styles: [`
    :host { display: flex; flex-direction: column; overflow-y: auto; flex: 1; }
    .empty {
      padding: 2rem 1.25rem; text-align: center;
      font-family: 'JetBrains Mono', monospace; font-size: 0.75rem;
      color: #7c7b8f;
    }
    .item {
      display: flex; flex-direction: column; gap: 0.25rem;
      padding: 0.875rem 1.25rem;
      border-bottom: 1px solid rgba(70,69,84,0.1);
      cursor: pointer;
      border-left: 3px solid transparent;
      transition: background 150ms;
    }
    .item:hover { background: #131b2e; }
    .item.selected { background: #171f33; border-left-color: #c0c1ff; }
    .row-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
    .name {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 0.875rem; color: #dae2fd;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      flex: 1;
    }
    .date {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #7c7b8f; white-space: nowrap;
    }
    .preview {
      font-size: 0.8125rem; color: #908fa0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .row-bottom { display: flex; align-items: center; gap: 0.5rem; }
    .badge {
      background: #494bd6; color: #fff;
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      padding: 1px 7px; border-radius: 10px; min-width: 18px; text-align: center;
    }
  `],
  template: `
    @if (conversations().length === 0) {
      <div class="empty">Nenhuma conversa ainda.<br>Clique em + pra começar uma nova.</div>
    }
    @for (c of conversations(); track c.id) {
      <div class="item" [class.selected]="c.id === selectedId" (click)="select.emit(c.id)">
        <div class="row-top">
          <span class="name">{{ c.counterpart_name }}</span>
          <span class="date">{{ c.last_message_at || c.created_at | date:'dd/MM HH:mm' }}</span>
        </div>
        <div class="row-bottom">
          <span class="preview">{{ c.last_message_preview || 'Sem mensagens ainda' }}</span>
          @if (c.unread_count > 0) {
            <span class="badge">{{ c.unread_count > 99 ? '99+' : c.unread_count }}</span>
          }
        </div>
      </div>
    }
  `
})
export class ConversationListComponent implements OnInit, OnDestroy {
  @Input() selectedId: string | null = null;
  @Output() select = new EventEmitter<string>();

  private chat = inject(ChatService);
  private ws = inject(WsService);
  private subs = new Subscription();
  conversations = signal<InterTenantConversation[]>([]);

  ngOnInit() {
    this.refresh();
    this.subs.add(this.ws.chatMessageReceived$.subscribe(() => this.refresh()));
    this.subs.add(this.ws.chatUnreadChange$.subscribe(() => this.refresh()));
    this.subs.add(this.ws.chatInvitationAccepted$.subscribe(() => this.refresh()));
  }

  ngOnDestroy() { this.subs.unsubscribe(); }

  private refresh() {
    this.chat.listConversations().subscribe({ next: (res) => this.conversations.set(res.results) });
  }
}
