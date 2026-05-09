import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { environment } from '../../../environments/environment';
import { JwtPayload, UserProfile } from '../../shared/models/api.models';
import { WsService } from '../ws/ws.service';

// Chaves separadas pra impersonate — sessionStorage isola por aba.
// Master abre nova aba pra "Acessar como tenant"; aba do master continua intacta.
const IMPERSONATE_TOKEN_KEY = 'impersonate_token';
const IMPERSONATE_PROFILE_KEY = 'impersonate_profile';
const IMPERSONATE_META_KEY = 'impersonate_meta'; // { tenant_name, master_id, target_email }

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

    // Impersonate (sessionStorage) tem prioridade sobre login normal (localStorage).
    // Se a aba foi aberta via /impersonate-launch, o token de impersonate é a sessão real desta aba.
    const impToken = this.getImpersonateToken();
    const token = impToken || localStorage.getItem('token');
    if (token) {
      try {
        const payload = this.decode(token);
        this.currentUserSubject.next(payload);
        this.ws.connect(token);
        // Hidrata o profile do cache imediatamente — evita flicker do chip no F5.
        const cached = impToken ? this.readImpersonateProfile() : this.readCachedProfile();
        if (cached) this.currentProfileSubject.next(cached);
        if (payload.role !== 'master') this.fetchProfile();
      } catch {
        // clearToken() is async — fire-and-forget here because the constructor
        // must remain synchronous. On web this resolves instantly (localStorage).
        if (impToken) this.clearImpersonateSession();
        else {
          void this.clearToken();
          localStorage.removeItem('profile');
        }
      }
    }
  }

  // ───────── Impersonate (master atua como tenant em nova aba) ─────────
  isImpersonating(): boolean { return !!this.getImpersonateToken(); }
  getImpersonateToken(): string | null {
    try { return sessionStorage.getItem(IMPERSONATE_TOKEN_KEY); } catch { return null; }
  }
  getImpersonateMeta(): { tenant_name: string; master_id: string; target_email: string } | null {
    try {
      const raw = sessionStorage.getItem(IMPERSONATE_META_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  private readImpersonateProfile(): UserProfile | null {
    try {
      const raw = sessionStorage.getItem(IMPERSONATE_PROFILE_KEY);
      return raw ? JSON.parse(raw) as UserProfile : null;
    } catch { return null; }
  }

  /**
   * Inicia sessão de impersonate (chamado pela tela /impersonate-launch).
   * Salva token em sessionStorage (não localStorage — isolada por aba).
   * Recarrega o profile via /auth/me e navega pra home do role.
   */
  async startImpersonate(token: string, meta: { tenant_name: string; master_id: string; target_email: string }): Promise<void> {
    sessionStorage.setItem(IMPERSONATE_TOKEN_KEY, token);
    sessionStorage.setItem(IMPERSONATE_META_KEY, JSON.stringify(meta));
    sessionStorage.removeItem(IMPERSONATE_PROFILE_KEY);
    const payload = this.decode(token);
    this.currentUserSubject.next(payload);
    this.ws.connect(token);
    // Não chama fetchProfile direto — deixa a navegação acontecer e o construtor cuidar do reload na próxima
    this.http.get<UserProfile>(`${environment.apiUrl}/auth/me`).subscribe({
      next: (p) => {
        this.currentProfileSubject.next(p);
        try { sessionStorage.setItem(IMPERSONATE_PROFILE_KEY, JSON.stringify(p)); } catch {}
      },
      error: () => {},
    });
  }

  /** Encerra impersonate só na aba atual — não mexe em localStorage do master */
  endImpersonate(): void {
    this.clearImpersonateSession();
    try { this.ws.disconnect(); } catch {}
    this.currentUserSubject.next(null);
    this.currentProfileSubject.next(null);
    // Fecha a aba se foi aberta via window.open; senão, navega pra login.
    try { window.close(); } catch {}
    setTimeout(() => this.router.navigate(['/login']), 200);
  }

  private clearImpersonateSession(): void {
    try {
      sessionStorage.removeItem(IMPERSONATE_TOKEN_KEY);
      sessionStorage.removeItem(IMPERSONATE_PROFILE_KEY);
      sessionStorage.removeItem(IMPERSONATE_META_KEY);
    } catch {}
  }
  // ───────── /Impersonate ─────────

  login(email: string, password: string): Observable<void> {
    return this.http
      .post<{ token: string }>(`${environment.apiUrl}/auth/login`, { email, password })
      .pipe(
        tap(({ token }) => {
          // saveToken() is async — fire-and-forget inside tap. On web it
          // resolves synchronously (localStorage). On native, Preferences.set
          // is awaited internally; tap ignores the returned Promise.
          void this.saveToken(token);
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

  /**
   * Logout iniciado pelo usuário (botão "Sair").
   * Encerra a sessão Angular (limpa localStorage) mas preserva o token seguro
   * em Preferences (Keychain/EncryptedSharedPreferences) para recuperação
   * biométrica no próximo acesso.
   *
   * Em sessão de impersonate (sessionStorage), só limpa a sessão da aba atual —
   * a sessão real do user no localStorage de OUTRA aba (master) não é afetada.
   */
  async logout(): Promise<void> {
    if (this.isImpersonating()) {
      this.endImpersonate();
      return;
    }
    localStorage.removeItem('token');
    localStorage.removeItem('profile');
    try { this.ws.disconnect(); } catch {}
    this.currentUserSubject.next(null);
    this.currentProfileSubject.next(null);
    this.router.navigate(['/login']);
  }

  /**
   * Logout forçado por segurança (token inválido/substituído — chamado pelo
   * jwtInterceptor em respostas 401). Limpa TODO o armazenamento, incluindo
   * Preferences e biometric_enabled, forçando re-autenticação completa.
   */
  async forceLogout(): Promise<void> {
    // Em impersonate, só encerra a sessão da aba — não toca no token do master.
    if (this.isImpersonating()) {
      this.endImpersonate();
      return;
    }
    await this.clearToken();
    localStorage.removeItem('profile');
    localStorage.removeItem('biometric_enabled');
    try { this.ws.disconnect(); } catch {}
    this.currentUserSubject.next(null);
    this.currentProfileSubject.next(null);
    this.router.navigate(['/login']);
  }

  /**
   * Hidrata a sessão a partir de um token já obtido (ex: auto-login após
   * /auth/register no onboarding). Faz o mesmo que login() faz no .pipe.tap,
   * mas SEM HTTP request e SEM navegação. Caller decide pra onde ir.
   */
  async setSession(token: string): Promise<void> {
    await this.saveToken(token);
    const payload = this.decode(token);
    this.currentUserSubject.next(payload);
    this.ws.connect(token);
    if (payload.role !== 'master') this.fetchProfile();
  }

  /**
   * Limpa toda a sessão (token, WS, signal) SEM navegar.
   * Uso: antes de entrar na tela de registro de novo tenant, para evitar
   * que um JWT de tenant antigo fique ativo após a criação do novo.
   */
  async resetSession(): Promise<void> {
    await this.clearToken();
    localStorage.removeItem('profile');
    try { this.ws.disconnect(); } catch {}
    this.currentUserSubject.next(null);
    this.currentProfileSubject.next(null);
  }

  /**
   * Synchronous token read used by the HTTP interceptor.
   * Capacitor Preferences is async and cannot be used here without refactoring
   * the interceptor to an async pattern. On web (and during Angular hydration
   * before Capacitor loads) localStorage is the correct fast path.
   * NOTE: On native, the token is ALSO written to localStorage as a read-cache
   * by saveToken() — so this always returns the most-recently-saved value even
   * on native. The durable copy lives in Keychain/EncryptedSharedPreferences.
   */
  getToken(): string | null {
    // Impersonate (sessionStorage) tem prioridade — abas de impersonate mandam o
    // JWT especial; aba master continua com seu próprio token em localStorage.
    return this.getImpersonateToken() || localStorage.getItem('token');
  }

  // ---------------------------------------------------------------------------
  // Secure token storage — async to support Capacitor Preferences (Keychain /
  // EncryptedSharedPreferences). On web falls back to localStorage.
  // loadToken() is public so Task 17 (biometric login) can check for a token.
  // ---------------------------------------------------------------------------

  async saveToken(token: string): Promise<void> {
    // localStorage primeiro — leitura síncrona pelo interceptor HTTP (getToken()).
    // Preferences.set é async; se vier antes, fetchProfile() sai sem token → 401 → logout.
    localStorage.setItem('token', token);
    if (Capacitor.isNativePlatform()) {
      await Preferences.set({ key: 'auth_token', value: token });
    }
  }

  async loadToken(): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
      const { value } = await Preferences.get({ key: 'auth_token' });
      return value;
    }
    return localStorage.getItem('token');
  }

  async clearToken(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await Preferences.remove({ key: 'auth_token' });
    }
    localStorage.removeItem('token');
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
      next: (profile) => {
        this.currentProfileSubject.next(profile);
        try { localStorage.setItem('profile', JSON.stringify(profile)); } catch {}
      },
      error: () => { /* silencioso */ }
    });
  }

  private readCachedProfile(): UserProfile | null {
    try {
      const raw = localStorage.getItem('profile');
      return raw ? JSON.parse(raw) as UserProfile : null;
    } catch { return null; }
  }

  private decode(token: string): JwtPayload {
    return JSON.parse(atob(token.split('.')[1]));
  }
}
