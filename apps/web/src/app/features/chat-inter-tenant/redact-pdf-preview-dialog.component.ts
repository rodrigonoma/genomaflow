import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

export interface RedactPdfPreviewDialogData {
  filename: string;
  redacted_data_base64: string;   // PDF redigido (base64) — vem direto do backend
  original_url: string;           // signed URL do PDF original (TTL 30min)
  redacted_url: string;           // signed URL do PDF redigido (TTL 30min)
  summary: Record<string, number>;  // ex: { name: 3, cpf: 1, phone: 2 }
  total_regions: number;
  page_count: number;
}

export interface RedactPdfPreviewDialogResult {
  filename: string;
  mime_type: 'application/pdf';
  data_base64: string;            // PDF redigido pronto pra enviar
  total_regions: number;
  page_count: number;
}

const KIND_LABELS: Record<string, string> = {
  name: 'nome',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  rg: 'RG',
  phone: 'telefone',
  email: 'e-mail',
  cep: 'CEP',
  date: 'data',
};

@Component({
  selector: 'app-redact-pdf-preview-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatCheckboxModule, FormsModule],
  styles: [`
    :host { display:flex; flex-direction:column; max-height:90vh; color:#dae2fd; }
    .header { display:flex; align-items:center; justify-content:space-between; padding:1.25rem 1.5rem 0.5rem; flex-shrink:0; }
    .header h2 { font-family:'Space Grotesk',sans-serif; font-size:1.0625rem; font-weight:700; margin:0; color:#c0c1ff; }
    .subtitle { padding:0 1.5rem 0.75rem; font-family:'JetBrains Mono',monospace; font-size:10px; color:#908fa0; letter-spacing:0.08em; text-transform:uppercase; flex-shrink:0; }
    .body { padding:0 1.5rem 1rem; display:flex; flex-direction:column; gap:0.875rem; overflow-y:auto; flex:1; min-height:0; }
    .summary-card {
      background:rgba(192,193,255,0.06); border:1px solid rgba(192,193,255,0.15);
      border-radius:6px; padding:0.75rem 1rem;
    }
    .summary-title {
      font-family:'JetBrains Mono',monospace; font-size:11px;
      color:#908fa0; letter-spacing:0.08em; text-transform:uppercase;
      margin-bottom:0.5rem;
    }
    .summary-chips { display:flex; flex-wrap:wrap; gap:0.5rem; }
    .chip {
      display:inline-flex; align-items:center; gap:0.375rem;
      padding:0.25rem 0.625rem; border-radius:12px;
      background:rgba(192,193,255,0.12); border:1px solid rgba(192,193,255,0.2);
      font-family:'JetBrains Mono',monospace; font-size:11px;
      color:#dae2fd;
    }
    .chip strong { color:#c0c1ff; }
    .preview-wrap {
      background:#000; border:1px solid rgba(70,69,84,0.3); border-radius:6px;
      overflow:hidden; flex:1; min-height:300px; display:flex;
    }
    .preview-wrap iframe { flex:1; width:100%; height:55vh; border:none; }
    .original-link {
      font-family:'JetBrains Mono',monospace; font-size:11px;
      color:#c0c1ff; text-decoration:underline; cursor:pointer;
      align-self:flex-start;
    }
    .original-link:hover { color:#dae2fd; }
    .info {
      font-size:0.75rem; color:#a09fb2; font-family:'JetBrains Mono',monospace;
      line-height:1.5;
      background:rgba(192,193,255,0.06); padding:0.5rem 0.75rem; border-radius:5px;
    }
    .info strong { color:#c0c1ff; }
    .confirm-row { display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0; }
    .confirm-row ::ng-deep .mdc-form-field,
    .confirm-row ::ng-deep .mdc-form-field > label,
    .confirm-row ::ng-deep .mdc-label { color:#dae2fd !important; font-size:0.8125rem; }
    .footer {
      display:flex; justify-content:space-between; align-items:center;
      padding:0.875rem 1.5rem; border-top:1px solid rgba(70,69,84,0.2);
      flex-shrink:0; background:#0b1326;
    }
    .footer-left { font-size:0.75rem; color:#7c7b8f; font-family:'JetBrains Mono',monospace; }
    .footer-buttons { display:flex; gap:0.625rem; }
    .submit-btn {
      background:#c0c1ff; color:#1000a9; border:none; border-radius:6px;
      padding:0.625rem 1.125rem; font-size:0.75rem; font-weight:700;
      letter-spacing:0.06em; text-transform:uppercase; cursor:pointer;
    }
    .submit-btn:disabled { opacity:0.4; cursor:not-allowed; }
  `],
  template: `
    <div class="header">
      <h2>Preview do PDF redigido</h2>
      <button mat-icon-button (click)="cancel()"><mat-icon>close</mat-icon></button>
    </div>
    <div class="subtitle">Revise antes do envio — obrigatório</div>
    <div class="body">
      <div class="summary-card">
        <div class="summary-title">Detectamos e cobrimos</div>
        <div class="summary-chips">
          @for (entry of summaryEntries(); track entry.kind) {
            <span class="chip">
              <strong>{{ entry.count }}</strong>
              {{ entry.label }}{{ entry.count > 1 ? 's' : '' }}
            </span>
          }
          @if (summaryEntries().length === 0) {
            <span class="chip">Nenhum dado pessoal detectado</span>
          }
        </div>
      </div>

      <div class="info">
        <strong>{{ data.page_count }}</strong> página{{ data.page_count > 1 ? 's' : '' }} ·
        <strong>{{ data.total_regions }}</strong> bloco{{ data.total_regions === 1 ? '' : 's' }} aplicado{{ data.total_regions === 1 ? '' : 's' }}.
        Os retângulos pretos abaixo cobrem os dados pessoais. O texto por baixo
        permanece (text layer), mas <strong>fica oculto na visualização</strong>.
      </div>

      <a class="original-link" [href]="data.original_url" target="_blank" rel="noopener">
        Ver PDF original em nova aba ↗
      </a>

      <div class="preview-wrap">
        <iframe [src]="previewSafeUrl()" title="PDF redigido"></iframe>
      </div>

      <div class="confirm-row">
        <mat-checkbox [(ngModel)]="confirmed" color="primary">
          Confirmo que revisei e o PDF redigido está adequado para envio
        </mat-checkbox>
      </div>
    </div>
    <div class="footer">
      <div class="footer-left">Engine: pdfjs + pdf-lib + Haiku</div>
      <div class="footer-buttons">
        <button mat-button (click)="cancel()">Cancelar</button>
        <button class="submit-btn" [disabled]="!canSubmit()" (click)="submit()">Enviar PDF</button>
      </div>
    </div>
  `,
})
export class RedactPdfPreviewDialogComponent implements OnInit, OnDestroy {
  private ref = inject(MatDialogRef<RedactPdfPreviewDialogComponent, RedactPdfPreviewDialogResult | null>);
  private sanitizer = inject(DomSanitizer);
  data: RedactPdfPreviewDialogData = inject(MAT_DIALOG_DATA);

  confirmed = false;
  private blobUrl = signal<string | null>(null);

  summaryEntries = signal<{ kind: string; label: string; count: number }[]>([]);

  ngOnInit() {
    // Monta blob URL a partir do base64 — evita o iframe ir até o S3 (que pode
    // ter CORS/auth headers inconvenientes pro <iframe>) e garante render imediato.
    const bytes = base64ToBytes(this.data.redacted_data_base64);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    this.blobUrl.set(url);

    // Summary chips ordenados por contagem desc
    const entries = Object.entries(this.data.summary || {})
      .map(([kind, count]) => ({
        kind,
        label: KIND_LABELS[kind] || kind,
        count: count as number,
      }))
      .sort((a, b) => b.count - a.count);
    this.summaryEntries.set(entries);
  }

  ngOnDestroy() {
    const u = this.blobUrl();
    if (u) URL.revokeObjectURL(u);
  }

  previewSafeUrl(): SafeResourceUrl | null {
    const u = this.blobUrl();
    return u ? this.sanitizer.bypassSecurityTrustResourceUrl(u) : null;
  }

  canSubmit(): boolean {
    return this.confirmed;
  }

  cancel(): void {
    this.ref.close(null);
  }

  submit(): void {
    if (!this.canSubmit()) return;
    const out = this.data.filename.replace(/\.pdf$/i, '') + '-redigido.pdf';
    this.ref.close({
      filename: out,
      mime_type: 'application/pdf',
      data_base64: this.data.redacted_data_base64,
      total_regions: this.data.total_regions,
      page_count: this.data.page_count,
    });
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
