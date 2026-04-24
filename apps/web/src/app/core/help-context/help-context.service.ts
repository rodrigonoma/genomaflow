import { Injectable, inject, signal, computed } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

export interface HelpContext {
  route: string;
  component: string | null;
}

@Injectable({ providedIn: 'root' })
export class HelpContextService {
  private router = inject(Router);

  private routeSignal = signal<string>(this.router.url);
  private componentSignal = signal<string | null>(null);

  route = this.routeSignal.asReadonly();
  component = this.componentSignal.asReadonly();
  snapshot = computed<HelpContext>(() => ({
    route: this.routeSignal(),
    component: this.componentSignal(),
  }));

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.routeSignal.set(e.urlAfterRedirects));
  }

  setComponent(name: string | null): void {
    this.componentSignal.set(name);
  }
}
