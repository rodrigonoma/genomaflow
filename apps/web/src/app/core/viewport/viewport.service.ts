import { Injectable, signal, effect, inject, DestroyRef } from '@angular/core';

/**
 * Breakpoints do projeto — desktop-first.
 *
 *   < 640px   → mobile  (smartphone)
 *   640-1024  → tablet  (herda maioria de mobile com relaxações)
 *   > 1024px  → desktop (sem mudança visual — desktop-first)
 */
export const BREAKPOINTS = {
  MOBILE: 640,
  TABLET: 1024,
} as const;

@Injectable({ providedIn: 'root' })
export class ViewportService {
  private readonly destroyRef = inject(DestroyRef);

  private widthSig = signal(typeof window !== 'undefined' ? window.innerWidth : 1920);

  /** Largura atual do viewport em px. */
  width = this.widthSig.asReadonly();

  /** True quando viewport < 640px (smartphone). */
  isMobile = signal(false);

  /** True quando 640px ≤ viewport < 1024px (tablet). */
  isTablet = signal(false);

  /** True quando viewport ≥ 1024px (desktop). */
  isDesktop = signal(true);

  constructor() {
    if (typeof window === 'undefined') return;

    const recompute = () => {
      const w = window.innerWidth;
      this.widthSig.set(w);
      this.isMobile.set(w < BREAKPOINTS.MOBILE);
      this.isTablet.set(w >= BREAKPOINTS.MOBILE && w < BREAKPOINTS.TABLET);
      this.isDesktop.set(w >= BREAKPOINTS.TABLET);
    };

    recompute();

    const handler = () => recompute();
    window.addEventListener('resize', handler, { passive: true });

    this.destroyRef.onDestroy(() => {
      window.removeEventListener('resize', handler);
    });

    // Ajusta classe no <body> para permitir seletores CSS globais .is-mobile, .is-tablet
    effect(() => {
      const cls = document.body.classList;
      cls.toggle('is-mobile', this.isMobile());
      cls.toggle('is-tablet', this.isTablet());
      cls.toggle('is-desktop', this.isDesktop());
    });
  }
}
