import { Component, EventEmitter, Output, inject, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HelpContextService } from '../../core/help-context/help-context.service';
import { ProductHelpService, HelpAction, HistoryMessage } from './product-help.service';
import { VoiceInputService } from './voice-input.service';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ source: string; title: string; score: number }>;
  actions?: HelpAction[];
  toolEvents?: Array<{ tool: string; ok?: boolean }>;
  streaming?: boolean;
}

@Component({
  selector: 'app-product-help-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatTooltipModule],
  styles: [`
    :host { position:fixed;top:56px;right:0;bottom:0;width:380px;max-width:100vw;background:#0b1326;border-left:1px solid rgba(70,69,84,0.25);display:flex;flex-direction:column;z-index:900;box-shadow:-4px 0 20px rgba(0,0,0,0.3);font-family:'Space Grotesk',sans-serif;color:#dae2fd; }
    .header { display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;border-bottom:1px solid rgba(70,69,84,0.2); }
    .header h2 { font-size:0.9375rem;font-weight:700;margin:0;color:#c0c1ff;display:flex;align-items:center;gap:0.5rem; }
    .header-actions { display:flex; gap:0.25rem; }
    .subtitle { font-family:'JetBrains Mono',monospace;font-size:10px;color:#7c7b8f;padding:0 1rem 0.5rem;letter-spacing:0.08em;text-transform:uppercase; }
    .messages { flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:0.75rem; }
    .msg { padding:0.625rem 0.875rem;border-radius:8px;font-size:0.8125rem;line-height:1.45;white-space:pre-wrap;word-wrap:break-word; }
    .msg.user { background:#181e31;align-self:flex-end;max-width:85%; }
    .msg.assistant { background:#111929;border:1px solid rgba(192,193,255,0.08);max-width:95%; }
    .sources { margin-top:0.5rem;font-family:'JetBrains Mono',monospace;font-size:9.5px;color:#7c7b8f; }
    .sources-title { text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.25rem;color:#908fa0; }
    .input-row { padding:0.75rem 1rem;border-top:1px solid rgba(70,69,84,0.2);display:flex;gap:0.5rem;align-items:flex-end; }
    textarea { flex:1;background:#060d1a;color:#dae2fd;border:1px solid rgba(192,193,255,0.12);border-radius:6px;padding:0.625rem 0.75rem;font-family:'JetBrains Mono',monospace;font-size:0.8125rem;resize:none;outline:none;min-height:64px;max-height:140px;line-height:1.45; }
    textarea:focus { border-color:rgba(192,193,255,0.35); }
    .send-btn { background:#c0c1ff;color:#1000a9;border:none;border-radius:6px;padding:0.5rem 0.875rem;font-size:0.75rem;font-weight:700;letter-spacing:0.06em;cursor:pointer;text-transform:uppercase; }
    .send-btn:disabled { opacity:0.4;cursor:not-allowed; }
    .empty { text-align:center;color:#7c7b8f;font-size:0.8125rem;padding:1.5rem 1rem;line-height:1.5; }
    .empty .mono { font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#908fa0;margin-top:0.75rem; }

    /* Tool events visual */
    .tool-events { margin-top:0.5rem; display:flex; flex-direction:column; gap:0.25rem; }
    .tool-event {
      font-family:'JetBrains Mono',monospace; font-size:10px;
      padding:0.25rem 0.5rem; border-radius:4px;
      display:flex; align-items:center; gap:0.375rem;
      background:rgba(192,193,255,0.05);
      color:#908fa0;
    }
    .tool-event.running { color:#c0c1ff; }
    .tool-event.ok { color:#22c55e; }
    .tool-event.fail { color:#ef4444; }
    .tool-event mat-icon { font-size:12px; width:12px; height:12px; }
    .spinner { display:inline-block; width:10px; height:10px; border:2px solid #c0c1ff; border-top-color:transparent; border-radius:50%; animation: spin 0.6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .quick-suggestions { display:flex; flex-wrap:wrap; gap:0.375rem; margin-top:0.625rem; }
    .quick-chip {
      font-family:'JetBrains Mono',monospace; font-size:11px;
      padding:0.25rem 0.5rem; border-radius:4px;
      background:rgba(192,193,255,0.08); color:#c0c1ff;
      cursor:pointer; border:1px solid rgba(192,193,255,0.15);
    }
    .quick-chip:hover { background:rgba(192,193,255,0.15); }

    .clear-btn { color:#7c7b8f; }

    /* Mic button — Web Speech */
    .mic-btn {
      background:transparent; color:#c0c1ff; border:1px solid rgba(192,193,255,0.2);
      border-radius:6px; width:36px; height:36px; min-width:36px;
      display:inline-flex; align-items:center; justify-content:center;
      cursor:pointer; transition: all 120ms; padding:0;
    }
    .mic-btn:hover { background:rgba(192,193,255,0.08); }
    .mic-btn:disabled { opacity:0.4; cursor:not-allowed; }
    .mic-btn.recording {
      background:rgba(239,68,68,0.18); border-color:#ef4444; color:#ef4444;
      animation: pulse 1.2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
      50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
    }
    .voice-hint {
      font-family:'JetBrains Mono',monospace; font-size:10px;
      color:#ef4444; padding:0 1rem 0.25rem; letter-spacing:0.06em;
      display:flex; align-items:center; gap:0.375rem;
    }
    .voice-hint .interim { color:#dae2fd; font-style:italic; }
  `],
  template: `
    <div class="header">
      <h2><mat-icon style="font-size:18px;width:18px;height:18px;color:#c0c1ff">support_agent</mat-icon> Ajuda</h2>
      <div class="header-actions">
        @if (messages().length > 0) {
          <button mat-icon-button class="clear-btn" (click)="clear()" matTooltip="Nova conversa">
            <mat-icon style="font-size:18px;width:18px;height:18px">refresh</mat-icon>
          </button>
        }
        <button mat-icon-button (click)="close.emit()" matTooltip="Fechar">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    </div>
    <div class="subtitle">Copilot — pergunta ou pede ação na agenda</div>

    <div class="messages" #messagesBox>
      @if (messages().length === 0) {
        <div class="empty">
          Pergunte ou peça pra fazer algo na agenda. Exemplos:
          <div class="quick-suggestions">
            <span class="quick-chip" (click)="quickAsk('o que tenho hoje na agenda?')">o que tenho hoje?</span>
            <span class="quick-chip" (click)="quickAsk('agenda Maria amanhã 14h')">agendar consulta</span>
            <span class="quick-chip" (click)="quickAsk('cancela meu próximo atendimento')">cancelar próximo</span>
            <span class="quick-chip" (click)="quickAsk('como configuro horário de almoço?')">configurar horário</span>
          </div>
        </div>
      }
      @for (m of messages(); track $index) {
        <div class="msg" [class.user]="m.role === 'user'" [class.assistant]="m.role === 'assistant'">
          {{ m.content }}
          @if (m.toolEvents && m.toolEvents.length > 0) {
            <div class="tool-events">
              @for (te of m.toolEvents; track $index) {
                <div class="tool-event" [class.running]="te.ok === undefined" [class.ok]="te.ok === true" [class.fail]="te.ok === false">
                  @if (te.ok === undefined) {
                    <span class="spinner"></span>
                  } @else if (te.ok) {
                    <mat-icon>check_circle</mat-icon>
                  } @else {
                    <mat-icon>error_outline</mat-icon>
                  }
                  <span>{{ toolLabel(te.tool) }}</span>
                </div>
              }
            </div>
          }
          @if (m.actions && m.actions.length > 0) {
            <div style="margin-top:0.75rem;display:flex;flex-direction:column;gap:0.375rem;">
              @for (a of m.actions; track a.url) {
                <a [href]="a.url" (click)="onActionClick($event, a)"
                   style="background:rgba(192,193,255,0.1);color:#c0c1ff;padding:0.5rem 0.75rem;border-radius:5px;text-decoration:none;font-size:0.8125rem;font-family:'JetBrains Mono',monospace;text-align:center;">
                  → {{ a.label }}
                </a>
              }
            </div>
          }
        </div>
      }
    </div>

    @if (voice.recording()) {
      <div class="voice-hint">
        <mat-icon style="font-size:12px;width:12px;height:12px;color:#ef4444">mic</mat-icon>
        <span>Gravando...</span>
        @if (voice.interim()) { <span class="interim">"{{ voice.interim() }}"</span> }
      </div>
    }
    <div class="input-row">
      @if (voice.supported) {
        <button class="mic-btn"
                [class.recording]="voice.recording()"
                (click)="toggleMic()"
                [matTooltip]="voice.recording() ? 'Clique pra parar' : 'Falar (pt-BR)'"
                [disabled]="loading()">
          <mat-icon style="font-size:18px;width:18px;height:18px">mic</mat-icon>
        </button>
      }
      <textarea [(ngModel)]="draft" (keydown.enter)="onEnter($any($event))" rows="3"
        placeholder="Pergunte ou peça pra agendar/cancelar..." [disabled]="loading()"></textarea>
      <button class="send-btn" (click)="send()" [disabled]="!draft.trim() || loading()">
        {{ loading() ? '...' : 'ENVIAR' }}
      </button>
    </div>
  `
})
export class ProductHelpPanelComponent implements AfterViewChecked {
  @Output() close = new EventEmitter<void>();
  @ViewChild('messagesBox') messagesBox?: ElementRef<HTMLDivElement>;

  private svc = inject(ProductHelpService);
  private ctx = inject(HelpContextService);
  private router = inject(Router);
  voice = inject(VoiceInputService);

  messages = signal<Msg[]>([]);
  loading = signal(false);
  draft = '';

  private abortCtrl: AbortController | null = null;
  private shouldScroll = false;

  // Tool name → label amigável
  private readonly TOOL_LABELS: Record<string, string> = {
    find_subject: 'Buscando paciente...',
    list_my_agenda: 'Consultando agenda...',
    get_appointment_details: 'Carregando detalhes...',
    create_appointment: 'Criando agendamento...',
    cancel_appointment: 'Cancelando agendamento...',
  };

  toolLabel(toolName: string): string {
    return this.TOOL_LABELS[toolName] || toolName;
  }

  onEnter(ev: KeyboardEvent): void {
    const e = ev as any;
    if (e.shiftKey) return;
    ev.preventDefault();
    this.send();
  }

  quickAsk(question: string): void {
    this.draft = question;
    this.send();
  }

  toggleMic(): void {
    if (this.voice.recording()) {
      this.voice.stop();
      // Se usuário parou manualmente ANTES da transcrição final, mantém interim
      // como rascunho pra ele revisar e enviar manualmente. NÃO auto-envia
      // nesse caso porque o stop manual sinaliza intenção de revisar.
      const interim = this.voice.getInterim();
      if (interim && !this.draft) {
        this.draft = interim;
      }
      return;
    }
    this.voice.start((finalText) => {
      if (finalText === '__PERMISSION_DENIED__') {
        this.draft = '';
        this.messages.update(m => [...m, {
          role: 'assistant',
          content: '⚠ Permissão de microfone negada. Verifique nas configurações do navegador.',
        }]);
        return;
      }
      // Texto final chegou via reconhecimento natural (pause de fala detectado).
      // Auto-envia imediatamente — fluxo hands-free, sem clique extra.
      // Confirmação multi-turn pra ações destrutivas continua valendo (LLM
      // pergunta "Confirma?" antes de cancel/delete), garantindo segurança.
      const trimmed = (finalText || '').trim();
      if (!trimmed) return;
      this.draft = trimmed;
      this.send();
    });
  }

  clear(): void {
    if (this.abortCtrl) { this.abortCtrl.abort(); this.abortCtrl = null; }
    this.messages.set([]);
    this.loading.set(false);
  }

  private buildHistory(): HistoryMessage[] {
    // Pega últimas 10 mensagens (user + assistant) — backend trunca a 10 também
    const all = this.messages();
    return all.slice(-10).map(m => ({
      role: m.role,
      content: m.content,
    }));
  }

  async send(): Promise<void> {
    const q = this.draft.trim();
    if (!q || this.loading()) return;

    this.draft = '';
    this.loading.set(true);
    this.shouldScroll = true;
    const history = this.buildHistory();
    this.messages.update(m => [...m, { role: 'user', content: q }]);
    this.messages.update(m => [...m, { role: 'assistant', content: '', streaming: true, toolEvents: [] }]);

    const assistantIdx = this.messages().length - 1;
    this.abortCtrl = new AbortController();

    await this.svc.ask(q, this.ctx.snapshot(), {
      onDelta: (text) => {
        this.messages.update(ms => {
          const copy = [...ms];
          copy[assistantIdx] = { ...copy[assistantIdx], content: copy[assistantIdx].content + text };
          return copy;
        });
        this.shouldScroll = true;
      },
      onToolStart: (tool) => {
        this.messages.update(ms => {
          const copy = [...ms];
          const cur = copy[assistantIdx];
          copy[assistantIdx] = {
            ...cur,
            toolEvents: [...(cur.toolEvents || []), { tool, ok: undefined }],
          };
          return copy;
        });
        this.shouldScroll = true;
      },
      onToolComplete: (tool, ok) => {
        this.messages.update(ms => {
          const copy = [...ms];
          const cur = copy[assistantIdx];
          const events = (cur.toolEvents || []).map(te => {
            if (te.tool === tool && te.ok === undefined) return { ...te, ok };
            return te;
          });
          copy[assistantIdx] = { ...cur, toolEvents: events };
          return copy;
        });
      },
      onDone: (sources, actions) => {
        this.messages.update(ms => {
          const copy = [...ms];
          const current = copy[assistantIdx];
          // Remove o bloco ```actions ... ``` do conteúdo exibido — renderizamos como botões
          const cleaned = current.content.replace(/```actions[\s\S]*?```/g, '').trim();
          copy[assistantIdx] = { ...current, content: cleaned, sources, actions, streaming: false };
          return copy;
        });
        this.loading.set(false);
      },
      onError: (error) => {
        this.messages.update(ms => {
          const copy = [...ms];
          copy[assistantIdx] = { role: 'assistant', content: `⚠ ${error}`, streaming: false };
          return copy;
        });
        this.loading.set(false);
      },
    }, this.abortCtrl.signal, {
      enableAgendaTools: true,        // SEMPRE habilita agenda tools no Copilot
      conversationHistory: history,   // multi-turn pra confirmação destrutiva
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll && this.messagesBox) {
      const el = this.messagesBox.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScroll = false;
    }
  }

  onActionClick(ev: MouseEvent, a: HelpAction): void {
    ev.preventDefault();
    this.close.emit();
    this.router.navigateByUrl(a.url).catch(() => {/* rota inválida — AI propôs algo inexistente */});
  }
}
