import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { JwtPayload, UserProfile } from '../../shared/models/api.models';
import { WsService } from '../ws/ws.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http: HttpClient;
  private router: Router;
  private ws: WsService;

  private currentUserSubject = new BehaviorSubject<JwtPayload | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  private currentProfileSubject = new BehaviorSubject<UserProfile | null>(null);
  currentProfile$ = this.currentProfileSubject.asObservable();

  constructor(http?: HttpClient, router?: Router, ws?: WsService) {
    // Use injected dependencies if not provided (for normal use)
    // Otherwise use provided dependencies (for testing)
    this.http = http || inject(HttpClient);
    this.router = router || inject(Router);
    this.ws = ws || inject(WsService);

    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = this.decode(token);
        this.currentUserSubject.next(payload);
        this.ws.connect(token);
        if (payload.role !== 'master') this.fetchProfile();
      } catch {
        localStorage.removeItem('token');
      }
    }
  }

  login(email: string, password: string): Observable<void> {
    return this.http
      .post<{ token: string }>(`${environment.apiUrl}/auth/login`, { email, password })
      .pipe(
        tap(({ token }) => {
          localStorage.setItem('token', token);
          const payload = this.decode(token);
          this.currentUserSubject.next(payload);
          this.ws.connect(token);
          if (payload.role !== 'master') this.fetchProfile();
        }),
        map(({ token }) => {
          const payload = this.decode(token);
          const dest = payload.role === 'master' ? '/master' : '/clinic/dashboard';
          this.router.navigate([dest]);
        })
      );
  }

  logout(): void {
    this.resetSession();
    this.router.navigate(['/login']);
  }

  /**
   * Limpa toda a sessão (token, WS, signal) SEM navegar.
   * Uso: antes de entrar na tela de registro de novo tenant, para evitar
   * que um JWT de tenant antigo fique ativo após a criação do novo.
   */
  resetSession(): void {
    localStorage.removeItem('token');
    try { this.ws.disconnect(); } catch {}
    this.currentUserSubject.next(null);
    this.currentProfileSubject.next(null);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  get currentUser(): JwtPayload | null {
    return this.currentUserSubject.value;
  }

  get currentProfile(): UserProfile | null {
    return this.currentProfileSubject.value;
  }

  /**
   * Busca dados completos do usuário (inclui tenant_name e módulo do tenant).
   * Falha silenciosa — se der erro, topbar cai no fallback do JWT.
   */
  private fetchProfile(): void {
    this.http.get<UserProfile>(`${environment.apiUrl}/auth/me`).subscribe({
      next: (profile) => this.currentProfileSubject.next(profile),
      error: () => { /* silencioso */ }
    });
  }

  private decode(token: string): JwtPayload {
    return JSON.parse(atob(token.split('.')[1]));
  }
}
