import { Injectable, inject, signal } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

/**
 * Heurística simples: detecta padrão "navegar em zig-zag" entre duas rotas.
 * Se o histórico recente mostra A→B→A→B em <15s, o usuário provavelmente está perdido.
 */
@Injectable({ providedIn: 'root' })
export class HesitationDetectorService {
  private router = inject(Router);
  private history: Array<{ url: string; at: number }> = [];

  /** Signal que emite um objeto quando detecta hesitação; caller reseta manualmente via clearHint(). */
  hintTrigger = signal<{ route: string; detectedAt: number } | null>(null);

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.onNav(e.urlAfterRedirects));
  }

  private onNav(url: string): void {
    const now = Date.now();
    this.history.push({ url, at: now });
    // keep apenas os últimos ~15s
    this.history = this.history.filter(h => now - h.at < 15000).slice(-6);

    const urls = this.history.map(h => h.url);
    const n = urls.length;
    if (n >= 4) {
      // Detecta A B A B nos últimos 4
      const last4 = urls.slice(n - 4);
      if (last4[0] !== last4[1] && last4[0] === last4[2] && last4[1] === last4[3]) {
        this.hintTrigger.set({ route: url, detectedAt: now });
      }
    }
  }

  clearHint(): void {
    this.hintTrigger.set(null);
  }
}
