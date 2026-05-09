import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/auth/auth.service';

/**
 * Página de "lançamento" do impersonate. Aberta pelo master via window.open
 * em nova aba, recebe o token JWT especial via query param + meta info,
 * salva em sessionStorage (isolada por aba) e redireciona pra home do
 * tenant (clinic/dashboard).
 *
 * URL: /impersonate-launch?token=...&tenant_name=...&master_id=...&target_email=...
 */
@Component({
  selector: 'app-impersonate-launch',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule],
  styles: [`
    :host { display:flex; align-items:center; justify-content:center; min-height:100vh;
            background:#0b1326; color:#dae2fd; }
    .card { text-align:center; padding:2rem 2.5rem; background:#131b2e;
            border:1px solid rgba(70,69,84,.3); border-radius:10px; max-width:420px; }
    h1 { margin:0 0 .5rem; font-family:'Space Grotesk',sans-serif; font-weight:700;
         font-size:1.05rem; color:#c0c1ff; }
    p { color:#a09fb2; font-size:.85rem; line-height:1.5; margin:.5rem 0; }
    .err { color:#fca5a5; font-size:.8rem; margin-top:1rem; }
  `],
  template: `
    <div class="card">
      <mat-spinner diameter="36" style="margin:0 auto 1rem;"></mat-spinner>
      <h1>Iniciando sessão como tenant</h1>
      <p>Você está entrando no GenomaFlow como o admin do tenant selecionado. Sua sessão master continua ativa em outra aba.</p>
      @if (errorMsg) { <div class="err">{{ errorMsg }}</div> }
    </div>
  `,
})
export class ImpersonateLaunchComponent implements OnInit {
  private route  = inject(ActivatedRoute);
  private router = inject(Router);
  private auth   = inject(AuthService);

  errorMsg = '';

  async ngOnInit() {
    const params = this.route.snapshot.queryParamMap;
    const token = params.get('token');
    const tenant_name = params.get('tenant_name') || 'tenant';
    const master_id = params.get('master_id') || '';
    const target_email = params.get('target_email') || '';

    if (!token) {
      this.errorMsg = 'Token de impersonate ausente. Volte ao painel master e tente novamente.';
      return;
    }

    try {
      await this.auth.startImpersonate(token, { tenant_name, master_id, target_email });
      // Decide destino baseado no role (sempre 'admin' em impersonate, mas usamos pattern
      // para futura extensão). Master nunca pode impersonar outro master (backend bloqueia).
      this.router.navigate(['/clinic/dashboard']);
    } catch (e: any) {
      this.errorMsg = e?.message || 'Falha ao iniciar sessão. Token inválido ou expirado.';
    }
  }
}
