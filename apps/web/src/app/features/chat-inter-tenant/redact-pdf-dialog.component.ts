import { Component, ElementRef, ViewChild, inject, signal, AfterViewInit, AfterViewChecked, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';

interface Region {
  x: number; y: number; w: number; h: number;
  kind?: string;
  manual?: boolean;
}

interface PdfPage {
  page_number: number;
  original_url: string;
  redacted_url: string;
  regions: Region[];
  width: number;
  height: number;
  engine: string;
  ocr_word_count: number;
}

interface RedactPdfApiResponse {
  redact_id: string;
  page_count: number;
  pages_processed: number;
  truncated: boolean;
  max_pages: number;
  pages: PdfPage[];
}

export interface RedactPdfDialogData {
  filename: string;
  data_base64: string;
}

export interface RedactPdfDialogResult {
  filename: string;
  mime_type: 'application/pdf';
  data_base64: string;          // PDF final (composto via pdf-lib)
  page_count: number;
  total_auto_regions: number;
  total_manual_added: number;
  total_manual_removed: number;
}

interface PageState {
  meta: PdfPage;
  imgEl: HTMLImageElement | null;
  imgLoaded: boolean;
  removedAutoIdx: Set<number>;
  manualRegions: Region[];
}

type Phase = 'loading' | 'ready' | 'composing' | 'error';

@Component({
  selector: 'app-redact-pdf-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatCheckboxModule, FormsModule],
  styles: [`
    /* Modal compact: header/subtitle topo, body com scroll, footer sempre visível */
    :host { display:flex; flex-direction:column; max-height:90vh; color:#dae2fd; }
    .header { display:flex; align-items:center; justify-content:space-between; padding:1.25rem 1.5rem 0.5rem; flex-shrink:0; }
    .header h2 { font-family:'Space Grotesk',sans-serif; font-size:1.0625rem; font-weight:700; margin:0; color:#c0c1ff; }
    .subtitle { padding:0 1.5rem 0.75rem; font-family:'JetBrains Mono',monospace; font-size:10px; color:#908fa0; letter-spacing:0.08em; text-transform:uppercase; flex-shrink:0; }
    .body { padding:0 1.5rem 1rem; display:flex; flex-direction:column; gap:0.875rem; overflow-y:auto; flex:1; min-height:0; }
    .pager { display:flex; align-items:center; justify-content:space-between; gap:0.75rem; padding:0.5rem 0.75rem; background:rgba(192,193,255,0.06); border-radius:6px; font-family:'JetBrains Mono',monospace; font-size:0.8125rem; }
    .pager-buttons { display:flex; gap:0.5rem; }
    .pager-btn { background:#0b1326; color:#c0c1ff; border:1px solid rgba(192,193,255,0.2); border-radius:5px; padding:0.375rem 0.75rem; font-size:0.75rem; font-family:inherit; cursor:pointer; }
    .pager-btn:disabled { opacity:0.3; cursor:not-allowed; }
    .canvas-wrap { position:relative; background:#000; border:1px solid rgba(70,69,84,0.3); border-radius:6px; overflow:auto; max-height:45vh; user-select:none; }
    canvas { display:block; cursor:crosshair; max-width:100%; }
    .instructions { font-size:0.75rem; color:#a09fb2; font-family:'JetBrains Mono',monospace; line-height:1.5; background:rgba(192,193,255,0.06); padding:0.5rem 0.75rem; border-radius:5px; }
    .instructions strong { color:#c0c1ff; }
    .stats { display:flex; gap:1rem; font-size:0.75rem; font-family:'JetBrains Mono',monospace; color:#908fa0; flex-wrap:wrap; }
    .stat-value { color:#dae2fd; font-weight:600; }
    .warning { background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.25); color:#fbbf24; font-family:'JetBrains Mono',monospace; font-size:11px; padding:0.625rem 0.75rem; border-radius:5px; line-height:1.45; }
    .confirm-row { display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0; }
    .confirm-row ::ng-deep .mdc-form-field,
    .confirm-row ::ng-deep .mdc-form-field > label,
    .confirm-row ::ng-deep .mdc-label { color:#dae2fd !important; font-size:0.8125rem; }
    .loading { text-align:center; padding:3rem 1rem; color:#908fa0; font-family:'JetBrains Mono',monospace; font-size:0.8125rem; }
    .footer { display:flex; justify-content:space-between; align-items:center; padding:0.875rem 1.5rem; border-top:1px solid rgba(70,69,84,0.2); flex-shrink:0; background:#0b1326; }
    .footer-left { font-size:0.75rem; color:#7c7b8f; font-family:'JetBrains Mono',monospace; }
    .footer-buttons { display:flex; gap:0.625rem; }
    .submit-btn { background:#c0c1ff; color:#1000a9; border:none; border-radius:6px; padding:0.625rem 1.125rem; font-size:0.75rem; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; cursor:pointer; }
    .submit-btn:disabled { opacity:0.4; cursor:not-allowed; }
  `],
  template: `
    <div class="header">
      <h2>Redação de dados pessoais — PDF</h2>
      <button mat-icon-button (click)="cancel()"><mat-icon>close</mat-icon></button>
    </div>
    <div class="subtitle">Revisão página por página antes do envio</div>
    <div class="body">
      @if (phase() === 'loading') {
        <div class="loading">Renderizando e analisando todas as páginas — pode levar alguns segundos por página...</div>
      } @else if (phase() === 'composing') {
        <div class="loading">Compondo PDF final...</div>
      } @else if (phase() === 'error') {
        <div class="warning">{{ errorMsg() }}</div>
      } @else {
        <div class="pager">
          <span>Página <strong style="color:#dae2fd">{{ currentIdx() + 1 }}</strong> de <strong style="color:#dae2fd">{{ pages().length }}</strong></span>
          <div class="pager-buttons">
            <button class="pager-btn" [disabled]="currentIdx() === 0" (click)="prevPage()">← Anterior</button>
            <button class="pager-btn" [disabled]="currentIdx() === pages().length - 1" (click)="nextPage()">Próxima →</button>
          </div>
        </div>

        @if (truncated()) {
          <div class="warning">
            ⚠ PDF tem mais que {{ maxPages() }} páginas — apenas as primeiras foram processadas.
            Páginas restantes não serão enviadas. Divida o PDF se precisar enviar tudo.
          </div>
        }

        <div class="instructions">
          <strong>Clique e arraste</strong> pra adicionar bloco; <strong>clique em cima</strong> pra remover.
          Vermelho = auto-detectado. Azul = manual. Reveja cada página antes de enviar.
        </div>

        @if (currentPageStats().autoDetected === 0 && currentPageStats().manualAdded === 0) {
          <div class="warning">
            Sem texto detectado nesta página. Adicione blocos manuais se houver PII visual.
          </div>
        }

        <div class="canvas-wrap">
          <canvas #canvas
                  (mousedown)="onMouseDown($event)"
                  (mousemove)="onMouseMove($event)"
                  (mouseup)="onMouseUp($event)"
                  (mouseleave)="onMouseUp($event)"></canvas>
        </div>

        <div class="stats">
          <span>Esta página — auto: <span class="stat-value">{{ currentPageStats().autoDetected }}</span></span>
          <span>removidos: <span class="stat-value">{{ currentPageStats().autoRemoved }}</span></span>
          <span>manuais: <span class="stat-value">{{ currentPageStats().manualAdded }}</span></span>
          <span>·</span>
          <span>Total no PDF: <span class="stat-value">{{ totalActiveRegions() }}</span> blocos</span>
        </div>

        <div class="confirm-row">
          <mat-checkbox [(ngModel)]="confirmed" color="primary">
            Confirmo que revisei todas as páginas e a versão final não contém dados pessoais identificáveis
          </mat-checkbox>
        </div>
      }
    </div>
    <div class="footer">
      <div class="footer-left">{{ engineLabel() }}</div>
      <div class="footer-buttons">
        <button mat-button (click)="cancel()" [disabled]="phase() === 'composing'">Cancelar</button>
        <button class="submit-btn" [disabled]="!canSubmit()" (click)="submit()">Enviar PDF</button>
      </div>
    </div>
  `,
})
export class RedactPdfDialogComponent implements AfterViewInit, AfterViewChecked {
  @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  private http = inject(HttpClient);
  private ref  = inject(MatDialogRef<RedactPdfDialogComponent, RedactPdfDialogResult | null>);
  data: RedactPdfDialogData = inject(MAT_DIALOG_DATA);

  phase    = signal<Phase>('loading');
  errorMsg = signal('');
  pages    = signal<PageState[]>([]);
  currentIdx = signal<number>(0);
  truncated = signal(false);
  maxPages = signal(20);

  confirmed = false;

  // Drag state
  private dragging = false;
  private dragStart: { x: number; y: number } | null = null;
  private dragCurrent: { x: number; y: number } | null = null;

  private lastDrawnPageIdx = -1;

  ngAfterViewInit(): void {
    this.callBackend();
  }

  ngAfterViewChecked(): void {
    // Rede de segurança: redesenha quando canvas+imagem prontos pra página atual
    if (this.phase() !== 'ready' || !this.canvasRef) return;
    const idx = this.currentIdx();
    const p = this.currentPage();
    if (!p || !p.imgEl || !p.imgLoaded) return;
    if (idx === this.lastDrawnPageIdx) return;
    this.redraw();
    this.lastDrawnPageIdx = idx;
  }

  engineLabel(): string {
    const ps = this.pages();
    if (ps.length === 0) return '';
    const engines = new Set(ps.map(p => p.meta.engine));
    return `Engine: ${[...engines].join(' / ')}`;
  }

  currentPage(): PageState | null {
    const ps = this.pages();
    return ps[this.currentIdx()] ?? null;
  }

  currentPageStats() {
    const p = this.currentPage();
    if (!p) return { autoDetected: 0, autoRemoved: 0, manualAdded: 0 };
    return {
      autoDetected: p.meta.regions.length,
      autoRemoved: p.removedAutoIdx.size,
      manualAdded: p.manualRegions.length,
    };
  }

  totalActiveRegions(): number {
    return this.pages().reduce((sum, p) => {
      const kept = p.meta.regions.length - p.removedAutoIdx.size;
      return sum + kept + p.manualRegions.length;
    }, 0);
  }

  canSubmit(): boolean {
    return this.phase() === 'ready' && this.confirmed;
  }

  private callBackend() {
    this.http.post<RedactPdfApiResponse>(
      `${environment.apiUrl}/inter-tenant-chat/images/redact-pdf`,
      {
        filename: this.data.filename,
        mime_type: 'application/pdf',
        data_base64: this.data.data_base64,
      }
    ).subscribe({
      next: (res) => {
        this.truncated.set(res.truncated);
        this.maxPages.set(res.max_pages);
        const states: PageState[] = res.pages.map(p => ({
          meta: p,
          imgEl: null,
          imgLoaded: false,
          removedAutoIdx: new Set<number>(),
          manualRegions: [],
        }));
        this.pages.set(states);
        if (states.length === 0) {
          this.errorMsg.set('Nenhuma página processada.');
          this.phase.set('error');
          return;
        }
        // Pre-load todas as imagens originais (pra composição final)
        states.forEach((s, idx) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            s.imgEl = img;
            s.imgLoaded = true;
            // se for a página atual, redesenha
            if (idx === this.currentIdx()) this.redraw();
          };
          img.onerror = () => { /* ignora — outras páginas continuam */ };
          img.src = s.meta.original_url;
        });
        this.phase.set('ready');
      },
      error: (err) => {
        this.errorMsg.set(err.error?.error ?? 'Falha ao processar o PDF');
        this.phase.set('error');
      },
    });
  }

  prevPage() {
    if (this.currentIdx() > 0) {
      this.currentIdx.update(i => i - 1);
      this.lastDrawnPageIdx = -1; // força afterViewChecked redesenhar
      requestAnimationFrame(() => this.redraw());
    }
  }
  nextPage() {
    if (this.currentIdx() < this.pages().length - 1) {
      this.currentIdx.update(i => i + 1);
      this.lastDrawnPageIdx = -1;
      requestAnimationFrame(() => this.redraw());
    }
  }

  private redraw() {
    const p = this.currentPage();
    if (!p || !p.imgLoaded || !p.imgEl || !this.canvasRef) return;
    const c = this.canvasRef.nativeElement;
    const w = p.meta.width || p.imgEl.naturalWidth || 0;
    const h = p.meta.height || p.imgEl.naturalHeight || 0;
    if (w === 0 || h === 0) return;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(p.imgEl, 0, 0);

    p.meta.regions.forEach((r, i) => {
      if (p.removedAutoIdx.has(i)) {
        ctx.strokeStyle = 'rgba(150, 150, 150, 0.6)';
        ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = 'rgba(255,70,70,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
    });
    p.manualRegions.forEach(r => {
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(100,150,255,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    });
    if (this.dragStart && this.dragCurrent) {
      const x = Math.min(this.dragStart.x, this.dragCurrent.x);
      const y = Math.min(this.dragStart.y, this.dragCurrent.y);
      const w = Math.abs(this.dragCurrent.x - this.dragStart.x);
      const h = Math.abs(this.dragCurrent.y - this.dragStart.y);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(100,150,255,0.9)';
      ctx.lineWidth = 2; ctx.setLineDash([6, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }

  private canvasPointToImage(evt: MouseEvent): { x: number; y: number } {
    const c = this.canvasRef!.nativeElement;
    const rect = c.getBoundingClientRect();
    const scaleX = c.width / rect.width;
    const scaleY = c.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
    };
  }

  onMouseDown(evt: MouseEvent): void {
    if (this.phase() !== 'ready') return;
    const p = this.currentPage();
    if (!p) return;
    const pt = this.canvasPointToImage(evt);

    for (let i = p.manualRegions.length - 1; i >= 0; i--) {
      if (this.pointInside(pt, p.manualRegions[i])) {
        p.manualRegions.splice(i, 1);
        this.redraw();
        return;
      }
    }
    for (let i = p.meta.regions.length - 1; i >= 0; i--) {
      if (this.pointInside(pt, p.meta.regions[i])) {
        if (p.removedAutoIdx.has(i)) p.removedAutoIdx.delete(i);
        else p.removedAutoIdx.add(i);
        this.redraw();
        return;
      }
    }
    this.dragging = true;
    this.dragStart = pt;
    this.dragCurrent = pt;
  }

  onMouseMove(evt: MouseEvent): void {
    if (!this.dragging) return;
    this.dragCurrent = this.canvasPointToImage(evt);
    this.redraw();
  }

  onMouseUp(_evt: MouseEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.dragStart && this.dragCurrent) {
      const x = Math.min(this.dragStart.x, this.dragCurrent.x);
      const y = Math.min(this.dragStart.y, this.dragCurrent.y);
      const w = Math.abs(this.dragCurrent.x - this.dragStart.x);
      const h = Math.abs(this.dragCurrent.y - this.dragStart.y);
      if (w >= 4 && h >= 4) {
        const p = this.currentPage();
        if (p) p.manualRegions.push({ x, y, w, h, manual: true });
      }
    }
    this.dragStart = null;
    this.dragCurrent = null;
    this.redraw();
  }

  private pointInside(pt: { x: number; y: number }, r: Region): boolean {
    return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
  }

  cancel(): void {
    if (this.phase() === 'composing') return;
    this.ref.close(null);
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.phase.set('composing');

    try {
      // Pra cada página: compõe imagem final no canvas → bytes PNG
      const finalPages: { png: Uint8Array; width: number; height: number }[] = [];
      for (const p of this.pages()) {
        if (!p.imgEl) throw new Error('Imagem da página não carregou');
        const off = document.createElement('canvas');
        off.width = p.imgEl.naturalWidth;
        off.height = p.imgEl.naturalHeight;
        const ctx = off.getContext('2d');
        if (!ctx) throw new Error('Canvas indisponível');
        ctx.drawImage(p.imgEl, 0, 0);
        ctx.fillStyle = 'black';
        p.meta.regions.forEach((r, i) => {
          if (!p.removedAutoIdx.has(i)) ctx.fillRect(r.x, r.y, r.w, r.h);
        });
        p.manualRegions.forEach(r => ctx.fillRect(r.x, r.y, r.w, r.h));

        const blob = await new Promise<Blob | null>(res => off.toBlob(res, 'image/png'));
        if (!blob) throw new Error('Falha ao gerar PNG da página');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        finalPages.push({ png: bytes, width: off.width, height: off.height });
      }

      // Compõe PDF final via pdf-lib
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      for (const fp of finalPages) {
        const png = await pdfDoc.embedPng(fp.png);
        const page = pdfDoc.addPage([fp.width, fp.height]);
        page.drawImage(png, { x: 0, y: 0, width: fp.width, height: fp.height });
      }
      const pdfBytes = await pdfDoc.save();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(pdfBytes)));

      // Stats agregadas
      let totalAuto = 0, totalManualAdded = 0, totalRemoved = 0;
      this.pages().forEach(p => {
        totalAuto += p.meta.regions.length;
        totalManualAdded += p.manualRegions.length;
        totalRemoved += p.removedAutoIdx.size;
      });

      this.ref.close({
        filename: this.data.filename.replace(/\.pdf$/i, '') + '-redigido.pdf',
        mime_type: 'application/pdf',
        data_base64: base64,
        page_count: this.pages().length,
        total_auto_regions: totalAuto,
        total_manual_added: totalManualAdded,
        total_manual_removed: totalRemoved,
      });
    } catch (err: any) {
      this.errorMsg.set(err?.message || 'Falha ao compor o PDF');
      this.phase.set('error');
    }
  }
}
