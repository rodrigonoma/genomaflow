import { Component, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BillingService, LedgerItem, LedgerSummary, UsageReport } from './billing.service';

@Component({
  selector: 'app-billing',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DatePipe, DecimalPipe],
  styles: [`
    .gf-tooltip {
      display: none;
      position: absolute;
      bottom: calc(100% + 8px);
      left: 0;
      width: 260px;
      background: #060d20;
      border: 1px solid rgba(192,193,255,0.2);
      border-radius: 4px;
      padding: 0.625rem 0.75rem;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 0.75rem;
      color: #dbe2fd;
      line-height: 1.5;
      z-index: 100;
      pointer-events: none;
      white-space: normal;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }
    .gf-tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 12px;
      border: 6px solid transparent;
      border-top-color: rgba(192,193,255,0.2);
    }
    div:hover > .gf-tooltip { display: block; }
  `],
  template: `
<div style="padding:1.5rem;max-width:1200px;">

  <!-- Header -->
  <div style="margin-bottom:2rem;">
    <h1 style="font-family:'Space Grotesk',sans-serif;font-size:1.5rem;font-weight:700;color:#dbe2fd;">Billing &amp; Créditos</h1>
    <p style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:#c7c5d0;letter-spacing:0.1em;text-transform:uppercase;margin-top:0.25rem;">
      Administração de créditos e histórico de consumo
    </p>
  </div>

  <!-- Top row: Balance + Usage -->
  <div style="display:grid;grid-template-columns:1fr 2fr;gap:1.5rem;margin-bottom:2rem;">

    <!-- Balance card -->
    <div style="background:#222a3e;border-left:2px solid #585990;padding:1.5rem;border-radius:0.25rem;">
      <div style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.75rem;">Saldo Atual</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:2.5rem;color:#c0c1ff;margin-bottom:0.5rem;">{{ balance() }}</div>
      <div style="font-size:0.75rem;color:#c7c5d0;margin-bottom:1rem;">créditos disponíveis</div>
      <div style="height:3px;background:#171f33;border-radius:9999px;overflow:hidden;margin-bottom:1rem;">
        <div style="height:100%;background:#c0c1ff;border-radius:9999px;transition:width 0.5s;"
             [style.width]="balancePct() + '%'"></div>
      </div>
      <button (click)="openTopup = true"
              style="width:100%;padding:0.625rem;background:#c0c1ff;color:#4b4d83;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;border:none;border-radius:0.25rem;cursor:pointer;">
        Recarregar Créditos
      </button>
    </div>

    <!-- Usage report -->
    <div style="background:#222a3e;padding:1.5rem;border-radius:0.25rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.1em;">Relatório de Consumo</div>
        <select [(ngModel)]="usageDays" (ngModelChange)="loadUsage()"
                style="background:#060d20;color:#dbe2fd;font-family:'JetBrains Mono',monospace;font-size:0.65rem;padding:0.25rem 0.5rem;border:none;border-radius:0.25rem;outline:none;">
          <option value="30">Últimos 30 dias</option>
          <option value="60">Últimos 60 dias</option>
          <option value="90">Últimos 90 dias</option>
        </select>
      </div>
      @if (usage()) {
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;">
          <div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:1.5rem;color:#dbe2fd;">{{ usage()!.exams_processed }}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.08em;margin-top:0.25rem;">Exames Processados</div>
          </div>
          <div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:1.5rem;color:#dbe2fd;">{{ usage()!.agents_executed }}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.08em;margin-top:0.25rem;">Agentes Executados</div>
          </div>
          <div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:1.5rem;color:#c0c1ff;">{{ usage()!.credits_consumed }}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.08em;margin-top:0.25rem;">Créditos Consumidos</div>
          </div>
          <div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:0.875rem;color:#dbe2fd;">{{ usage()!.input_tokens | number }}</div>
            <div style="position:relative;display:inline-block;">
              <div style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.08em;margin-top:0.25rem;cursor:help;border-bottom:1px dashed rgba(199,197,208,0.4);">Tokens de Entrada &#9432;</div>
              <div class="gf-tooltip">Quantidade de texto enviada aos modelos de IA para análise — inclui o laudo do exame, contexto clínico do paciente e diretrizes de referência. Mais tokens de entrada indicam laudos maiores ou contexto mais rico.</div>
            </div>
          </div>
          <div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:0.875rem;color:#dbe2fd;">{{ usage()!.output_tokens | number }}</div>
            <div style="position:relative;display:inline-block;">
              <div style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.08em;margin-top:0.25rem;cursor:help;border-bottom:1px dashed rgba(199,197,208,0.4);">Tokens de Saída &#9432;</div>
              <div class="gf-tooltip">Quantidade de texto gerada pelos modelos de IA — inclui interpretações, alertas, recomendações terapêuticas e correlação clínica. Representa o resultado da análise produzido por cada agente.</div>
            </div>
          </div>
          <div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:0.875rem;color:#c7c5d0;">R$ {{ usage()!.estimated_api_cost_brl.toFixed(2) }}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.08em;margin-top:0.25rem;">Custo Estimado API</div>
          </div>
        </div>
        <p style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#c7c5d0;opacity:0.5;margin-top:1rem;">
          Custo estimado é referência informativa. A cobrança é realizada por crédito consumido.
        </p>
      } @else {
        <div style="color:#c7c5d0;font-family:'JetBrains Mono',monospace;font-size:0.75rem;">Carregando...</div>
      }
    </div>
  </div>

  <!-- History table -->
  <div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-bottom:1rem;">
      <h2 style="font-family:'Space Grotesk',sans-serif;font-size:1.125rem;font-weight:600;color:#dbe2fd;margin:0;">Histórico de Créditos</h2>
      <!-- Period filters -->
      <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <label style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.08em;">De</label>
          <input type="date" [(ngModel)]="filterFrom"
                 style="background:#222a3e;color:#dbe2fd;font-family:'JetBrains Mono',monospace;font-size:0.7rem;padding:0.25rem 0.5rem;border:1px solid rgba(70,70,79,0.4);border-radius:0.25rem;outline:none;" />
        </div>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <label style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.08em;">Até</label>
          <input type="date" [(ngModel)]="filterTo"
                 style="background:#222a3e;color:#dbe2fd;font-family:'JetBrains Mono',monospace;font-size:0.7rem;padding:0.25rem 0.5rem;border:1px solid rgba(70,70,79,0.4);border-radius:0.25rem;outline:none;" />
        </div>
        <button (click)="applyFilter()"
                style="padding:0.25rem 0.75rem;background:#c0c1ff;color:#4b4d83;font-family:'JetBrains Mono',monospace;font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;border:none;border-radius:0.25rem;cursor:pointer;">
          Filtrar
        </button>
        @if (filterFrom || filterTo) {
          <button (click)="clearFilter()"
                  style="padding:0.25rem 0.75rem;background:transparent;color:#c7c5d0;font-family:'JetBrains Mono',monospace;font-size:0.65rem;border:1px solid rgba(70,70,79,0.4);border-radius:0.25rem;cursor:pointer;">
            Limpar
          </button>
        }
      </div>
    </div>

    <!-- Consolidated summary -->
    @if (summary()) {
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;background:#1a2236;border:1px solid rgba(70,70,79,0.3);border-radius:0.25rem;padding:1rem;margin-bottom:1rem;">
        <div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:1.25rem;color:#ffb4ab;">{{ summary()!.credits_consumed }}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.08em;margin-top:0.25rem;">Créditos consumidos</div>
        </div>
        <div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:1.25rem;color:#c0c1ff;">+{{ summary()!.credits_added }}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.08em;margin-top:0.25rem;">Créditos adicionados</div>
        </div>
        <div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:1.25rem;color:#dbe2fd;">{{ summary()!.agent_events }}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.08em;margin-top:0.25rem;">Execuções de agente</div>
        </div>
        <div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:1.25rem;color:#dbe2fd;">{{ summary()!.ocr_events }}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#c7c5d0;text-transform:uppercase;letter-spacing:0.08em;margin-top:0.25rem;">OCR utilizados</div>
        </div>
      </div>
    }

    <div style="background:#222a3e;border-radius:0.25rem;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid rgba(70,70,79,0.2);">
            <th style="text-align:left;padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:#c7c5d0;font-weight:500;">Data</th>
            <th style="text-align:left;padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:#c7c5d0;font-weight:500;">Tipo</th>
            <th style="text-align:left;padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:#c7c5d0;font-weight:500;">Detalhes</th>
            <th style="text-align:right;padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:#c7c5d0;font-weight:500;">Créditos</th>
          </tr>
        </thead>
        <tbody>
          @for (item of history(); track item.id) {
            <tr style="border-bottom:1px solid rgba(70,70,79,0.1);">
              <td style="padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#c7c5d0;white-space:nowrap;">{{ item.created_at | date:'dd/MM/yy HH:mm' }}</td>
              <td style="padding:0.75rem 1rem;">
                <span style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;padding:0.125rem 0.5rem;border-radius:2px;"
                      [style.background]="item.amount > 0 ? 'rgba(192,193,255,0.1)' : 'rgba(147,0,10,0.2)'"
                      [style.color]="item.amount > 0 ? '#c0c1ff' : '#ffb4ab'">
                  {{ kindLabel(item.kind) }}
                </span>
              </td>
              <td style="padding:0.75rem 1rem;">
                @if (item.subject_name || item.file_name) {
                  <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                    <span style="font-size:0.8rem;color:#dbe2fd;">{{ item.subject_name }}</span>
                    @if (item.description) {
                      <span style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.06em;padding:0.1rem 0.4rem;border-radius:2px;background:rgba(192,193,255,0.08);color:#a0a2e8;">{{ agentLabel(item.description) }}</span>
                    }
                  </div>
                  <div style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:#c7c5d0;margin-top:0.2rem;">{{ item.file_name }}</div>
                } @else {
                  <span style="font-size:0.8rem;color:#dbe2fd;">{{ item.description || '—' }}</span>
                }
              </td>
              <td style="padding:0.75rem 1rem;text-align:right;font-family:'JetBrains Mono',monospace;font-size:0.875rem;white-space:nowrap;"
                  [style.color]="item.amount > 0 ? '#c0c1ff' : '#ffb4ab'">
                {{ item.amount > 0 ? '+' : '' }}{{ item.amount }}
              </td>
            </tr>
          }
          @empty {
            <tr>
              <td colspan="4" style="padding:2rem;text-align:center;font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#c7c5d0;">
                Nenhuma movimentação encontrada.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    @if (totalPages() > 1) {
      <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:1rem;">
        <button (click)="prevPage()" [disabled]="currentPage() === 1"
                style="padding:0.375rem 0.75rem;background:#222a3e;color:#dbe2fd;font-family:'JetBrains Mono',monospace;font-size:0.75rem;border:none;border-radius:0.25rem;cursor:pointer;"
                [style.opacity]="currentPage() === 1 ? '0.3' : '1'">&#8592;</button>
        <span style="padding:0.375rem 0.75rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#c7c5d0;">{{ currentPage() }} / {{ totalPages() }}</span>
        <button (click)="nextPage()" [disabled]="currentPage() === totalPages()"
                style="padding:0.375rem 0.75rem;background:#222a3e;color:#dbe2fd;font-family:'JetBrains Mono',monospace;font-size:0.75rem;border:none;border-radius:0.25rem;cursor:pointer;"
                [style.opacity]="currentPage() === totalPages() ? '0.3' : '1'">&#8594;</button>
      </div>
    }
  </div>

  <!-- Topup modal -->
  @if (openTopup) {
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:50;display:flex;align-items:center;justify-content:center;padding:1rem;"
         (click)="openTopup = false">
      <div style="background:#222a3e;padding:2rem;border-radius:0.25rem;width:100%;max-width:400px;"
           (click)="$event.stopPropagation()">
        <h3 style="font-family:'Space Grotesk',sans-serif;font-size:1.25rem;font-weight:700;color:#dbe2fd;margin-bottom:1.5rem;">Recarregar Créditos</h3>
        <div style="display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1.5rem;">
          @for (pkg of creditPackages; track pkg.credits) {
            <div (click)="selectedCredits = pkg.credits"
                 style="display:flex;align-items:center;justify-content:space-between;padding:1rem;border-radius:0.25rem;cursor:pointer;border:2px solid transparent;transition:all 0.2s;"
                 [style.borderColor]="selectedCredits === pkg.credits ? '#c0c1ff' : 'transparent'"
                 [style.background]="selectedCredits === pkg.credits ? '#171f33' : '#060d20'">
              <div>
                <div style="font-family:'JetBrains Mono',monospace;font-weight:700;color:#c0c1ff;">{{ pkg.credits }} créditos</div>
                <div style="font-size:0.75rem;color:#c7c5d0;">R$ {{ pkg.price.toFixed(2) }} (R$ {{ pkg.perCredit }}/crédito)</div>
              </div>
              @if (selectedCredits === pkg.credits) {
                <span style="color:#c0c1ff;font-family:'JetBrains Mono',monospace;font-size:0.75rem;">&#10003;</span>
              }
            </div>
          }
        </div>
        <div style="margin-bottom:1.5rem;">
          <label style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;color:#c7c5d0;display:block;margin-bottom:0.5rem;">Forma de Pagamento</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
            <div (click)="topupGateway = 'stripe'" style="padding:0.75rem;border-radius:0.25rem;cursor:pointer;text-align:center;border:2px solid transparent;transition:all 0.2s;"
                 [style.borderColor]="topupGateway === 'stripe' ? '#c0c1ff' : 'transparent'"
                 [style.background]="topupGateway === 'stripe' ? '#171f33' : '#060d20'">
              <div style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#c0c1ff;">Stripe</div>
              <div style="font-size:0.65rem;color:#c7c5d0;">Cartão</div>
            </div>
            <div (click)="topupGateway = 'mercadopago'" style="padding:0.75rem;border-radius:0.25rem;cursor:pointer;text-align:center;border:2px solid transparent;transition:all 0.2s;"
                 [style.borderColor]="topupGateway === 'mercadopago' ? '#c0c1ff' : 'transparent'"
                 [style.background]="topupGateway === 'mercadopago' ? '#171f33' : '#060d20'">
              <div style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#c0c1ff;">Mercado Pago</div>
              <div style="font-size:0.65rem;color:#c7c5d0;">PIX / Boleto</div>
            </div>
          </div>
        </div>
        @if (topupError()) {
          <p style="color:#ffb4ab;font-family:'JetBrains Mono',monospace;font-size:0.75rem;margin-bottom:1rem;">{{ topupError() }}</p>
        }
        <button (click)="confirmTopup()" [disabled]="topupLoading()"
                style="width:100%;padding:0.75rem;background:#c0c1ff;color:#4b4d83;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;border:none;border-radius:0.25rem;cursor:pointer;"
                [style.opacity]="topupLoading() ? '0.5' : '1'">
          {{ topupLoading() ? 'Aguarde...' : 'Ir para pagamento' }}
        </button>
      </div>
    </div>
  }

</div>
  `,
})
export class BillingComponent implements OnInit {
  balance = signal<number>(0);
  balancePct = signal<number>(0);
  history = signal<LedgerItem[]>([]);
  summary = signal<LedgerSummary | null>(null);
  usage = signal<UsageReport | null>(null);
  usageDays = 30;
  currentPage = signal<number>(1);
  totalPages = signal<number>(1);
  filterFrom = '';
  filterTo = '';
  openTopup = false;
  selectedCredits: number | null = null;
  topupGateway: 'stripe' | 'mercadopago' | '' = '';
  topupLoading = signal<boolean>(false);
  topupError = signal<string>('');

  readonly creditPackages = [
    { credits: 100, price: 49.90, perCredit: '0,49' },
    { credits: 250, price: 109.90, perCredit: '0,44' },
    { credits: 500, price: 199.90, perCredit: '0,40' }
  ];

  constructor(private billingService: BillingService) {}

  ngOnInit(): void {
    this.loadBalance();
    this.loadHistory();
    this.loadUsage();
  }

  loadBalance(): void {
    this.billingService.getBalance().subscribe(({ balance }) => {
      this.balance.set(balance);
      this.balancePct.set(Math.min(100, Math.round((balance / 500) * 100)));
    });
  }

  loadHistory(): void {
    this.billingService.getHistory(this.currentPage(), 20, this.filterFrom || undefined, this.filterTo || undefined)
      .subscribe(({ items, total, limit, summary }) => {
        this.history.set(items);
        this.totalPages.set(Math.ceil(total / limit) || 1);
        this.summary.set(summary);
      });
  }

  applyFilter(): void {
    this.currentPage.set(1);
    this.loadHistory();
  }

  clearFilter(): void {
    this.filterFrom = '';
    this.filterTo = '';
    this.currentPage.set(1);
    this.loadHistory();
  }

  loadUsage(): void {
    this.billingService.getUsage(this.usageDays).subscribe(data => this.usage.set(data));
  }

  prevPage(): void {
    if (this.currentPage() > 1) { this.currentPage.update(p => p - 1); this.loadHistory(); }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) { this.currentPage.update(p => p + 1); this.loadHistory(); }
  }

  agentLabel(description: string): string {
    const map: Record<string, string> = {
      'metabolic': 'Metabólico', 'cardiovascular': 'Cardiovascular',
      'hematology': 'Hematologia', 'therapeutic': 'Terapêutico',
      'nutrition': 'Nutrição', 'clinical_correlation': 'Correlação Clínica',
      'small_animals': 'Pequenos Animais', 'equine': 'Equino', 'bovine': 'Bovino'
    };
    const agent = description.replace(/^Agent:\s*/i, '').trim().toLowerCase();
    return map[agent] ?? description;
  }

  kindLabel(kind: string): string {
    const labels: Record<string, string> = {
      subscription_bonus: 'Bônus', topup: 'Recarga', topup_recurring: 'Recorrente',
      agent_usage: 'Consumo', ocr_usage: 'OCR', adjustment: 'Ajuste'
    };
    return labels[kind] ?? kind;
  }

  confirmTopup(): void {
    this.topupError.set('');
    if (!this.selectedCredits) { this.topupError.set('Selecione um pacote.'); return; }
    if (!this.topupGateway) { this.topupError.set('Selecione uma forma de pagamento.'); return; }
    this.topupLoading.set(true);
    this.billingService.topup(this.topupGateway, this.selectedCredits).subscribe({
      next: ({ checkout_url }) => { window.location.href = checkout_url; },
      error: (err) => { this.topupLoading.set(false); this.topupError.set(err.error?.error ?? 'Erro ao iniciar pagamento.'); }
    });
  }
}
