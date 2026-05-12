/**
 * PdfPreviewModalComponent
 *
 * Abre em modal o PDF do protocolo de análise estética via iframe.
 * Busca o blob do PDF internamente e expõe botão "Baixar" para download local.
 *
 * URL.revokeObjectURL é chamado em ngOnDestroy para evitar memory leak.
 *
 * Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md §F6 TODO#6
 */
import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '../../../../environments/environment';

export interface PdfPreviewModalData {
  analysisId: string;
  filename?: string;       // default: `analise-${analysisId}.pdf`
}

@Component({
  selector: 'app-pdf-preview-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  styles: [`
    :host { display: block; }
    .modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.25rem; border-bottom: 1px solid rgba(70,69,84,0.18);
      gap: 1rem;
    }
    h2 { margin: 0; font-size: 1.05rem; color: #dae2fd; }
    .actions { display: flex; gap: 0.5rem; }
    .pdf-frame {
      width: 100%; min-height: 70vh; max-height: 80vh;
      border: 0; background: #1a1a25;
    }
    .loading { padding: 2rem; text-align: center; color: #9b9aad; }
    .error { padding: 1.5rem; color: #f08585; }
  `],
  template: `
    <div class="modal-header">
      <h2>Protocolo PDF — pré-visualização</h2>
      <div class="actions">
        <button mat-stroked-button [disabled]="!pdfUrl()" (click)="download()">
          <mat-icon>download</mat-icon> Baixar
        </button>
        <button mat-icon-button (click)="close()" aria-label="Fechar">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    </div>

    @if (loading()) {
      <div class="loading">Gerando PDF...</div>
    } @else if (error()) {
      <div class="error">{{ error() }}</div>
    } @else if (safeUrl()) {
      <iframe class="pdf-frame" [src]="safeUrl()" title="PDF preview"></iframe>
    }
  `,
})
export class PdfPreviewModalComponent implements OnDestroy {
  readonly data: PdfPreviewModalData = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PdfPreviewModalComponent>);
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly pdfUrl = signal<string | null>(null);
  readonly safeUrl = signal<SafeResourceUrl | null>(null);

  constructor() {
    this.load();
  }

  private load() {
    const url = `${environment.apiUrl}/aesthetic/analyses/${this.data.analysisId}/export.pdf`;
    this.http.get(url, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const u = URL.createObjectURL(blob);
        this.pdfUrl.set(u);
        this.safeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(u));
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.message || 'Falha ao gerar PDF.');
        this.loading.set(false);
      },
    });
  }

  download() {
    const u = this.pdfUrl();
    if (!u) return;
    const a = document.createElement('a');
    a.href = u;
    a.download = this.data.filename || `analise-${this.data.analysisId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  close() {
    this.dialogRef.close();
  }

  ngOnDestroy(): void {
    const u = this.pdfUrl();
    if (u) URL.revokeObjectURL(u);
  }
}
