import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { HelpContext } from '../../core/help-context/help-context.service';

export interface HelpAction { label: string; url: string; }

export type HistoryMessage = { role: 'user' | 'assistant'; content: any };

export interface AskCallbacks {
  onDelta(text: string): void;
  onDone(sources: Array<{ source: string; title: string; score: number }>, actions: HelpAction[], toolCallsSummary?: string[]): void;
  onError(message: string): void;
  onToolStart?(toolName: string): void;
  onToolComplete?(toolName: string, ok: boolean): void;
}

export interface AskOptions {
  enableAgendaTools?: boolean;
  conversationHistory?: HistoryMessage[];
}

@Injectable({ providedIn: 'root' })
export class ProductHelpService {
  private auth = inject(AuthService);

  async ask(
    question: string,
    ctx: HelpContext,
    cb: AskCallbacks,
    signal?: AbortSignal,
    opts?: AskOptions,
  ): Promise<void> {
    const token = this.auth.getToken();
    if (!token) { cb.onError('Não autenticado'); return; }

    const body: any = { question, context: ctx };
    if (opts?.enableAgendaTools) body.enable_agenda_tools = true;
    if (opts?.conversationHistory && opts.conversationHistory.length > 0) {
      body.conversation_history = opts.conversationHistory;
    }

    try {
      const res = await fetch(`${environment.apiUrl}/product-help/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        cb.onError(errBody.error || `Erro ${res.status}`);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          this.handleFrame(frame, cb);
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      cb.onError(err?.message || 'Erro de rede');
    }
  }

  private handleFrame(frame: string, cb: AskCallbacks): void {
    const lines = frame.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    if (!data) return;
    try {
      const parsed = JSON.parse(data);
      if (event === 'delta' && parsed.text) cb.onDelta(parsed.text);
      else if (event === 'done') {
        cb.onDone(parsed.sources || [], parsed.actions || [], parsed.tool_calls_summary);
      } else if (event === 'error') cb.onError(parsed.error || 'Erro');
      else if (event === 'tool_call_started' && cb.onToolStart) cb.onToolStart(parsed.tool_name);
      else if (event === 'tool_call_completed' && cb.onToolComplete) cb.onToolComplete(parsed.tool_name, parsed.ok);
    } catch { /* ignore malformed */ }
  }
}
