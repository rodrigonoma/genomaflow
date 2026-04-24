import { Component, Input, OnInit, OnChanges, OnDestroy, SimpleChanges, ViewChild, ElementRef, inject, signal, AfterViewChecked } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import { ChatService } from './chat.service';
import { WsService } from '../../core/ws/ws.service';
import { AuthService } from '../../core/auth/auth.service';
import { InterTenantMessage, InterTenantConversation } from '../../shared/models/chat.models';
import { AiAnalysisCardComponent } from './ai-analysis-card.component';
import { AiAnalysisPickerComponent } from './ai-analysis-picker.component';
import { PdfAttachmentCardComponent } from './pdf-attachment-card.component';

@Component({
  selector: 'app-thread',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, MatIconModule, MatButtonModule, MatTooltipModule,
            MatDialogModule, MatSnackBarModule, AiAnalysisCardComponent, PdfAttachmentCardComponent],
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
    .header {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.875rem 1.5rem;
      border-bottom: 1px solid rgba(70,69,84,0.15);
      background: #0b1326;
    }
    .header-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1rem; color: #dae2fd; flex: 1;
    }
    .header-module {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.08em;
      padding: 2px 8px; border-radius: 3px;
      background: rgba(192,193,255,0.08); color: #c0c1ff;
    }
    .messages {
      flex: 1; overflow-y: auto; padding: 1rem 1.5rem;
      display: flex; flex-direction: column; gap: 0.5rem;
    }
    .empty { text-align: center; color: #7c7b8f; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; margin-top: 2rem; }
    .bubble-wrap { display: flex; flex-direction: column; max-width: 70%; align-self: flex-start; gap: 0.25rem; }
    .bubble-wrap.own { align-self: flex-end; align-items: flex-end; }
    .bubble {
      padding: 0.625rem 0.875rem;
      border-radius: 8px; position: relative;
      font-size: 0.875rem; line-height: 1.4; color: #dae2fd;
      white-space: pre-wrap; word-wrap: break-word;
    }
    .bubble.incoming { background: #171f33; border-top-left-radius: 0; }
    .bubble.outgoing { background: #494bd6; border-top-right-radius: 0; color: #fff; }
    .attach-btn { color: #c0c1ff; }
    .bubble-date {
      display: block; margin-top: 0.25rem;
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      opacity: 0.6;
    }
    .input-row {
      display: flex; gap: 0.5rem; align-items: flex-end;
      padding: 0.875rem 1.25rem;
      border-top: 1px solid rgba(70,69,84,0.15);
      background: #0b1326;
    }
    .input-row textarea {
      flex: 1; resize: none; min-height: 40px; max-height: 200px;
      padding: 0.5rem 0.875rem; font-size: 0.875rem;
      font-family: inherit; color: #dae2fd;
      background: #171f33; border: 1px solid rgba(70,69,84,0.25);
      border-radius: 6px; outline: none;
    }
    .input-row textarea:focus { border-color: #c0c1ff; }
    .send-btn { color: #c0c1ff; }
    .send-btn[disabled] { opacity: 0.4; }
  `],
  template: `
    @if (conv()) {
      <div class="header">
        <span class="header-title">{{ conv()!.counterpart_name }}</span>
        <span class="header-module">{{ conv()!.module === 'veterinary' ? 'VET' : 'HUMAN' }}</span>
      </div>
    }
    <div class="messages" #messagesBox>
      @if (messages().length === 0) {
        <div class="empty">Envie a primeira mensagem desta conversa.</div>
      }
      @for (m of messages(); track m.id) {
        <div class="bubble-wrap" [class.own]="m.sender_tenant_id === ownTenantId">
          <div class="bubble" [class.incoming]="m.sender_tenant_id !== ownTenantId" [class.outgoing]="m.sender_tenant_id === ownTenantId">
            @if (m.body) { {{ m.body }} }
            <span class="bubble-date">{{ m.created_at | date:'dd/MM HH:mm' }}</span>
          </div>
          @for (att of m.attachments ?? []; track att.id) {
            @if (att.kind === 'ai_analysis_card' && att.payload) {
              <app-ai-analysis-card [payload]="$any(att.payload)" />
            } @else if (att.kind === 'pdf') {
              <app-pdf-attachment-card [attachment]="att" />
            }
          }
        </div>
      }
    </div>
    <div class="input-row">
      <input #fileInput type="file" accept="application/pdf" style="display:none"
             (change)="onPdfPicked($any($event.target))"/>
      <button mat-icon-button class="attach-btn" (click)="fileInput.click()" matTooltip="Anexar PDF" [disabled]="sending">
        <mat-icon>attach_file</mat-icon>
      </button>
      <button mat-icon-button class="attach-btn" (click)="onAttachAiAnalysis()" matTooltip="Anexar análise IA" [disabled]="sending">
        <mat-icon>insights</mat-icon>
      </button>
      <textarea [(ngModel)]="draft" placeholder="Mensagem…"
        (keydown.enter)="onEnter($any($event))"></textarea>
      <button mat-icon-button class="send-btn" [disabled]="!canSend()" (click)="onSend()" matTooltip="Enviar (Enter)">
        <mat-icon>send</mat-icon>
      </button>
    </div>
  `
})
export class ThreadComponent implements OnInit, OnChanges, OnDestroy, AfterViewChecked {
  @Input() conversationId!: string;
  @ViewChild('messagesBox') messagesBox!: ElementRef<HTMLDivElement>;

  private chat = inject(ChatService);
  private ws = inject(WsService);
  private auth = inject(AuthService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  messages = signal<InterTenantMessage[]>([]);
  conv = signal<InterTenantConversation | null>(null);
  draft = '';
  sending = false;
  private subs = new Subscription();
  private shouldScroll = false;
  get ownTenantId() { return this.auth.currentUser?.tenant_id; }

  canSend(): boolean { return !!this.draft.trim() && !this.sending; }

  onEnter(event: KeyboardEvent): void {
    if (event.shiftKey) return;
    event.preventDefault();
    this.onSend();
  }

  ngOnInit() {
    this.loadConversation();
    this.loadMessages();
    this.subs.add(this.ws.chatMessageReceived$.subscribe((msg) => {
      if (msg.conversation_id === this.conversationId) {
        this.loadMessages();
        this.markRead();
      }
    }));
  }

  ngOnChanges(ch: SimpleChanges) {
    if (ch['conversationId'] && !ch['conversationId'].firstChange) {
      this.loadConversation();
      this.loadMessages();
    }
  }

  ngAfterViewChecked() {
    if (this.shouldScroll && this.messagesBox) {
      this.messagesBox.nativeElement.scrollTop = this.messagesBox.nativeElement.scrollHeight;
      this.shouldScroll = false;
    }
  }

  ngOnDestroy() { this.subs.unsubscribe(); }

  private loadConversation() {
    this.chat.getConversation(this.conversationId).subscribe({ next: (c) => this.conv.set(c) });
  }

  private loadMessages() {
    this.chat.listMessages(this.conversationId, { limit: 100 }).subscribe({
      next: (res) => {
        // API retorna DESC (mais recente primeiro) — queremos ordem cronológica pra scroll bottom
        this.messages.set([...res.results].reverse());
        this.shouldScroll = true;
        this.markRead();
      }
    });
  }

  private markRead() {
    this.chat.markRead(this.conversationId).subscribe({ next: () => {}, error: () => {} });
  }

  onSend() {
    if (!this.canSend()) return;
    const body = this.draft.trim();
    this.sending = true;
    this.chat.sendMessage(this.conversationId, { body }).subscribe({
      next: (msg) => {
        this.messages.update(arr => [...arr, msg]);
        this.draft = '';
        this.sending = false;
        this.shouldScroll = true;
      },
      error: () => { this.sending = false; }
    });
  }

  onPdfPicked(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      this.snack.open('Apenas PDF é suportado nesta fase.', 'Fechar', { duration: 4000 });
      input.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.snack.open('PDF excede 10MB.', 'Fechar', { duration: 4000 });
      input.value = '';
      return;
    }

    this.sending = true;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || result;
      const body = this.draft.trim() || undefined;
      this.chat.sendMessage(this.conversationId, {
        body,
        pdf: { filename: file.name, data_base64: base64, mime_type: 'application/pdf' }
      }).subscribe({
        next: (msg) => {
          this.messages.update(arr => [...arr, msg]);
          this.draft = '';
          this.sending = false;
          this.shouldScroll = true;
          input.value = '';
          this.snack.open('PDF anexado.', '', { duration: 2500 });
        },
        error: (err) => {
          this.sending = false;
          input.value = '';
          const e = err.error || {};
          if (e.detected_kinds?.length) {
            this.snack.open(
              `PDF bloqueado — detectados: ${e.detected_kinds.join(', ')}. Remova dados pessoais e tente novamente.`,
              'Fechar',
              { duration: 8000, panelClass: ['snack-error'] }
            );
          } else {
            this.snack.open(e.error || 'Erro ao anexar PDF.', 'Fechar', { duration: 5000 });
          }
        }
      });
    };
    reader.onerror = () => {
      this.sending = false;
      this.snack.open('Erro ao ler o arquivo.', 'Fechar', { duration: 4000 });
    };
    reader.readAsDataURL(file);
  }

  onAttachAiAnalysis() {
    const ref = this.dialog.open(AiAnalysisPickerComponent, {
      width: '560px',
      panelClass: 'dark-dialog',
      autoFocus: false,
    });
    ref.afterClosed().subscribe((result: { exam_id: string; agent_types: string[] } | null | undefined) => {
      if (!result) return;
      this.sending = true;
      const body = this.draft.trim() || undefined;
      this.chat.sendMessage(this.conversationId, { body, ai_analysis_card: result }).subscribe({
        next: (msg) => {
          this.messages.update(arr => [...arr, msg]);
          this.draft = '';
          this.sending = false;
          this.shouldScroll = true;
          this.snack.open('Análise anexada.', '', { duration: 2500 });
        },
        error: (err) => {
          this.sending = false;
          this.snack.open(err.error?.error || 'Erro ao anexar.', 'Fechar', { duration: 5000 });
        }
      });
    });
  }
}
