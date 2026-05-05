import { Component, Inject, OnInit, signal, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PortalTokensService, PortalToken } from './portal-tokens.service';

interface DialogData {
  /** Subject (paciente humano OU animal) — passa se quer escopo de 1 paciente */
  subject_id?: string;
  subject_name?: string;
  /** Owner (tutor vet) — passa se quer escopo de TODOS animais do tutor */
  owner_id?: string;
  owner_name?: string;
  /** Telefone do destinatário pra enviar via WhatsApp (opcional). */
  phone?: string | null;
}

/**
 * Modal admin pra gerar/listar/revogar portal tokens de um paciente ou tutor.
 * Backend pronto desde Phase 3 — esta UI só consome.
 */
@Component({
  selector: 'app-portal-token-dialog',
  standalone: true,
  imports: [CommonModule, DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatSnackBarModule],
  template: `
    <h2 mat-dialog-title>
      Portal —
      @if (data.subject_name) { {{ data.subject_name }} }
      @else if (data.owner_name) { {{ data.owner_name }} (todos animais) }
    </h2>

    <mat-dialog-content>
      <p class="muted">Gere um link de acesso ao portal read-only. Validade: 90 dias.</p>

      @if (justGenerated()) {
        <div class="link-card">
          <div class="link-label">Link gerado:</div>
          <div class="link-value">{{ justGenerated()!.link }}</div>
          <div class="link-actions">
            <button mat-stroked-button (click)="copyLink(justGenerated()!.link!)">
              <mat-icon>content_copy</mat-icon> Copiar
            </button>
            @if (data.phone) {
              <a mat-stroked-button [href]="whatsappLink(justGenerated()!.link!)" target="_blank" rel="noopener" class="wa-btn">
                <mat-icon>chat</mat-icon> Enviar por WhatsApp
              </a>
            }
          </div>
          <div class="link-expires muted">
            Expira: {{ justGenerated()!.expires_at | date:'dd/MM/yyyy' }}
          </div>
        </div>
      }

      <button mat-flat-button color="primary" (click)="generate()" [disabled]="generating()">
        <mat-icon>add_link</mat-icon>
        {{ generating() ? 'Gerando...' : (justGenerated() ? 'Gerar novo link' : 'Gerar link de acesso') }}
      </button>

      <h3>Tokens existentes</h3>
      @if (loading()) {
        <p class="muted">Carregando...</p>
      } @else if (filteredTokens().length === 0) {
        <p class="muted">Nenhum link de portal gerado ainda para este {{ scopeLabel() }}.</p>
      } @else {
        <table class="tokens-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Criado em</th>
              <th>Expira em</th>
              <th>Último acesso</th>
              <th>Acessos</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (t of filteredTokens(); track t.id) {
              <tr [class.revoked]="t.revoked_at" [class.expired]="isExpired(t)">
                <td>
                  @if (t.revoked_at) { <span class="badge revoked">Revogado</span> }
                  @else if (isExpired(t)) { <span class="badge expired">Expirado</span> }
                  @else { <span class="badge active">Ativo</span> }
                </td>
                <td>{{ t.created_at | date:'dd/MM/yyyy HH:mm' }}</td>
                <td>{{ t.expires_at | date:'dd/MM/yyyy' }}</td>
                <td>{{ t.last_accessed_at ? (t.last_accessed_at | date:'dd/MM/yyyy HH:mm') : '—' }}</td>
                <td>{{ t.access_count }}</td>
                <td>
                  @if (!t.revoked_at && !isExpired(t)) {
                    <button mat-icon-button (click)="revoke(t)" matTooltip="Revogar">
                      <mat-icon>block</mat-icon>
                    </button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Fechar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; min-width: 540px; }
    .muted { color: rgba(0,0,0,0.6); font-size: 0.875rem; margin: 4px 0 12px; }
    h3 { margin: 24px 0 8px; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(0,0,0,0.7); }

    .link-card { background: #e8f5e9; border-left: 3px solid #25D366; padding: 12px 16px; border-radius: 4px; margin-bottom: 16px; }
    .link-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: #2e7d32; margin-bottom: 4px; font-weight: 600; }
    .link-value { font-family: 'JetBrains Mono', monospace; font-size: 0.8125rem; word-break: break-all; padding: 8px; background: #fff; border-radius: 3px; margin-bottom: 8px; }
    .link-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .link-actions a.wa-btn { background: #25D366; color: #fff; border: none; }
    .link-expires { margin-top: 8px; font-size: 0.75rem; }

    .tokens-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .tokens-table th, .tokens-table td { padding: 8px; text-align: left; border-bottom: 1px solid rgba(0,0,0,0.08); }
    .tokens-table th { font-weight: 600; color: rgba(0,0,0,0.7); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .tokens-table tr.revoked, .tokens-table tr.expired { opacity: 0.5; }

    .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .badge.active { background: #e8f5e9; color: #2e7d32; }
    .badge.revoked { background: #ffebee; color: #c62828; }
    .badge.expired { background: #fff3e0; color: #e65100; }
  `]
})
export class PortalTokenDialogComponent implements OnInit {
  private service = inject(PortalTokensService);
  private snack = inject(MatSnackBar);
  private dialogRef = inject(MatDialogRef<PortalTokenDialogComponent>);

  loading = signal(true);
  generating = signal(false);
  tokens = signal<PortalToken[]>([]);
  justGenerated = signal<PortalToken | null>(null);

  constructor(@Inject(MAT_DIALOG_DATA) public data: DialogData) {}

  ngOnInit() {
    this.refresh();
  }

  scopeLabel(): string {
    return this.data.subject_id ? 'paciente' : 'tutor';
  }

  filteredTokens() {
    const target = this.data.subject_id ?? this.data.owner_id;
    return this.tokens().filter(t =>
      (this.data.subject_id && t.subject_id === target) ||
      (this.data.owner_id && t.owner_id === target)
    );
  }

  isExpired(t: PortalToken): boolean {
    return new Date(t.expires_at) < new Date();
  }

  refresh() {
    this.loading.set(true);
    this.service.list().subscribe({
      next: r => { this.tokens.set(r.items); this.loading.set(false); },
      error: () => { this.loading.set(false); this.snack.open('Erro ao carregar tokens', 'Fechar', { duration: 4000 }); },
    });
  }

  generate() {
    const body: any = {};
    if (this.data.subject_id) body.subject_id = this.data.subject_id;
    if (this.data.owner_id) body.owner_id = this.data.owner_id;

    this.generating.set(true);
    this.service.create(body).subscribe({
      next: t => {
        this.justGenerated.set(t);
        this.generating.set(false);
        this.refresh();
        this.snack.open('Link gerado com sucesso.', 'OK', { duration: 3000 });
      },
      error: (err) => {
        this.generating.set(false);
        const msg = err?.error?.error || 'Erro ao gerar link';
        this.snack.open(msg, 'Fechar', { duration: 5000 });
      },
    });
  }

  revoke(t: PortalToken) {
    if (!confirm(`Revogar este link? O destinatário perderá o acesso imediatamente.`)) return;
    this.service.revoke(t.id).subscribe({
      next: () => {
        this.refresh();
        this.snack.open('Link revogado.', 'OK', { duration: 3000 });
      },
      error: () => this.snack.open('Erro ao revogar', 'Fechar', { duration: 4000 }),
    });
  }

  copyLink(link: string) {
    navigator.clipboard?.writeText(link).then(
      () => this.snack.open('Link copiado!', 'OK', { duration: 2000 }),
      () => this.snack.open('Falha ao copiar — selecione manual', 'Fechar', { duration: 3000 }),
    );
  }

  whatsappLink(portalLink: string): string {
    if (!this.data.phone) return '#';
    const digits = String(this.data.phone).replace(/\D/g, '');
    let e164 = digits;
    if (digits.length === 10 || digits.length === 11) e164 = '55' + digits;
    const name = this.data.subject_name || this.data.owner_name || '';
    const text = encodeURIComponent(
      `Olá ${name}! Acesse seu portal exclusivo aqui: ${portalLink}`
    );
    return `https://wa.me/${e164}?text=${text}`;
  }

  close() { this.dialogRef.close(); }
}
