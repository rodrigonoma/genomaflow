import { Component, EventEmitter, Output, inject, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { HelpContextService } from '../../core/help-context/help-context.service';
import { ProductHelpService, HelpAction } from './product-help.service';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ source: string; title: string; score: number }>;
  actions?: HelpAction[];
  streaming?: boolean;
}

@Component({
  selector: 'app-product-help-panel',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatButtonModule],
  styles: [`
    :host { position:fixed;top:56px;right:0;bottom:0;width:380px;max-width:100vw;background:#0b1326;border-left:1px solid rgba(70,69,84,0.25);display:flex;flex-direction:column;z-index:900;box-shadow:-4px 0 20px rgba(0,0,0,0.3);font-family:'Space Grotesk',sans-serif;color:#dae2fd; }
    .header { display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;border-bottom:1px solid rgba(70,69,84,0.2); }
    .header h2 { font-size:0.9375rem;font-weight:700;margin:0;color:#c0c1ff;display:flex;align-items:center;gap:0.5rem; }
    .subtitle { font-family:'JetBrains Mono',monospace;font-size:10px;color:#7c7b8f;padding:0 1rem 0.5rem;letter-spacing:0.08em;text-transform:uppercase; }
    .messages { flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:0.75rem; }
    .msg { padding:0.625rem 0.875rem;border-radius:8px;font-size:0.8125rem;line-height:1.45;white-space:pre-wrap;word-wrap:break-word; }
    .msg.user { background:#181e31;align-self:flex-end;max-width:85%; }
    .msg.assistant { background:#111929;border:1px solid rgba(192,193,255,0.08);max-width:95%; }
    .sources { margin-top:0.5rem;font-family:'JetBrains Mono',monospace;font-size:9.5px;color:#7c7b8f; }
    .sources-title { text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.25rem;color:#908fa0; }
    .input-row { padding:0.75rem 1rem;border-top:1px solid rgba(70,69,84,0.2);display:flex;gap:0.5rem;align-items:flex-end; }
    textarea { flex:1;background:#060d1a;color:#dae2fd;border:1px solid rgba(192,193,255,0.12);border-radius:6px;padding:0.5rem 0.75rem;font-family:'JetBrains Mono',monospace;font-size:0.8125rem;resize:none;outline:none;min-height:36px;max-height:120px; }
    textarea:focus { border-color:rgba(192,193,255,0.35); }
    .send-btn { background:#c0c1ff;color:#1000a9;border:none;border-radius:6px;padding:0.5rem 0.875rem;font-size:0.75rem;font-weight:700;letter-spacing:0.06em;cursor:pointer;text-transform:uppercase; }
    .send-btn:disabled { opacity:0.4;cursor:not-allowed; }
    .empty { text-align:center;color:#7c7b8f;font-size:0.8125rem;padding:1.5rem 1rem;line-height:1.5; }
    .empty .mono { font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#908fa0;margin-top:0.75rem; }
  `],
  template: `
    <div class="header">
      <h2><mat-icon style="font-size:18px;width:18px;height:18px;color:#c0c1ff">support_agent</mat-icon> Ajuda</h2>
      <button mat-icon-button (click)="close.emit()"><mat-icon>close</mat-icon></button>
    </div>
    <div class="subtitle">Copilot do GenomaFlow</div>

    <div class="messages" #messagesBox>
      @if (messages().length === 0) {
        <div class="empty">
          Pergunte sobre como usar a plataforma. O Copilot vê qual tela você está olhando e responde com passo-a-passo específico.
          <div class="mono">Exemplos:<br>• "como registrar um novo paciente?"<br>• "onde altero o plano da clínica?"<br>• "como convido outra clínica pro chat?"</div>
        </div>
      }
      @for (m of messages(); track $index) {
        <div class="msg" [class.user]="m.role === 'user'" [class.assistant]="m.role === 'assistant'">
          {{ m.content }}
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
          @if (m.sources && m.sources.length > 0) {
            <div class="sources">
              <div class="sources-title">Fontes</div>
              @for (s of m.sources; track s.source) {
                <div>• {{ s.title }} ({{ s.score }})</div>
              }
            </div>
          }
        </div>
      }
    </div>

    <div class="input-row">
      <textarea [(ngModel)]="draft" (keydown.enter)="onEnter($any($event))" rows="1"
        placeholder="Pergunte algo sobre a plataforma..." [disabled]="loading()"></textarea>
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

  messages = signal<Msg[]>([]);
  loading = signal(false);
  draft = '';

  private abortCtrl: AbortController | null = null;
  private shouldScroll = false;

  onEnter(ev: KeyboardEvent): void {
    const e = ev as any;
    if (e.shiftKey) return;
    ev.preventDefault();
    this.send();
  }

  async send(): Promise<void> {
    const q = this.draft.trim();
    if (!q || this.loading()) return;

    this.draft = '';
    this.loading.set(true);
    this.shouldScroll = true;
    this.messages.update(m => [...m, { role: 'user', content: q }]);
    this.messages.update(m => [...m, { role: 'assistant', content: '', streaming: true }]);

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
    }, this.abortCtrl.signal);
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
