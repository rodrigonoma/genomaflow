import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { JwtPayload } from '../../shared/models/api.models';
import { WsService } from '../ws/ws.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http: HttpClient;
  private router: Router;
  private ws: WsService;

  private currentUserSubject = new BehaviorSubject<JwtPayload | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  constructor(http?: HttpClient, router?: Router, ws?: WsService) {
    // Use injected dependencies if not provided (for normal use)
    // Otherwise use provided dependencies (for testing)
    this.http = http || inject(HttpClient);
    this.router = router || inject(Router);
    this.ws = ws || inject(WsService);

    const token = localStorage.getItem('token');
    if (token) {
      try {
        this.currentUserSubject.next(this.decode(token));
        this.ws.connect(token);
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
        }),
        map(({ token }) => {
          const payload = this.decode(token);
          const dest = payload.role === 'master' ? '/master' : '/clinic/dashboard';
          this.router.navigate([dest]);
        })
      );
  }

  logout(): void {
    localStorage.removeItem('token');
    this.ws.disconnect();
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  get currentUser(): JwtPayload | null {
    return this.currentUserSubject.value;
  }

  private decode(token: string): JwtPayload {
    return JSON.parse(atob(token.split('.')[1]));
  }
}
