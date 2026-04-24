import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [RouterModule],
  styles: [`
    :host { display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0b1326;color:#dae2fd;font-family:'Space Grotesk',sans-serif; }
    .card { width:420px;max-width:92vw;background:#111929;border:1px solid rgba(70,69,84,0.25);border-radius:8px;padding:2.5rem;text-align:center; }
    h1 { font-size:1.25rem;font-weight:700;margin:0 0 1rem;color:#c0c1ff; }
    p { color:#a09fb2;font-size:0.9rem;line-height:1.5;margin:0 0 1.25rem; }
    .ok-icon, .err-icon { font-size:48px;margin-bottom:1rem;display:block; }
    .ok-icon { color:#10b981; }
    .err-icon { color:#ffb4ab; }
    a { display:inline-block;padding:0.6rem 1.5rem;background:#c0c1ff;color:#1000a9;border-radius:6px;text-decoration:none;font-weight:700;font-size:0.8125rem;letter-spacing:0.08em;text-transform:uppercase;transition:background 150ms; }
    a:hover { background:#d4d5ff; }
    .mono { font-family:'JetBrains Mono',monospace;font-size:11px;color:#7c7b8f;margin-top:1rem; }
  `],
  template: `
    <div class="card">
      @if (status() === 'loading') {
        <p>Verificando seu e-mail...</p>
      } @else if (status() === 'ok') {
        <span class="ok-icon">✓</span>
        <h1>E-mail confirmado!</h1>
        <p>Seu e-mail <strong>{{ email() }}</strong> foi verificado. Você já pode entrar no GenomaFlow.</p>
        <a routerLink="/login">Entrar</a>
      } @else {
        <span class="err-icon">!</span>
        <h1>Link inválido ou expirado</h1>
        <p>{{ errorMsg() || 'O link pode ter sido usado, expirado ou estar incorreto. Peça um novo pelo login.' }}</p>
        <a routerLink="/login">Ir para login</a>
        <div class="mono">Se o problema persistir, reenvie o link a partir da tela de login.</div>
      }
    </div>
  `
})
export class VerifyEmailComponent implements OnInit {
  private http   = inject(HttpClient);
  private route  = inject(ActivatedRoute);
  private router = inject(Router);

  status   = signal<'loading' | 'ok' | 'err'>('loading');
  email    = signal<string | null>(null);
  errorMsg = signal<string | null>(null);

  ngOnInit() {
    const token = this.route.snapshot.queryParams['token'];
    if (!token) { this.status.set('err'); return; }

    this.http.post<{ ok: boolean; email: string }>(
      `${environment.apiUrl}/auth/email-verification/verify`, { token }
    ).subscribe({
      next: (res) => { this.email.set(res.email); this.status.set('ok'); },
      error: (err) => {
        this.errorMsg.set(err.error?.error ?? null);
        this.status.set('err');
      }
    });
  }
}
