import { Component, ElementRef, ViewChild, inject, signal, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';

export interface Region {
  x: number; y: number; w: number; h: number;
  kind?: string;    // 'cpf' | 'name' | ... (auto-detected)
  manual?: boolean; // true se o usuário adicionou
}

export interface RedactDialogData {
  filename: string;
  mime_type: string;
  data_base64: string;
}

export interface RedactDialogResult {
  filename: string;
  mime_type: string;
  data_base64: string;   // imagem final com redação aplicada (base64)
  auto_regions: number;
  manual_added: number;
  manual_removed: number;
  engine: string;
}

interface RedactApiResponse {
  redact_id: string;
  original_url: string;
  redacted_url: string;
  regions: Region[];
  width: number;
  height: number;
  engine: string;
  ocr_word_count: number;
}

type Phase = 'loading' | 'ready' | 'error';

@Component({
  selector: 'app-redact-image-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatCheckboxModule, FormsModule],
  styles: [`
    :host { display:block; color:#dae2fd; }
    .header { display:flex; align-items:center; justify-content:space-between; padding:1.25rem 1.5rem 0.5rem; }
    .header h2 { font-family:'Space Grotesk',sans-serif; font-size:1.0625rem; font-weight:700; margin:0; color:#c0c1ff; }
    .subtitle { padding:0 1.5rem 0.75rem; font-family:'JetBrains Mono',monospace; font-size:10px; color:#908fa0; letter-spacing:0.08em; text-transform:uppercase; }
    .body { padding:0 1.5rem 1rem; display:flex; flex-direction:column; gap:0.875rem; }
    .canvas-wrap {
      position:relative; background:#000; border:1px solid rgba(70,69,84,0.3); border-radius:6px;
      overflow:auto; max-height:60vh; user-select:none;
    }
    canvas { display:block; cursor:crosshair; max-width:100%; }
    .instructions {
      font-size:0.75rem; color:#a09fb2; font-family:'JetBrains Mono',monospace;
      line-height:1.5;
      background:rgba(192,193,255,0.06); padding:0.5rem 0.75rem; border-radius:5px;
    }
    .instructions strong { color:#c0c1ff; }
    .stats { display:flex; gap:1rem; font-size:0.75rem; font-family:'JetBrains Mono',monospace; color:#908fa0; flex-wrap:wrap; }
    .stat { display:flex; gap:0.375rem; align-items:center; }
    .stat-value { color:#dae2fd; font-weight:600; }
    .warning {
      background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.25);
      color:#fbbf24; font-family:'JetBrains Mono',monospace; font-size:11px;
      padding:0.625rem 0.75rem; border-radius:5px; line-height:1.45;
    }
    .confirm-row { display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0; }
    .loading {
      text-align:center; padding:3rem 1rem; color:#908fa0; font-family:'JetBrains Mono',monospace; font-size:0.8125rem;
    }
    .footer {
      display:flex; justify-content:space-between; align-items:center;
      padding:0.875rem 1.5rem; border-top:1px solid rgba(70,69,84,0.2);
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
      <h2>Redação de dados pessoais na imagem</h2>
      <button mat-icon-button (click)="cancel()"><mat-icon>close</mat-icon></button>
    </div>
    <div class="subtitle">Revisão antes do envio — obrigatório</div>
    <div class="body">
      @if (phase() === 'loading') {
        <div class="loading">
          Analisando imagem — isso leva alguns segundos...
        </div>
      } @else if (phase() === 'error') {
        <div class="warning">{{ errorMsg() }}</div>
      } @else {
        <div class="instructions">
          <strong>Clique e arraste</strong> sobre a imagem pra adicionar um bloco preto.
          <strong>Clique em cima</strong> de um bloco pra removê-lo.
          Os blocos <strong>automáticos</strong> aparecem em vermelho; os <strong>manuais</strong> em azul.
          Pretos indicam onde a imagem final será coberta.
        </div>

        @if (stats().autoDetected === 0) {
          <div class="warning">
            Não detectamos texto automaticamente. Adicione blocos manuais sobre qualquer PII visível
            antes de enviar.
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
          <span class="stat">Auto-detectados: <span class="stat-value">{{ stats().autoDetected }}</span></span>
          <span class="stat">Removidos: <span class="stat-value">{{ stats().autoRemoved }}</span></span>
          <span class="stat">Adicionados: <span class="stat-value">{{ stats().manualAdded }}</span></span>
          <span class="stat">Total aplicados: <span class="stat-value">{{ activeRegionCount() }}</span></span>
        </div>

        <div class="confirm-row">
          <mat-checkbox [(ngModel)]="confirmed" color="primary">
            Confirmo que revisei e a imagem final não contém dados pessoais identificáveis
          </mat-checkbox>
        </div>
      }
    </div>
    <div class="footer">
      <div class="footer-left">{{ engineLabel() }}</div>
      <div class="footer-buttons">
        <button mat-button (click)="cancel()">Cancelar</button>
        <button class="submit-btn" [disabled]="!canSubmit()" (click)="submit()">Enviar imagem</button>
      </div>
    </div>
  `,
})
export class RedactImageDialogComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  private http = inject(HttpClient);
  private ref  = inject(MatDialogRef<RedactImageDialogComponent, RedactDialogResult | null>);
  data: RedactDialogData = inject(MAT_DIALOG_DATA);

  phase    = signal<Phase>('loading');
  errorMsg = signal('');
  engine   = signal('');
  confirmed = false;

  // Regiões no sistema de coordenadas da imagem original (não do canvas)
  private autoRegions: Region[] = [];       // do backend
  private removedAutoIdx = new Set<number>(); // índices das auto removidas pelo usuário
  private manualRegions: Region[] = [];     // adicionadas manualmente

  private imgEl: HTMLImageElement | null = null;
  private imgWidth = 0;
  private imgHeight = 0;

  // Drag state
  private dragging = false;
  private dragStart: { x: number; y: number } | null = null;
  private dragCurrent: { x: number; y: number } | null = null;

  stats = signal<{ autoDetected: number; autoRemoved: number; manualAdded: number }>({
    autoDetected: 0, autoRemoved: 0, manualAdded: 0,
  });

  ngAfterViewInit(): void {
    this.callBackend();
  }

  ngOnDestroy(): void {}

  engineLabel(): string {
    const e = this.engine();
    if (!e) return '';
    return `Engine: ${e}`;
  }

  activeRegionCount(): number {
    const kept = this.autoRegions.filter((_, i) => !this.removedAutoIdx.has(i)).length;
    return kept + this.manualRegions.length;
  }

  canSubmit(): boolean {
    return this.phase() === 'ready' && this.confirmed;
  }

  private callBackend() {
    this.http.post<RedactApiResponse>(
      `${environment.apiUrl}/inter-tenant-chat/images/redact`,
      {
        filename: this.data.filename,
        mime_type: this.data.mime_type,
        data_base64: this.data.data_base64,
      }
    ).subscribe({
      next: (res) => {
        this.autoRegions = res.regions || [];
        this.imgWidth = res.width;
        this.imgHeight = res.height;
        this.engine.set(res.engine);
        this.stats.set({
          autoDetected: this.autoRegions.length,
          autoRemoved: 0,
          manualAdded: 0,
        });
        this.loadImage(res.original_url);
      },
      error: (err) => {
        this.errorMsg.set(err.error?.error ?? 'Falha ao processar a imagem');
        this.phase.set('error');
      },
    });
  }

  private loadImage(url: string) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.imgEl = img;
      this.imgWidth = img.naturalWidth || this.imgWidth;
      this.imgHeight = img.naturalHeight || this.imgHeight;
      this.phase.set('ready');
      // Espera Angular renderizar o canvas
      setTimeout(() => this.redraw(), 0);
    };
    img.onerror = () => {
      this.errorMsg.set('Não foi possível carregar a imagem.');
      this.phase.set('error');
    };
    img.src = url;
  }

  private redraw() {
    if (!this.canvasRef || !this.imgEl) return;
    const c = this.canvasRef.nativeElement;
    c.width = this.imgWidth;
    c.height = this.imgHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(this.imgEl, 0, 0);

    // Auto regions ativas (vermelho traduzido + fill preto, leve transparência)
    ctx.save();
    this.autoRegions.forEach((r, i) => {
      if (this.removedAutoIdx.has(i)) return;
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(255, 70, 70, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    });

    // Manual regions
    this.manualRegions.forEach((r) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(100, 150, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    });

    // Removed auto regions (só contorno cinza tracejado, sem preenchimento — feedback "não será aplicado")
    this.autoRegions.forEach((r, i) => {
      if (!this.removedAutoIdx.has(i)) return;
      ctx.strokeStyle = 'rgba(150, 150, 150, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
    });

    // Drag preview
    if (this.dragStart && this.dragCurrent) {
      const x = Math.min(this.dragStart.x, this.dragCurrent.x);
      const y = Math.min(this.dragStart.y, this.dragCurrent.y);
      const w = Math.abs(this.dragCurrent.x - this.dragStart.x);
      const h = Math.abs(this.dragCurrent.y - this.dragStart.y);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(100, 150, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
    ctx.restore();
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
    const pt = this.canvasPointToImage(evt);

    // Check click inside existing region → toggle
    // 1. Remove a manual region?
    for (let i = this.manualRegions.length - 1; i >= 0; i--) {
      const r = this.manualRegions[i];
      if (this.pointInside(pt, r)) {
        this.manualRegions.splice(i, 1);
        this.updateStats();
        this.redraw();
        return;
      }
    }
    // 2. Toggle auto region (se ativa, marca como removida; se já removida, restaura)
    for (let i = this.autoRegions.length - 1; i >= 0; i--) {
      const r = this.autoRegions[i];
      if (this.pointInside(pt, r)) {
        if (this.removedAutoIdx.has(i)) {
          this.removedAutoIdx.delete(i);
        } else {
          this.removedAutoIdx.add(i);
        }
        this.updateStats();
        this.redraw();
        return;
      }
    }
    // 3. Inicia drag pra criar nova região
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
        this.manualRegions.push({ x, y, w, h, manual: true });
        this.updateStats();
      }
    }
    this.dragStart = null;
    this.dragCurrent = null;
    this.redraw();
  }

  private pointInside(pt: { x: number; y: number }, r: Region): boolean {
    return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
  }

  private updateStats() {
    this.stats.set({
      autoDetected: this.autoRegions.length,
      autoRemoved: this.removedAutoIdx.size,
      manualAdded: this.manualRegions.length,
    });
  }

  cancel(): void {
    this.ref.close(null);
  }

  submit(): void {
    if (!this.canSubmit() || !this.imgEl) return;

    // Compõe imagem final com APENAS os retângulos ativos (sem o outline colorido)
    const off = document.createElement('canvas');
    off.width = this.imgWidth;
    off.height = this.imgHeight;
    const ctx = off.getContext('2d');
    if (!ctx) { this.ref.close(null); return; }
    ctx.drawImage(this.imgEl, 0, 0);

    // Retângulos ativos = auto não removidos + manuais
    ctx.fillStyle = 'black';
    this.autoRegions.forEach((r, i) => {
      if (this.removedAutoIdx.has(i)) return;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    });
    this.manualRegions.forEach((r) => ctx.fillRect(r.x, r.y, r.w, r.h));

    const dataUrl = off.toDataURL(this.data.mime_type, 0.92);
    const base64 = dataUrl.split(',')[1] || dataUrl;

    this.ref.close({
      filename: this.data.filename,
      mime_type: this.data.mime_type,
      data_base64: base64,
      auto_regions: this.autoRegions.length,
      manual_added: this.manualRegions.length,
      manual_removed: this.removedAutoIdx.size,
      engine: this.engine(),
    });
  }
}
