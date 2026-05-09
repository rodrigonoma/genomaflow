import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { environment } from '../../../environments/environment';

export interface ErrorDetailData { error_id: string; }

interface ErrorDetail {
  id: string;
  url: string | null;
  method: string | null;
  status_code: number | null;
  error_message: string | null;
  stack_trace: string | null;
  user_agent: string | null;
  request_body: string | null;
  created_at: string;
  tenant_id: string | null;
  user_id: string | null;
  tenant_name: string | null;
  user_email: string | null;
}

/**
 * Dialog que abre ao clicar numa linha do log de erros (master).
 * Mostra detalhe completo: stack trace, body, user-agent, contexto.
 *
 * Backend: GET /master/errors/:id
 */
@Component({
  selector: 'app-error-detail-dialog',
  standalone: true,
  imports: [
    CommonModule, DatePipe, MatDialogModule,
    MatIconModule, MatProgressSpinnerModule, MatSnackBarModule,
  ],
  styles: [`
    :host { color:#dae2fd; display:block; max-height:88vh; overflow:hidden; display:flex; flex-direction:column; min-width:640px; max-width:90vw; }

    .header { padding:1rem 1.25rem; display:flex; align-items:center; gap:.625rem;
              border-bottom:1px solid rgba(70,69,84,.25); }
    h2 { margin:0; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:1rem; color:#c0c1ff; flex:1; }
    .status-pill {
      padding:2px 8px; border-radius:10px; font-size:.65rem;
      font-family:'JetBrains Mono',monospace; text-transform:uppercase; letter-spacing:.08em;
    }
    .status-pill.s5 { background:rgba(220,38,38,.18); color:#fca5a5; border:1px solid rgba(239,68,68,.4); }
    .status-pill.s4 { background:rgba(252,211,77,.18); color:#fcd34d; border:1px solid rgba(252,211,77,.4); }
    .status-pill.snull { background:rgba(70,69,84,.3); color:#a09fb2; border:1px solid rgba(70,69,84,.5); }
    .close-btn { background:transparent; border:none; color:#a09fb2; cursor:pointer; }

    .body { padding:1rem 1.25rem; overflow-y:auto; flex:1; }

    .section-label {
      font-family:'JetBrains Mono',monospace; font-size:9px; color:#7c7b8f;
      text-transform:uppercase; letter-spacing:.12em; margin-top:.875rem; margin-bottom:.375rem;
    }
    .row { display:flex; gap:.5rem; padding:.25rem 0; font-size:.8rem; }
    .row .k { color:#7c7b8f; min-width:90px; }
    .row .v { color:#dae2fd; font-family:'JetBrains Mono',monospace; word-break:break-all; flex:1; }

    .url-row { background:#0e1525; padding:.625rem .75rem; border-radius:5px;
               border:1px solid rgba(70,69,84,.25); display:flex; align-items:center; gap:.5rem; }
    .method { font-family:'JetBrains Mono',monospace; font-weight:700; font-size:.7rem;
              color:#c0c1ff; padding:2px 7px; background:rgba(192,193,255,.15); border-radius:3px; }
    .url { font-family:'JetBrains Mono',monospace; font-size:.78rem; color:#dae2fd;
           word-break:break-all; flex:1; }

    .msg-box {
      background:rgba(220,38,38,.08); border:1px solid rgba(239,68,68,.3);
      border-radius:6px; padding:.75rem .875rem; color:#fca5a5;
      font-size:.85rem; line-height:1.5; white-space:pre-wrap; word-break:break-word;
    }

    .stack-box {
      background:#08101e; border:1px solid rgba(70,69,84,.3); border-radius:6px;
      padding:.75rem 1rem; max-height:340px; overflow:auto;
      font-family:'JetBrains Mono',monospace; font-size:.7rem; line-height:1.6;
      color:#dae2fd; white-space:pre; word-break:normal;
    }
    .stack-box::-webkit-scrollbar { width:8px; height:8px; }
    .stack-box::-webkit-scrollbar-thumb { background:rgba(70,69,84,.5); border-radius:4px; }

    .body-box {
      background:#0e1525; border:1px solid rgba(70,69,84,.25); border-radius:5px;
      padding:.625rem .75rem; max-height:200px; overflow:auto;
      font-family:'JetBrains Mono',monospace; font-size:.7rem; color:#a09fb2; white-space:pre-wrap;
    }

    .empty { color:#6e6d80; font-style:italic; font-size:.8rem; padding:.625rem; text-align:center;
             background:#0e1525; border-radius:5px; }

    .footer { padding:.75rem 1.25rem; display:flex; justify-content:space-between; gap:.625rem;
              border-top:1px solid rgba(70,69,84,.25); align-items:center; }
    .copy-btn {
      background:transparent; color:#a09fb2; border:1px solid rgba(70,69,84,.4); border-radius:5px;
      padding:.45rem .875rem; cursor:pointer; font-size:.72rem;
      display:inline-flex; align-items:center; gap:.4rem;
    }
    .copy-btn:hover { color:#dae2fd; border-color:rgba(192,193,255,.4); }
    .btn-primary {
      background:#c0c1ff; color:#1000a9; border:none; border-radius:5px;
      padding:.5rem 1rem; cursor:pointer; font-size:.72rem; font-weight:700;
      letter-spacing:.05em; text-transform:uppercase;
    }

    .loading { display:flex; gap:.625rem; align-items:center; color:#7c7b8f; padding:2rem; }
  `],
  template: `
    <div class="header">
      <mat-icon style="color:#fca5a5;">bug_report</mat-icon>
      @if (detail()) {
        <h2>{{ detail()!.method }} · {{ detail()!.status_code ?? 'erro' }}</h2>
        <span class="status-pill" [class.s5]="(detail()!.status_code ?? 0) >= 500"
              [class.s4]="(detail()!.status_code ?? 0) >= 400 && (detail()!.status_code ?? 0) < 500"
              [class.snull]="!detail()!.status_code">
          {{ detail()!.status_code ?? 'sem status' }}
        </span>
      } @else {
        <h2>Detalhes do erro</h2>
      }
      <button class="close-btn" (click)="ref.close()" aria-label="Fechar">
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <div class="body">
      @if (loading()) {
        <div class="loading">
          <mat-spinner diameter="22"></mat-spinner> Carregando detalhes…
        </div>
      } @else if (detail()) {
        <div class="section-label">Requisição</div>
        <div class="url-row">
          <span class="method">{{ detail()!.method || '?' }}</span>
          <span class="url">{{ detail()!.url || '(sem URL)' }}</span>
        </div>

        <div class="section-label">Contexto</div>
        <div class="row"><span class="k">Quando</span><span class="v">{{ detail()!.created_at | date:'dd/MM/yyyy HH:mm:ss' }}</span></div>
        <div class="row"><span class="k">Tenant</span><span class="v">{{ detail()!.tenant_name || '—' }} <span style="color:#6e6d80;">{{ detail()!.tenant_id ? '(' + detail()!.tenant_id + ')' : '' }}</span></span></div>
        <div class="row"><span class="k">Usuário</span><span class="v">{{ detail()!.user_email || '—' }}</span></div>
        <div class="row"><span class="k">User-Agent</span><span class="v" style="font-size:.7rem;color:#a09fb2;">{{ detail()!.user_agent || '—' }}</span></div>

        <div class="section-label">Mensagem</div>
        @if (detail()!.error_message) {
          <div class="msg-box">{{ detail()!.error_message }}</div>
        } @else {
          <div class="empty">Sem mensagem</div>
        }

        <div class="section-label">Stack trace</div>
        @if (detail()!.stack_trace) {
          <div class="stack-box">{{ detail()!.stack_trace }}</div>
        } @else {
          <div class="empty">Stack trace não disponível (cliente antigo ou erro sem stack)</div>
        }

        @if (detail()!.request_body) {
          <div class="section-label">Request body (parcial)</div>
          <div class="body-box">{{ detail()!.request_body }}</div>
        }
      } @else if (errorMsg()) {
        <div class="msg-box">{{ errorMsg() }}</div>
      }
    </div>

    <div class="footer">
      @if (detail()) {
        <button class="copy-btn" (click)="copyAll()">
          <mat-icon style="font-size:14px;width:14px;height:14px;">content_copy</mat-icon>
          Copiar tudo
        </button>
      } @else { <span></span> }
      <button class="btn-primary" (click)="ref.close()">Fechar</button>
    </div>
  `,
})
export class ErrorDetailDialogComponent implements OnInit {
  data: ErrorDetailData = inject(MAT_DIALOG_DATA);
  ref   = inject(MatDialogRef<ErrorDetailDialogComponent, void>);
  private http = inject(HttpClient);
  private snack = inject(MatSnackBar);

  detail = signal<ErrorDetail | null>(null);
  loading = signal(true);
  errorMsg = signal<string | null>(null);

  ngOnInit() {
    this.http.get<ErrorDetail>(`${environment.apiUrl}/master/errors/${this.data.error_id}`).subscribe({
      next: (d) => { this.detail.set(d); this.loading.set(false); },
      error: (err) => {
        this.loading.set(false);
        this.errorMsg.set(err.error?.error || 'Não foi possível carregar o erro');
      },
    });
  }

  copyAll() {
    const d = this.detail();
    if (!d) return;
    const txt = [
      `[${d.method} ${d.status_code ?? '—'}] ${d.url ?? ''}`,
      `Quando: ${d.created_at}`,
      `Tenant: ${d.tenant_name || '—'} (${d.tenant_id ?? ''})`,
      `User: ${d.user_email || '—'}`,
      `UA: ${d.user_agent || '—'}`,
      ``,
      `Message:`,
      d.error_message || '(sem mensagem)',
      ``,
      `Stack:`,
      d.stack_trace || '(sem stack)',
      d.request_body ? `\nBody:\n${d.request_body}` : '',
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(txt).then(
      () => this.snack.open('Detalhes copiados', '', { duration: 2000 }),
      () => this.snack.open('Falha ao copiar', '', { duration: 3000 })
    );
  }
}
