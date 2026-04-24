import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { ChatService } from './chat.service';
import { WsService } from '../../core/ws/ws.service';
import { ConversationListComponent } from './conversation-list.component';
import { ThreadComponent } from './thread.component';
import { DirectoryModalComponent } from './directory-modal.component';
import { InvitesPanelComponent } from './invites-panel.component';

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule, MatDialogModule,
            ConversationListComponent, ThreadComponent, InvitesPanelComponent],
  styles: [`
    :host { display: flex; height: calc(100vh - 56px); background: #0b1326; color: #dae2fd; }
    .sidebar { width: 340px; border-right: 1px solid rgba(70,69,84,0.15); display: flex; flex-direction: column; }
    .sidebar-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.25rem; border-bottom: 1px solid rgba(70,69,84,0.15);
    }
    .sidebar-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.125rem; color: #c0c1ff;
    }
    .header-actions { display: flex; gap: 0.25rem; align-items: center; }
    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .empty {
      flex: 1; display: flex; align-items: center; justify-content: center;
      color: #7c7b8f; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem;
    }
    .badge-small {
      position: absolute; top: 2px; right: 2px;
      background: #ffb4ab; color: #0b1326;
      font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700;
      padding: 1px 4px; border-radius: 8px; min-width: 14px; text-align: center; line-height: 1;
    }
    .icon-btn-wrap { position: relative; display: inline-flex; }

    @media (max-width: 639px) {
      .sidebar { width: 100%; }
      :host.has-selected .sidebar { display: none; }
      .main { display: none; }
      :host.has-selected .main { display: flex; }
    }
  `],
  host: { '[class.has-selected]': '!!selectedConversationId()' },
  template: `
    <aside class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Chat</span>
        <div class="header-actions">
          <div class="icon-btn-wrap">
            <button mat-icon-button matTooltip="Convites" (click)="togglePanel()" style="color:#c0c1ff">
              <mat-icon>mark_email_unread</mat-icon>
            </button>
            @if (pendingInvitesCount() > 0) {
              <span class="badge-small">{{ pendingInvitesCount() }}</span>
            }
          </div>
          <button mat-icon-button matTooltip="Nova conversa" (click)="openDirectory()" style="color:#c0c1ff">
            <mat-icon>add</mat-icon>
          </button>
        </div>
      </div>
      @if (showInvites()) {
        <app-invites-panel (closed)="showInvites.set(false)" (accepted)="onInviteAccepted($event)" />
      } @else {
        <app-conversation-list [selectedId]="selectedConversationId()" (select)="onSelect($event)" />
      }
    </aside>
    <main class="main">
      @if (selectedConversationId()) {
        <app-thread [conversationId]="selectedConversationId()!" />
      } @else {
        <div class="empty">Selecione uma conversa ou inicie uma nova.</div>
      }
    </main>
  `
})
export class ChatPageComponent implements OnInit, OnDestroy {
  private chat = inject(ChatService);
  private ws = inject(WsService);
  private dialog = inject(MatDialog);

  selectedConversationId = signal<string | null>(null);
  showInvites = signal(false);
  pendingInvitesCount = signal(0);
  private subs = new Subscription();

  ngOnInit() {
    this.refreshInvitesCount();
    this.subs.add(this.ws.chatInvitationReceived$.subscribe(() => this.refreshInvitesCount()));
    this.subs.add(this.ws.chatInvitationAccepted$.subscribe(({ conversation_id }) => {
      this.selectedConversationId.set(conversation_id);
      this.refreshInvitesCount();
    }));
  }

  ngOnDestroy() { this.subs.unsubscribe(); }

  onSelect(id: string) {
    this.selectedConversationId.set(id);
    this.showInvites.set(false);
  }

  togglePanel() { this.showInvites.update(v => !v); }

  openDirectory() {
    const ref = this.dialog.open(DirectoryModalComponent, {
      width: '640px',
      panelClass: 'dark-dialog',
      autoFocus: false
    });
    ref.afterClosed().subscribe(() => this.refreshInvitesCount());
  }

  onInviteAccepted(conversationId: string) {
    this.selectedConversationId.set(conversationId);
    this.showInvites.set(false);
    this.refreshInvitesCount();
  }

  private refreshInvitesCount() {
    this.chat.listInvitations('incoming').subscribe({
      next: (res) => {
        const pending = res.results.filter(i => i.status === 'pending').length;
        this.pendingInvitesCount.set(pending);
      }
    });
  }
}
