import { Component, EventEmitter, Output, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import { ChatService } from './chat.service';
import { WsService } from '../../core/ws/ws.service';
import { InterTenantInvitation } from '../../shared/models/chat.models';

@Component({
  selector: 'app-invites-panel',
  standalone: true,
  imports: [CommonModule, DatePipe, MatIconModule, MatButtonModule, MatSnackBarModule],
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1; overflow-y: auto; }
    .panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid rgba(70,69,84,0.15);
    }
    .tabs {
      display: flex; gap: 0;
      border-bottom: 1px solid rgba(70,69,84,0.15);
    }
    .tab {
      flex: 1; padding: 0.625rem; text-align: center;
      background: transparent; border: none;
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: #7c7b8f; cursor: pointer;
      border-bottom: 2px solid transparent;
    }
    .tab.active { color: #c0c1ff; border-bottom-color: #c0c1ff; }
    .empty { padding: 2rem; text-align: center; color: #7c7b8f; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; }
    .item {
      padding: 0.875rem 1.25rem;
      border-bottom: 1px solid rgba(70,69,84,0.1);
      display: flex; flex-direction: column; gap: 0.5rem;
    }
    .name { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 0.9375rem; color: #dae2fd; }
    .date { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #7c7b8f; }
    .msg { font-size: 0.8125rem; color: #908fa0; font-style: italic; }
    .actions { display: flex; gap: 0.5rem; margin-top: 0.25rem; }
    .status-pill {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.08em;
      padding: 2px 6px; border-radius: 3px; align-self: flex-start;
    }
    .status-pending { background: rgba(192,193,255,0.1); color: #c0c1ff; }
    .status-accepted { background: rgba(74,214,160,0.1); color: #4ad6a0; }
    .status-rejected { background: rgba(255,180,171,0.1); color: #ffb4ab; }
    .status-cancelled { background: rgba(124,123,143,0.1); color: #7c7b8f; }
    .close-btn { color: #7c7b8f; }
  `],
  template: `
    <div class="panel-header">
      <span style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:1rem;color:#dae2fd">Convites</span>
      <button mat-icon-button class="close-btn" (click)="closed.emit()">
        <mat-icon>close</mat-icon>
      </button>
    </div>
    <div class="tabs">
      <button class="tab" [class.active]="direction()==='incoming'" (click)="switchDirection('incoming')">Recebidos</button>
      <button class="tab" [class.active]="direction()==='outgoing'" (click)="switchDirection('outgoing')">Enviados</button>
    </div>
    @if (items().length === 0) {
      <div class="empty">
        {{ direction() === 'incoming' ? 'Nenhum convite recebido.' : 'Você não enviou convites.' }}
      </div>
    }
    @for (i of items(); track i.id) {
      <div class="item">
        <span class="name">
          {{ direction() === 'incoming' ? i.from_tenant_name : i.to_tenant_name }}
        </span>
        <span class="date">{{ i.sent_at | date:'dd/MM/yyyy HH:mm' }}</span>
        @if (i.message) { <span class="msg">"{{ i.message }}"</span> }
        <span class="status-pill" [class.status-pending]="i.status==='pending'"
              [class.status-accepted]="i.status==='accepted'"
              [class.status-rejected]="i.status==='rejected'"
              [class.status-cancelled]="i.status==='cancelled'">
          {{ i.status }}
        </span>
        @if (i.status === 'pending') {
          @if (direction() === 'incoming') {
            <div class="actions">
              <button mat-flat-button style="background:#4ad6a0;color:#0b1326;font-weight:700" (click)="accept(i)">
                Aceitar
              </button>
              <button mat-button style="color:#ffb4ab" (click)="reject(i)">Recusar</button>
            </div>
          } @else {
            <div class="actions">
              <button mat-button style="color:#7c7b8f" (click)="cancel(i)">Cancelar convite</button>
            </div>
          }
        }
      </div>
    }
  `
})
export class InvitesPanelComponent implements OnInit, OnDestroy {
  @Output() closed = new EventEmitter<void>();
  @Output() accepted = new EventEmitter<string>();  // emits conversation_id

  private chat = inject(ChatService);
  private ws = inject(WsService);
  private snack = inject(MatSnackBar);

  direction = signal<'incoming' | 'outgoing'>('incoming');
  items = signal<InterTenantInvitation[]>([]);
  private subs = new Subscription();

  ngOnInit() {
    this.refresh();
    this.subs.add(this.ws.chatInvitationReceived$.subscribe(() => this.refresh()));
    this.subs.add(this.ws.chatInvitationAccepted$.subscribe(() => this.refresh()));
  }

  ngOnDestroy() { this.subs.unsubscribe(); }

  switchDirection(d: 'incoming' | 'outgoing') {
    this.direction.set(d);
    this.refresh();
  }

  private refresh() {
    this.chat.listInvitations(this.direction()).subscribe({
      next: (res) => this.items.set(res.results)
    });
  }

  accept(i: InterTenantInvitation) {
    this.chat.acceptInvitation(i.id).subscribe({
      next: (res) => {
        this.snack.open('Convite aceito!', '', { duration: 3000 });
        this.accepted.emit(res.conversation_id);
        this.refresh();
      },
      error: (err) => this.snack.open(err.error?.error || 'Erro.', 'Fechar', { duration: 5000 })
    });
  }

  reject(i: InterTenantInvitation) {
    this.chat.rejectInvitation(i.id).subscribe({
      next: () => { this.snack.open('Convite recusado.', '', { duration: 3000 }); this.refresh(); },
      error: (err) => this.snack.open(err.error?.error || 'Erro.', 'Fechar', { duration: 5000 })
    });
  }

  cancel(i: InterTenantInvitation) {
    this.chat.cancelInvitation(i.id).subscribe({
      next: () => { this.snack.open('Convite cancelado.', '', { duration: 3000 }); this.refresh(); },
      error: (err) => this.snack.open(err.error?.error || 'Erro.', 'Fechar', { duration: 5000 })
    });
  }
}
