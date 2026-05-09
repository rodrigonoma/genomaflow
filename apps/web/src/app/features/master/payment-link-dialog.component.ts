import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { environment } from '../../../environments/environment';

export interface PaymentLinkDialogData {
  tenant_id: string;
  tenant_name: string;
}

interface PaymentLinkResp {
  url: string;
  session_id: string;
  expires_at: number;
  coupon_id: string | null;
  discount_percent: number;
}

/**
 * Dialog do master pra gerar link de pagamento Stripe pra um tenant existente.
 *
 * 2 modos:
 *  - subscription: usa STRIPE_PRICE_SUBSCRIPTION (preço padrão do plano)
 *  - topup: pacote de créditos avulsos (master define qtd e valor em centavos)
 *
 * Desconto opcional via Stripe Coupon ad-hoc (criado no momento):
 *  - Se duration_months for vazio → coupon 'once' (desconto na 1ª fatura)
 *  - Se duration_months > 0 → coupon 'repeating' por N meses
 *
 * Backend: POST /master/tenants/:id/payment-link
 * Webhook Stripe atual já reconhece via metadata.tenant_id como pagamento normal —
 * ativa subscription / credita ledger conforme o evento.
 */
@Component({
  selector: 'app-payment-link-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule,
    MatIconModule, MatProgressSpinnerModule, MatSnackBarModule,
  ],
  styles: [`
    :host { color:#dae2fd; display:block; max-height:88vh; overflow:hidden; display:flex; flex-direction:column; min-width:480px; }
    .header { padding:1rem 1.25rem; display:flex; align-items:center; gap:.625rem; border-bottom:1px solid rgba(70,69,84,.25); }
    h2 { margin:0; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:1.05rem; color:#c0c1ff; flex:1; }
    .sub { color:#7c7b8f; font-size:.75rem; margin-top:.25rem; padding:0 1.25rem 0; }
    .sub strong { color:#dae2fd; }

    .body { padding:1rem 1.25rem; overflow-y:auto; flex:1; }

    label { display:block; font-size:.7rem; color:#7c7b8f; margin-bottom:.25rem;
            text-transform:uppercase; letter-spacing:.08em; font-family:'JetBrains Mono',monospace; margin-top:.625rem; }
    input, select { width:100%; padding:.55rem .75rem; background:#0e1525; color:#dae2fd;
                    border:1px solid rgba(70,69,84,.4); border-radius:5px; font-size:.85rem; }
    input:focus, select:focus { outline:none; border-color:#c0c1ff; }
    .row-2 { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; }

    .mode-tabs { display:flex; gap:.5rem; margin-bottom:.5rem; }
    .mode-btn { background:transparent; border:1px solid rgba(70,69,84,.4); color:#a09fb2;
                border-radius:6px; padding:.4rem .9rem; cursor:pointer; font-size:.78rem; }
    .mode-btn.active { background:rgba(192,193,255,.12); border-color:#c0c1ff; color:#c0c1ff; }

    .help { font-size:.7rem; color:#7c7b8f; margin-top:.25rem; line-height:1.5; }

    .result {
      margin-top:1rem; padding:.875rem 1rem; background:#0e1525;
      border:1px solid rgba(34,197,94,.4); border-radius:6px;
    }
    .result-label { font-family:'JetBrains Mono',monospace; font-size:.65rem;
                    color:#7c7b8f; text-transform:uppercase; letter-spacing:.1em; margin-bottom:.375rem; }
    .result-url {
      background:#131b2e; padding:.5rem .625rem; border-radius:4px;
      color:#86efac; font-family:'JetBrains Mono',monospace; font-size:.72rem;
      word-break:break-all; line-height:1.5;
    }
    .copy-btn {
      margin-top:.5rem; background:#c0c1ff; color:#1000a9;
      border:none; border-radius:5px; padding:.45rem 1rem; cursor:pointer;
      font-size:.7rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em;
      display:inline-flex; align-items:center; gap:.4rem;
    }

    .error { color:#fca5a5; font-size:.78rem; margin-top:.5rem;
             padding:.5rem .75rem; background:rgba(220,38,38,.12);
             border:1px solid rgba(239,68,68,.3); border-radius:4px; }

    .footer { padding:.75rem 1.25rem; display:flex; justify-content:flex-end; gap:.625rem;
              border-top:1px solid rgba(70,69,84,.25); }
    .btn-primary {
      background:#c0c1ff; color:#1000a9; border:none; border-radius:5px;
      padding:.55rem 1.25rem; cursor:pointer; font-size:.72rem; font-weight:700;
      letter-spacing:.05em; text-transform:uppercase;
      display:inline-flex; align-items:center; gap:.4rem;
    }
    .btn-primary:disabled { opacity:.4; cursor:not-allowed; }
    .btn-ghost { background:transparent; color:#a09fb2; border:1px solid rgba(70,69,84,.4); border-radius:5px;
                 padding:.55rem 1rem; cursor:pointer; font-size:.72rem; }
  `],
  template: `
    <div class="header">
      <mat-icon style="color:#c0c1ff;">credit_card</mat-icon>
      <h2>Gerar link de pagamento</h2>
    </div>
    <div class="sub">Tenant: <strong>{{ data.tenant_name }}</strong></div>

    <div class="body">
      <div class="mode-tabs">
        <button class="mode-btn" [class.active]="form.mode === 'subscription'" (click)="form.mode = 'subscription'">Assinatura</button>
        <button class="mode-btn" [class.active]="form.mode === 'topup'" (click)="form.mode = 'topup'">Créditos avulsos</button>
      </div>

      @if (form.mode === 'subscription') {
        <div class="help">Usa o preço padrão do plano (configurado em <code>STRIPE_PRICE_SUBSCRIPTION</code>). Webhook ativa a assinatura quando o pagamento confirma.</div>
      } @else {
        <div class="row-2">
          <div>
            <label>Quantidade de créditos</label>
            <input type="number" min="1" [(ngModel)]="form.topup_credits" placeholder="ex: 100"/>
          </div>
          <div>
            <label>Valor total (R$)</label>
            <input type="number" min="1" step="0.01" [(ngModel)]="topupBrl" (ngModelChange)="onBrlChange($event)" placeholder="ex: 199.00"/>
          </div>
        </div>
        <div class="help">Valor em reais (será convertido para centavos no Stripe).</div>
      }

      <div class="row-2">
        <div>
          <label>Desconto (%) — opcional</label>
          <input type="number" min="0" max="100" [(ngModel)]="form.discount_percent" placeholder="ex: 20"/>
        </div>
        @if (form.mode === 'subscription' && form.discount_percent && form.discount_percent > 0) {
          <div>
            <label>Duração (meses)</label>
            <input type="number" min="1" [(ngModel)]="form.duration_months" placeholder="vazio = só 1ª fatura"/>
          </div>
        }
      </div>
      @if (form.discount_percent && form.discount_percent > 0) {
        <div class="help">
          Cria um Stripe Coupon ad-hoc com <strong>{{ form.discount_percent }}%</strong> de desconto
          @if (form.mode === 'subscription' && form.duration_months) {
            por <strong>{{ form.duration_months }} mês(es)</strong>
          } @else if (form.mode === 'subscription') {
            <strong>somente na 1ª fatura</strong>
          }.
        </div>
      }

      @if (errorMsg()) { <div class="error">{{ errorMsg() }}</div> }

      @if (result()) {
        <div class="result">
          <div class="result-label">Link gerado · expira em {{ expiresInLabel() }}</div>
          <div class="result-url">{{ result()!.url }}</div>
          <button class="copy-btn" (click)="copyLink()">
            <mat-icon style="font-size:14px;width:14px;height:14px;">content_copy</mat-icon>
            Copiar link
          </button>
        </div>
      }
    </div>

    <div class="footer">
      @if (result()) {
        <button class="btn-primary" (click)="cancel()">Fechar</button>
      } @else {
        <button class="btn-ghost" (click)="cancel()" [disabled]="saving()">Cancelar</button>
        <button class="btn-primary" (click)="submit()"
                [disabled]="saving() || !valid()">
          @if (saving()) { <mat-spinner diameter="14"></mat-spinner> }
          Gerar link
        </button>
      }
    </div>
  `,
})
export class PaymentLinkDialogComponent {
  data: PaymentLinkDialogData = inject(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<PaymentLinkDialogComponent, void>);
  private http = inject(HttpClient);
  private snack = inject(MatSnackBar);

  form = {
    mode: 'subscription' as 'subscription' | 'topup',
    discount_percent: undefined as number | undefined,
    duration_months: undefined as number | undefined,
    topup_credits: undefined as number | undefined,
    topup_amount_cents: undefined as number | undefined,
  };
  topupBrl: number | undefined = undefined;

  saving = signal(false);
  errorMsg = signal<string | null>(null);
  result = signal<PaymentLinkResp | null>(null);

  onBrlChange(brl: number) {
    this.form.topup_amount_cents = brl ? Math.round(brl * 100) : undefined;
  }

  valid(): boolean {
    if (this.form.mode === 'subscription') return true;
    return !!(this.form.topup_credits && this.form.topup_credits > 0
              && this.form.topup_amount_cents && this.form.topup_amount_cents > 0);
  }

  cancel() { this.ref.close(); }

  expiresInLabel(): string {
    const r = this.result();
    if (!r) return '';
    const ms = r.expires_at * 1000 - Date.now();
    const min = Math.max(0, Math.round(ms / 60000));
    if (min >= 60) return `${Math.round(min / 60)}h`;
    return `${min}min`;
  }

  copyLink() {
    const r = this.result();
    if (!r) return;
    navigator.clipboard.writeText(r.url).then(() => {
      this.snack.open('Link copiado!', '', { duration: 2000 });
    }).catch(() => this.snack.open('Falha ao copiar — selecione e copie manualmente', '', { duration: 4000 }));
  }

  submit() {
    this.errorMsg.set(null);
    this.saving.set(true);
    const body: any = { mode: this.form.mode };
    if (this.form.discount_percent && this.form.discount_percent > 0) {
      body.discount_percent = this.form.discount_percent;
      if (this.form.mode === 'subscription' && this.form.duration_months) {
        body.duration_months = this.form.duration_months;
      }
    }
    if (this.form.mode === 'topup') {
      body.topup_credits = this.form.topup_credits;
      body.topup_amount_cents = this.form.topup_amount_cents;
    }

    this.http.post<PaymentLinkResp>(
      `${environment.apiUrl}/master/tenants/${this.data.tenant_id}/payment-link`, body
    ).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.result.set(res);
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMsg.set(err.error?.error || 'Erro ao gerar link');
      },
    });
  }
}
