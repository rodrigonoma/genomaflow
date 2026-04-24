import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { HelpContext } from '../../core/help-context/help-context.service';

export interface AskCallbacks {
  onDelta(text: string): void;
  onDone(sources: Array<{ source: string; title: string; score: number }>): void;
  onError(message: string): void;
}

@Injectable({ providedIn: 'root' })
export class ProductHelpService {
  private auth = inject(AuthService);

  async ask(question: string, ctx: HelpContext, cb: AskCallbacks, signal?: AbortSignal): Promise<void> {
    const token = this.auth.getToken();
    if (!token) { cb.onError('Não autenticado'); return; }

    try {
      const res = await fetch(`${environment.apiUrl}/product-help/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({ question, context: ctx }),
        signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        cb.onError(body.error || `Erro ${res.status}`);
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
      else if (event === 'done') cb.onDone(parsed.sources || []);
      else if (event === 'error') cb.onError(parsed.error || 'Erro');
    } catch { /* ignore malformed */ }
  }
}
