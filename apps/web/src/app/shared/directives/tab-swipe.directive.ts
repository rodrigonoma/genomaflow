import { Directive, ElementRef, EventEmitter, HostListener, OnDestroy, Output, inject } from '@angular/core';
import { environment } from '../../../environments/environment';

/**
 * appTabSwipe — emite eventos swipeLeft/swipeRight quando o usuário
 * arrasta o dedo horizontalmente acima de um threshold.
 *
 * Só ativa em build mobile (environment.mobile === true). No web/desktop,
 * o listener nem registra os eventos — manter a navegação por seta/click
 * intocada.
 *
 * Uso:
 *   <mat-tab-group appTabSwipe
 *                  (swipeLeft)="nextTab()"
 *                  (swipeRight)="prevTab()">
 *
 * Trade-off: pointer events (não touch) cobrem mouse drag em web também
 * se ativado. Por isso o gate environment.mobile é essencial.
 */
@Directive({
  selector: '[appTabSwipe]',
  standalone: true,
})
export class TabSwipeDirective implements OnDestroy {
  /** Mínimo de px no eixo X pra detectar swipe (vs scroll vertical). */
  private static readonly THRESHOLD_X = 60;

  /** Tolerância no eixo Y — se draggar muito vertical, ignora (é scroll). */
  private static readonly TOLERANCE_Y = 80;

  /** Tempo máximo pra detectar swipe (ms) — descarta arrastes lentos. */
  private static readonly MAX_DURATION_MS = 500;

  @Output() swipeLeft = new EventEmitter<void>();
  @Output() swipeRight = new EventEmitter<void>();

  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly enabled = environment.mobile === true;

  private startX = 0;
  private startY = 0;
  private startT = 0;
  private tracking = false;

  ngOnDestroy(): void {
    this.tracking = false;
  }

  @HostListener('touchstart', ['$event'])
  onTouchStart(e: TouchEvent): void {
    if (!this.enabled || !e.touches[0]) return;
    this.startX = e.touches[0].clientX;
    this.startY = e.touches[0].clientY;
    this.startT = Date.now();
    this.tracking = true;
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(e: TouchEvent): void {
    if (!this.enabled || !this.tracking) return;
    this.tracking = false;

    const touch = e.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - this.startX;
    const dy = touch.clientY - this.startY;
    const dt = Date.now() - this.startT;

    // Descarta: scroll vertical, lento demais
    if (Math.abs(dy) > TabSwipeDirective.TOLERANCE_Y) return;
    if (dt > TabSwipeDirective.MAX_DURATION_MS) return;
    if (Math.abs(dx) < TabSwipeDirective.THRESHOLD_X) return;

    if (dx < 0) {
      this.swipeLeft.emit();  // dragou pra esquerda → próxima aba
    } else {
      this.swipeRight.emit(); // dragou pra direita → aba anterior
    }
  }
}
