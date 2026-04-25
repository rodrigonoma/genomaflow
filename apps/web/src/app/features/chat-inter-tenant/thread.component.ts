import { Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, SimpleChanges, ViewChild, ElementRef, inject, signal, AfterViewChecked } from '@angular/core';
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
import { InterTenantMessage, InterTenantConversation, ChatSearchResult, CHAT_ALLOWED_EMOJIS } from '../../shared/models/chat.models';
import { AiAnalysisCardComponent } from './ai-analysis-card.component';
import { AiAnalysisPickerComponent } from './ai-analysis-picker.component';
import { PdfAttachmentCardComponent } from './pdf-attachment-card.component';
import { ImageAttachmentCardComponent } from './image-attachment-card.component';
import { ImageUploadConfirmComponent } from './image-upload-confirm.component';
import { RedactImageDialogComponent, RedactDialogData, RedactDialogResult } from './redact-image-dialog.component';
import { RedactPdfDialogComponent, RedactPdfDialogData, RedactPdfDialogResult } from './redact-pdf-dialog.component';
import { ReportDialogComponent } from './report-dialog.component';
import { CounterpartContactDialogComponent } from './counterpart-contact-dialog.component';

@Component({
  selector: 'app-thread',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, MatIconModule, MatButtonModule, MatTooltipModule,
            MatDialogModule, MatSnackBarModule, AiAnalysisCardComponent,
            PdfAttachmentCardComponent, ImageAttachmentCardComponent],
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
    .header {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.875rem 1.5rem;
      border-bottom: 1px solid rgba(70,69,84,0.15);
      background: #0b1326;
    }
    .back-btn { color: #c0c1ff; display: none; }
    .header-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1rem; color: #dae2fd; flex: 1;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      min-width: 0;
      cursor: pointer;
      transition: color 150ms;
    }
    .header-title:hover { color: #c0c1ff; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; }
    @media (max-width: 639px) {
      .back-btn { display: inline-flex; }
      .header { padding: 0.75rem 1rem; }
      .messages { padding: 0.75rem 1rem; }
      .bubble-wrap { max-width: 85%; }
      .bubble-wrap .react-btn { display: none; }
      .input-row { padding: 0.625rem 0.75rem; gap: 0.25rem; }
      .search-row { padding: 0.5rem 1rem; }
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
    .bubble-wrap { display: flex; flex-direction: column; max-width: 70%; align-self: flex-start; gap: 0.25rem; position: relative; }
    .bubble-wrap.own { align-self: flex-end; align-items: flex-end; }
    .bubble-wrap:hover .react-btn { opacity: 1; }
    .react-btn {
      position: absolute; top: 0; right: -32px;
      width: 28px; height: 28px; border-radius: 14px;
      background: #171f33; border: 1px solid rgba(70,69,84,0.3);
      cursor: pointer; opacity: 0; transition: opacity 150ms;
      display: flex; align-items: center; justify-content: center;
      color: #c0c1ff;
    }
    .bubble-wrap.own .react-btn { right: auto; left: -32px; }
    .react-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .emoji-picker {
      position: absolute; top: 30px; z-index: 10;
      background: #171f33; border: 1px solid rgba(70,69,84,0.3);
      border-radius: 6px; padding: 0.375rem;
      display: flex; gap: 0.25rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    .bubble-wrap:not(.own) .emoji-picker { left: -32px; }
    .bubble-wrap.own .emoji-picker { right: -32px; }
    .emoji-btn {
      width: 28px; height: 28px; border-radius: 4px;
      background: transparent; border: none; cursor: pointer;
      font-size: 16px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
    }
    .emoji-btn:hover { background: rgba(192,193,255,0.1); }
    .reactions {
      display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.125rem;
    }
    .reaction-chip {
      display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 2px 7px; border-radius: 10px;
      font-size: 11px;
      background: rgba(70,69,84,0.25); border: 1px solid transparent;
      cursor: pointer;
    }
    .reaction-chip.mine {
      background: rgba(192,193,255,0.15);
      border-color: #c0c1ff;
    }
    .reaction-chip:hover { background: rgba(70,69,84,0.4); }
    .reaction-chip .count {
      font-family: 'JetBrains Mono', monospace; font-weight: 600;
      color: #dae2fd;
    }
    /* Search bar */
    .search-row {
      padding: 0.5rem 1.5rem; background: #111929;
      border-bottom: 1px solid rgba(70,69,84,0.15);
      display: flex; gap: 0.5rem; align-items: center;
    }
    .search-row input {
      flex: 1; background: #171f33; color: #dae2fd;
      border: 1px solid rgba(70,69,84,0.25); border-radius: 4px;
      padding: 0.375rem 0.75rem; font-size: 0.8125rem; outline: none;
      font-family: inherit;
    }
    .search-row input:focus { border-color: #c0c1ff; }
    .search-results {
      max-height: 240px; overflow-y: auto;
      background: #0b1326; border-bottom: 1px solid rgba(70,69,84,0.15);
    }
    .search-result {
      padding: 0.625rem 1.5rem; cursor: pointer;
      border-bottom: 1px solid rgba(70,69,84,0.08);
      font-size: 0.8125rem; color: #dae2fd;
    }
    .search-result:hover { background: #131b2e; }
    .search-result .snippet mark {
      background: rgba(255,203,107,0.2); color: #ffcb6b;
      font-weight: 600;
    }
    .search-result .when {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #7c7b8f; margin-top: 0.25rem;
    }
    .new-msg-chip {
      position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
      background: #494bd6; color: #fff;
      padding: 0.375rem 0.875rem; border-radius: 16px;
      font-size: 0.8125rem; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      display: flex; align-items: center; gap: 0.375rem;
      z-index: 5;
    }
    .new-msg-chip:hover { background: #5a5cf0; }
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
        <button mat-icon-button class="back-btn" (click)="back.emit()" matTooltip="Voltar">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <span class="header-title"
              matTooltip="Ver contato da clínica"
              (click)="openContact()">{{ conv()!.counterpart_name }}</span>
        <span class="header-module">{{ conv()!.module === 'veterinary' ? 'VET' : 'HUMAN' }}</span>
        <button mat-icon-button style="color:#c0c1ff" (click)="toggleSearch()" matTooltip="Buscar">
          <mat-icon>{{ searchOpen() ? 'close' : 'search' }}</mat-icon>
        </button>
        <button mat-icon-button style="color:#ffb4ab" (click)="onReport()" matTooltip="Reportar clínica">
          <mat-icon>flag</mat-icon>
        </button>
      </div>
    }
    @if (searchOpen()) {
      <div class="search-row">
        <mat-icon style="color:#7c7b8f;font-size:18px;width:18px;height:18px">search</mat-icon>
        <input #searchInput [(ngModel)]="searchQuery" placeholder="Buscar na conversa…"
               (input)="onSearchInput()" (keydown.escape)="toggleSearch()"/>
      </div>
      @if (searchResults().length > 0) {
        <div class="search-results">
          @for (r of searchResults(); track r.id) {
            <div class="search-result" (click)="scrollToMessage(r.id)">
              <div class="snippet" [innerHTML]="r.snippet"></div>
              <div class="when">{{ r.created_at | date:'dd/MM/yyyy HH:mm' }}</div>
            </div>
          }
        </div>
      }
    }
    <div class="messages" #messagesBox (scroll)="onMessagesScroll()">
      @if (messages().length === 0) {
        <div class="empty">Envie a primeira mensagem desta conversa.</div>
      }
      @for (m of messages(); track m.id) {
        <div class="bubble-wrap" [class.own]="m.sender_tenant_id === ownTenantId" [attr.data-msg-id]="m.id">
          <div class="bubble" [class.incoming]="m.sender_tenant_id !== ownTenantId" [class.outgoing]="m.sender_tenant_id === ownTenantId">
            @if (m.body) { {{ m.body }} }
            <span class="bubble-date">{{ m.created_at | date:'dd/MM HH:mm' }}</span>
          </div>
          @for (att of m.attachments ?? []; track att.id) {
            @if (att.kind === 'ai_analysis_card' && att.payload) {
              <app-ai-analysis-card [payload]="$any(att.payload)" />
            } @else if (att.kind === 'pdf') {
              <app-pdf-attachment-card [attachment]="att" />
            } @else if (att.kind === 'image') {
              <app-image-attachment-card [attachment]="att" />
            }
          }
          @if (m.reactions?.length) {
            <div class="reactions">
              @for (r of m.reactions; track r.emoji) {
                <span class="reaction-chip" [class.mine]="r.reacted_by_me" (click)="onReactClick(m, r.emoji)">
                  <span>{{ r.emoji }}</span><span class="count">{{ r.count }}</span>
                </span>
              }
            </div>
          }
          <button class="react-btn" (click)="togglePicker(m.id)" aria-label="Reagir">
            <mat-icon>add_reaction</mat-icon>
          </button>
          @if (pickerOpenFor() === m.id) {
            <div class="emoji-picker">
              @for (e of ALLOWED_EMOJIS; track e) {
                <button class="emoji-btn" (click)="onReactClick(m, e)">{{ e }}</button>
              }
            </div>
          }
        </div>
      }
      @if (newMessagesCount() > 0) {
        <div class="new-msg-chip" (click)="scrollToBottom()">
          <mat-icon style="font-size:16px;width:16px;height:16px">arrow_downward</mat-icon>
          {{ newMessagesCount() }} nova{{ newMessagesCount() > 1 ? 's' : '' }}
        </div>
      }
    </div>
    <div class="input-row">
      <input #pdfInput type="file" accept="application/pdf" style="display:none"
             (change)="onPdfPicked($any($event.target))"/>
      <input #imgInput type="file" accept="image/png,image/jpeg" style="display:none"
             (change)="onImagePicked($any($event.target))"/>
      <button mat-icon-button class="attach-btn" (click)="pdfInput.click()" matTooltip="Anexar PDF" [disabled]="sending">
        <mat-icon>attach_file</mat-icon>
      </button>
      <button mat-icon-button class="attach-btn" (click)="imgInput.click()" matTooltip="Anexar imagem" [disabled]="sending">
        <mat-icon>image</mat-icon>
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
  @Output() back = new EventEmitter<void>();
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
  private searchDebounce: any = null;

  searchOpen = signal(false);
  searchQuery = '';
  searchResults = signal<ChatSearchResult[]>([]);

  pickerOpenFor = signal<string | null>(null);
  readonly ALLOWED_EMOJIS = CHAT_ALLOWED_EMOJIS;

  newMessagesCount = signal(0);
  private userNearBottom = true;

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
        if (this.userNearBottom) {
          this.loadMessages();
          this.markRead();
        } else {
          this.newMessagesCount.update(n => n + 1);
        }
      }
    }));
    this.subs.add(this.ws.chatReactionChanged$.subscribe((r) => {
      if (r.conversation_id === this.conversationId) {
        // refresh mensagens pra pegar reactions atualizadas
        this.loadMessages(/*preserveScroll*/ true);
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

  private loadMessages(preserveScroll = false) {
    this.chat.listMessages(this.conversationId, { limit: 100 }).subscribe({
      next: (res) => {
        this.messages.set([...res.results].reverse());
        if (!preserveScroll) this.shouldScroll = true;
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

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || result;

      // Abrir modal de redação de PII com revisão por página
      const dialogData: RedactPdfDialogData = {
        filename: file.name,
        data_base64: base64,
      };
      const redactRef = this.dialog.open<RedactPdfDialogComponent, RedactPdfDialogData, RedactPdfDialogResult | null>(
        RedactPdfDialogComponent,
        {
          width: '900px',
          maxWidth: '95vw',
          panelClass: 'dark-dialog',
          autoFocus: false,
          disableClose: true,
          data: dialogData,
        }
      );
      redactRef.afterClosed().subscribe((res) => {
        input.value = '';
        if (!res) return;

        this.sending = true;
        const body = this.draft.trim() || undefined;
        this.chat.sendMessage(this.conversationId, {
          body,
          pdf: { filename: res.filename, data_base64: res.data_base64, mime_type: 'application/pdf' }
        }).subscribe({
          next: (msg) => {
            this.messages.update(arr => [...arr, msg]);
            this.draft = '';
            this.sending = false;
            this.shouldScroll = true;
            this.snack.open(
              `PDF anexado (${res.page_count} páginas, ${res.total_auto_regions - res.total_manual_removed + res.total_manual_added} blocos aplicados).`,
              '', { duration: 4000 }
            );
          },
          error: (err) => {
            this.sending = false;
            const e = err.error || {};
            if (e.detected_kinds?.length) {
              // Esse caso fica como backstop — PDF redigido não deveria mais ter PII detectável.
              // Se cair aqui, há sinal de bug na pipeline; logar e avisar.
              this.snack.open(
                `Mesmo após redação, o PDF ainda tem PII detectável: ${e.detected_kinds.join(', ')}. Reveja e tente de novo.`,
                'Fechar',
                { duration: 8000, panelClass: ['snack-error'] }
              );
            } else {
              this.snack.open(e.error || 'Erro ao anexar PDF.', 'Fechar', { duration: 5000 });
            }
          }
        });
      });
    };
    reader.onerror = () => {
      this.snack.open('Erro ao ler o arquivo.', 'Fechar', { duration: 4000 });
    };
    reader.readAsDataURL(file);
  }

  onMessagesScroll() {
    if (!this.messagesBox) return;
    const el = this.messagesBox.nativeElement;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.userNearBottom = distanceToBottom < 80;
    if (this.userNearBottom && this.newMessagesCount() > 0) {
      this.newMessagesCount.set(0);
    }
  }

  scrollToBottom() {
    if (!this.messagesBox) return;
    this.messagesBox.nativeElement.scrollTop = this.messagesBox.nativeElement.scrollHeight;
    this.newMessagesCount.set(0);
    this.loadMessages();
    this.markRead();
  }

  scrollToMessage(messageId: string) {
    setTimeout(() => {
      if (!this.messagesBox) return;
      const el = this.messagesBox.nativeElement.querySelector(`[data-msg-id="${messageId}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'background 600ms';
        el.style.background = 'rgba(192,193,255,0.1)';
        setTimeout(() => { el.style.background = ''; }, 1200);
      } else {
        // mensagem não está carregada — poderia implementar "jump to context"
        this.snack.open('Mensagem antiga. Role pra cima pra carregar mais.', '', { duration: 3000 });
      }
    }, 50);
    this.searchOpen.set(false);
  }

  onReport() {
    const c = this.conv();
    if (!c) return;
    this.dialog.open(ReportDialogComponent, {
      width: '520px',
      panelClass: 'dark-dialog',
      autoFocus: false,
      data: { reported_tenant_id: c.counterpart_tenant_id, reported_tenant_name: c.counterpart_name }
    });
  }

  openContact() {
    const c = this.conv();
    if (!c) return;
    this.dialog.open(CounterpartContactDialogComponent, {
      autoFocus: false,
      data: { conversation_id: this.conversationId, counterpart_name: c.counterpart_name }
    });
  }

  toggleSearch() {
    this.searchOpen.update(v => !v);
    if (!this.searchOpen()) {
      this.searchQuery = '';
      this.searchResults.set([]);
    }
  }

  onSearchInput() {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    const q = this.searchQuery.trim();
    if (q.length < 2) {
      this.searchResults.set([]);
      return;
    }
    this.searchDebounce = setTimeout(() => {
      this.chat.searchMessages(this.conversationId, q).subscribe({
        next: (res) => this.searchResults.set(res.results),
        error: () => this.searchResults.set([])
      });
    }, 300);
  }

  togglePicker(messageId: string) {
    this.pickerOpenFor.update(cur => cur === messageId ? null : messageId);
  }

  onReactClick(msg: InterTenantMessage, emoji: string) {
    this.pickerOpenFor.set(null);
    this.chat.toggleReaction(msg.id, emoji).subscribe({
      next: () => this.loadMessages(/*preserveScroll*/ true),
      error: (err) => this.snack.open(err.error?.error || 'Erro ao reagir.', 'Fechar', { duration: 4000 })
    });
  }

  onImagePicked(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      this.snack.open('Apenas PNG ou JPG.', 'Fechar', { duration: 4000 });
      input.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.snack.open('Imagem excede 10MB.', 'Fechar', { duration: 4000 });
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || dataUrl;

      // Novo fluxo: OCR + redação automática + revisão visual com canvas editor
      const dialogData: RedactDialogData = {
        filename: file.name,
        mime_type: file.type,
        data_base64: base64,
      };
      const redactRef = this.dialog.open<RedactImageDialogComponent, RedactDialogData, RedactDialogResult | null>(
        RedactImageDialogComponent,
        {
          width: '900px',
          maxWidth: '95vw',
          panelClass: 'dark-dialog',
          autoFocus: false,
          disableClose: true,
          data: dialogData,
        }
      );
      redactRef.afterClosed().subscribe((result) => {
        input.value = '';
        if (!result) return; // cancelou

        this.sending = true;
        const body = this.draft.trim() || undefined;
        this.chat.sendMessage(this.conversationId, {
          body,
          image: {
            filename: result.filename,
            data_base64: result.data_base64,  // imagem já redigida pelo canvas
            mime_type: result.mime_type as 'image/png' | 'image/jpeg',
            user_confirmed_anonymized: true,
          }
        }).subscribe({
          next: (msg) => {
            this.messages.update(arr => [...arr, msg]);
            this.draft = '';
            this.sending = false;
            this.shouldScroll = true;
            this.snack.open(
              `Imagem anexada. Blocos: ${result.auto_regions - result.manual_removed} auto + ${result.manual_added} manual.`,
              '', { duration: 3500 }
            );
          },
          error: (err) => {
            this.sending = false;
            this.snack.open(err.error?.error || 'Erro ao anexar imagem.', 'Fechar', { duration: 5000 });
          }
        });
      });
    };
    reader.onerror = () => this.snack.open('Erro ao ler imagem.', 'Fechar', { duration: 4000 });
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
