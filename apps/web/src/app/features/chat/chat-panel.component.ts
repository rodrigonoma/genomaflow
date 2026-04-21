// apps/web/src/app/features/chat/chat-panel.component.ts
import { Component, inject, OnInit, ViewChild, ElementRef, AfterViewChecked, Output, EventEmitter } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HttpClient } from '@angular/common/http';
import { ChatService, ChatMessage, ChatSource } from './chat.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatButtonModule, MatTooltipModule],
  styles: [`
    :host { display: contents; }

    .chat-panel {
      position: fixed; top: 56px; right: 0; bottom: 0;
      width: 420px;
      background: #0f1729;
      border-left: 1px solid rgba(70,69,84,0.25);
      display: flex; flex-direction: column;
      z-index: 200;
      animation: slideIn 180ms cubic-bezier(0.4,0,0.2,1);
    }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }

    .panel-header {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(70,69,84,0.2);
      flex-shrink: 0;
    }
    .panel-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 0.9rem; color: #c0c1ff;
      flex: 1;
    }

    .messages {
      flex: 1; overflow-y: auto;
      padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;
    }

    .msg {
      max-width: 90%;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 0.8rem; line-height: 1.5;
      border-radius: 8px; padding: 0.625rem 0.875rem;
    }
    .msg-user {
      align-self: flex-end;
      background: #494bd6; color: #fff;
    }
    .msg-assistant {
      align-self: flex-start;
      background: #111929; color: #dae2fd;
      border: 1px solid rgba(70,69,84,0.2);
    }

    .sources {
      margin-top: 0.5rem;
      display: flex; flex-wrap: wrap; gap: 0.375rem;
    }
    .source-chip {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; color: #a09fb2;
      background: rgba(73,75,214,0.12);
      border: 1px solid rgba(73,75,214,0.25);
      border-radius: 4px; padding: 2px 6px;
      cursor: default;
    }

    .msg p  { margin: 0 0 0.25rem; }
    .msg p:last-child { margin-bottom: 0; }
    .msg ul { margin: 0.25rem 0 0; padding-left: 1.1rem; }
    .msg li { margin-bottom: 0.2rem; }
    .msg br { display: block; content: ''; margin: 0.15rem 0; }

    .loading-dots {
      align-self: flex-start;
      padding: 0.5rem 0.875rem;
      color: #6e6d80;
      font-size: 1.2rem; letter-spacing: 2px;
    }

    .credit-strip {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.375rem 1rem;
      border-bottom: 1px solid rgba(70,69,84,0.15);
      background: rgba(73,75,214,0.06);
      flex-shrink: 0;
    }
    .credit-strip mat-icon { font-size: 13px; width: 13px; height: 13px; color: #c0c1ff; }
    .credit-strip-label {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #6e6d80; flex: 1;
    }
    .credit-strip-val {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      font-weight: 700; color: #c0c1ff;
    }
    .credit-strip-val.low   { color: #ffb783; }
    .credit-strip-val.empty { color: #ffb4ab; }
    .credit-strip-cost {
      font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #6e6d80;
    }

    .input-area {
      padding: 0.75rem 1rem;
      border-top: 1px solid rgba(70,69,84,0.2);
      display: flex; gap: 0.5rem; align-items: flex-end;
      flex-shrink: 0;
    }
    textarea {
      flex: 1; resize: none;
      background: #111929;
      border: 1px solid rgba(70,69,84,0.3);
      border-radius: 6px; color: #dae2fd;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 0.8rem; padding: 0.5rem 0.75rem;
      outline: none; min-height: 38px; max-height: 120px;
    }
    textarea:focus { border-color: #494bd6; }
    textarea::placeholder { color: #6e6d80; }
  `],
  template: `
    <aside class="chat-panel">
      <div class="panel-header">
        <mat-icon style="color:#c0c1ff;font-size:18px;width:18px;height:18px">smart_toy</mat-icon>
        <span class="panel-title">Assistente Clínico</span>
        <button mat-icon-button
                matTooltip="Nova conversa"
                style="color:#a09fb2"
                (click)="newSession()">
          <mat-icon style="font-size:16px;width:16px;height:16px">refresh</mat-icon>
        </button>
        <button mat-icon-button
                style="color:#a09fb2"
                (click)="closed.emit()">
          <mat-icon style="font-size:16px;width:16px;height:16px">close</mat-icon>
        </button>
      </div>

      <div class="credit-strip">
        <mat-icon>toll</mat-icon>
        <span class="credit-strip-label">Créditos disponíveis</span>
        @if (balanceLoaded) {
          <span class="credit-strip-val" [class.low]="balance <= 5" [class.empty]="balance === 0">
            {{ balance }}
          </span>
          <span class="credit-strip-cost">· 0,25/pergunta</span>
        } @else {
          <span class="credit-strip-val">—</span>
        }
      </div>

      <div class="messages" #messagesContainer>
        @for (msg of messages; track $index) {
          <div [class]="'msg ' + (msg.role === 'user' ? 'msg-user' : 'msg-assistant')"
               [innerHTML]="formatMsg(msg.content)">
            @if (msg.role === 'assistant' && msg.sources?.length) {
              <div class="sources">
                @for (s of msg.sources!; track $index) {
                  <span class="source-chip"
                        [matTooltip]="s.chunk_excerpt"
                        matTooltipPosition="above">
                    {{ s.source_label }}
                  </span>
                }
              </div>
            }
          </div>
        }
        @if (loading) {
          <div class="loading-dots">···</div>
        }
      </div>

      <div class="input-area">
        <textarea
          [(ngModel)]="input"
          placeholder="Pergunte sobre pacientes, exames ou análises…"
          rows="1"
          (keydown.enter)="onEnter($event)">
        </textarea>
        <button mat-icon-button
                [disabled]="!input.trim() || loading"
                style="color:#c0c1ff"
                (click)="send()">
          <mat-icon>send</mat-icon>
        </button>
      </div>
    </aside>
  `
})
export class ChatPanelComponent implements OnInit, AfterViewChecked {
  @ViewChild('messagesContainer') private messagesEl!: ElementRef<HTMLDivElement>;

  private chatService = inject(ChatService);
  private http        = inject(HttpClient);
  private sanitizer   = inject(DomSanitizer);

  messages: ChatMessage[] = [];
  input    = '';
  loading  = false;
  sessionId: string | undefined;
  balance = 0;
  balanceLoaded = false;

  @Output() closed = new EventEmitter<void>();

  ngOnInit(): void { this.loadBalance(); }

  private loadBalance(): void {
    this.http.get<{ balance: number }>(`${environment.apiUrl}/billing/balance`)
      .subscribe({ next: r => { this.balance = r.balance; this.balanceLoaded = true; }, error: () => { this.balanceLoaded = true; } });
  }

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  private scrollToBottom() {
    try {
      const el = this.messagesEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    } catch (_) {}
  }

  onEnter(event: Event) {
    const ke = event as KeyboardEvent;
    if (!ke.shiftKey) {
      ke.preventDefault();
      this.send();
    }
  }

  send() {
    const question = this.input.trim();
    if (!question || this.loading) return;

    this.messages.push({ role: 'user', content: question });
    this.input   = '';
    this.loading = true;

    this.chatService.sendMessage(question, this.sessionId).subscribe({
      next: (res) => {
        this.sessionId = res.session_id;
        this.messages.push({
          role: 'assistant',
          content: res.answer,
          sources: res.sources
        });
        this.loading = false;
        this.loadBalance();
      },
      error: (err) => {
        const msg = err.status === 402
          ? 'Créditos insuficientes. Recarregue seu saldo para continuar.'
          : 'Ocorreu um erro ao processar sua pergunta. Tente novamente.';
        this.messages.push({ role: 'assistant', content: msg });
        this.loading = false;
        this.loadBalance();
      }
    });
  }

  formatMsg(text: string): SafeHtml {
    const escaped = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const lines = escaped.split('\n');
    let html = '';
    let inList = false;

    for (const raw of lines) {
      const line = raw.trimEnd();
      const isBullet = /^[-*•]\s+/.test(line);

      if (isBullet) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${this.inlineFormat(line.replace(/^[-*•]\s+/, ''))}</li>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (line === '') {
          html += '<br>';
        } else {
          html += `<p>${this.inlineFormat(line)}</p>`;
        }
      }
    }
    if (inList) html += '</ul>';

    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private inlineFormat(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>');
  }

  newSession() {
    if (this.sessionId) {
      this.chatService.clearSession(this.sessionId).subscribe({ error: () => {} });
    }
    this.sessionId = undefined;
    this.messages  = [];
  }
}
