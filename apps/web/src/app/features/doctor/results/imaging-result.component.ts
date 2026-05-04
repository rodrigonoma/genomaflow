import {
  Component, Input, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit, OnDestroy, inject
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { environment } from '../../../../environments/environment';
import { ClinicalResult, ImagingFinding, ImagingMetadata } from '../../../shared/models/api.models';

@Component({
  selector: 'app-imaging-result',
  standalone: true,
  imports: [MatIconModule, MatButtonModule],
  styles: [`
    :host { display: block; }
    .viewer-container { position: relative; display: block; width: 100%; max-width: 100%; }
    .exam-image { width: 100%; max-width: 100%; height: auto; display: block; border-radius: 6px; border: 1px solid rgba(70,69,84,0.25); }
    .overlay-canvas { position: absolute; top: 0; left: 0; pointer-events: none; }
    .image-controls { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; }
    .disclaimer-box {
      margin-top: 0.75rem; padding: 0.5rem 0.75rem;
      background: rgba(255,183,0,0.08); border: 1px solid rgba(255,183,0,0.2); border-radius: 4px;
      font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #ffdd88;
    }
    .findings-list { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .finding-item {
      display: flex; align-items: flex-start; gap: 0.75rem;
      padding: 0.625rem 0.75rem;
      background: #0b1326; border-radius: 4px; border: 1px solid rgba(70,69,84,0.2);
      cursor: pointer; transition: border-color 150ms ease;
    }
    .finding-item:hover { border-color: rgba(192,193,255,0.3); }
    .finding-badge {
      flex-shrink: 0; width: 28px; height: 28px; border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; color: #000;
    }
    .finding-body { flex: 1; min-width: 0; }
    .finding-label { font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600; color: #dae2fd; }
    .finding-desc { font-family: 'Inter', sans-serif; font-size: 12px; color: #a09fb2; margin-top: 2px; }
    .severity-critical { border-color: rgba(255,68,68,0.3); }
    .severity-high     { border-color: rgba(255,136,0,0.3); }
    .severity-medium   { border-color: rgba(255,221,0,0.25); }
    .severity-low      { border-color: rgba(68,187,68,0.25); }
    .measurements-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .measurement-cell {
      background: #0b1326; border: 1px solid rgba(70,69,84,0.2); border-radius: 4px;
      padding: 0.5rem 0.625rem; text-align: center;
    }
    .meas-label { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #6e6d80; display: block; margin-bottom: 2px; }
    .meas-value { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; color: #c0c1ff; }
    .no-image-msg { padding: 1rem; background: rgba(70,69,84,0.08); border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #6e6d80; }
    .loading-img { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #6e6d80; padding: 1rem 0; }
    .finding-hidden { opacity: 0.4; }
    .toggle-finding-btn {
      flex-shrink: 0; background: none; border: none; cursor: pointer;
      color: #6e6d80; padding: 2px; display: flex; align-items: center;
      transition: color 150ms ease;
    }
    .toggle-finding-btn:hover { color: #c0c1ff; }
  `],
  template: `
    @if (measurements && hasMeasurements()) {
      <div class="measurements-grid">
        @if (measurements.rate) {
          <div class="measurement-cell">
            <span class="meas-label">FC</span>
            <span class="meas-value">{{ measurements.rate }}</span>
          </div>
        }
        @if (measurements.pr_interval) {
          <div class="measurement-cell">
            <span class="meas-label">PR</span>
            <span class="meas-value">{{ measurements.pr_interval }}</span>
          </div>
        }
        @if (measurements.qrs_duration) {
          <div class="measurement-cell">
            <span class="meas-label">QRS</span>
            <span class="meas-value">{{ measurements.qrs_duration }}</span>
          </div>
        }
        @if (measurements.qt_interval) {
          <div class="measurement-cell">
            <span class="meas-label">QT</span>
            <span class="meas-value">{{ measurements.qt_interval }}</span>
          </div>
        }
        @if (measurements.axis) {
          <div class="measurement-cell">
            <span class="meas-label">Eixo</span>
            <span class="meas-value">{{ measurements.axis }}</span>
          </div>
        }
      </div>
    }

    @if (imageUrl) {
      <div class="image-controls">
        <button mat-stroked-button style="font-size:11px;" (click)="toggleAnnotations()">
          <mat-icon style="font-size:15px">{{ showAnnotations ? 'visibility_off' : 'visibility' }}</mat-icon>
          {{ showAnnotations ? 'Ocultar marcações' : 'Mostrar marcações' }}
        </button>
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#6e6d80;">
          {{ findings.length }} achado{{ findings.length !== 1 ? 's' : '' }} identificado{{ findings.length !== 1 ? 's' : '' }}
        </span>
      </div>
      <div class="viewer-container">
        <img #imageEl class="exam-image" [src]="imageUrl" alt="Imagem do exame"
             (load)="onImageLoad()" (error)="onImageError()" />
        <canvas #overlayCanvas class="overlay-canvas"></canvas>
      </div>
      <div class="disclaimer-box">
        ⚠ Marcações aproximadas identificadas pela IA — validação profissional obrigatória.
        Achados sutis podem não estar marcados ou estar levemente deslocados.
      </div>
    } @else if (loadingImage) {
      <p class="loading-img">Carregando imagem...</p>
    } @else if (noImage) {
      <div class="no-image-msg">
        Análise de PDF por imagem — visualização da imagem não disponível nesta versão.
        Os achados abaixo foram identificados via análise do documento.
      </div>
    }

    @if (findings.length > 0) {
      <div class="findings-list">
        @for (f of findings; track f.id) {
          <div class="finding-item" [class]="'severity-' + f.severity"
               [class.finding-hidden]="hiddenIds.has(f.id)"
               (click)="highlightFinding(f)">
            <div class="finding-badge" [style.background]="hiddenIds.has(f.id) ? '#3a3a4a' : severityColor(f.severity)">
              [{{ f.id }}]
            </div>
            <div class="finding-body">
              <div class="finding-label">{{ f.label }}</div>
              @if (f.description) {
                <div class="finding-desc">{{ f.description }}</div>
              }
            </div>
            <button class="toggle-finding-btn" (click)="toggleFinding($event, f)"
                    [title]="hiddenIds.has(f.id) ? 'Mostrar marcação' : 'Ocultar marcação'">
              <mat-icon style="font-size:16px;width:16px;height:16px;">
                {{ hiddenIds.has(f.id) ? 'visibility_off' : 'visibility' }}
              </mat-icon>
            </button>
          </div>
        }
      </div>
    }
  `
})
export class ImagingResultComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input({ required: true }) result!: ClinicalResult;
  @Input({ required: true }) examId!: string;

  @ViewChild('imageEl')      imageRef!: ElementRef<HTMLImageElement>;
  @ViewChild('overlayCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  private http = inject(HttpClient);

  imageUrl: string | null = null;
  loadingImage = false;
  noImage = false;
  showAnnotations = true;
  findings: ImagingFinding[] = [];
  measurements: ImagingMetadata['measurements'] = null;

  hiddenIds = new Set<number>();
  private highlightedId: number | null = null;
  private imageLoaded = false;
  private resizeObserver?: ResizeObserver;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['result']) {
      this.findings     = this.result.metadata?.findings     ?? [];
      this.measurements = this.result.metadata?.measurements ?? null;
      this.hiddenIds.clear();

      if (this.result.metadata?.original_image_url) {
        this.loadImage();
      } else {
        this.noImage = true;
      }
    }
  }

  ngAfterViewInit(): void {
    if (this.imageLoaded) this.drawFindings();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private loadImage(): void {
    this.loadingImage = true;
    this.http.get(`${environment.apiUrl}/exams/${this.examId}/image`, { responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          this.imageUrl     = URL.createObjectURL(blob);
          this.loadingImage = false;
        },
        error: () => {
          this.loadingImage = false;
          this.noImage = true;
        }
      });
  }

  onImageLoad(): void {
    this.imageLoaded = true;
    this.syncCanvasSize();
    this.drawFindings();
    this.setupResizeObserver();
  }

  onImageError(): void {
    this.noImage  = true;
    this.imageUrl = null;
  }

  private syncCanvasSize(): void {
    const img    = this.imageRef?.nativeElement;
    const canvas = this.canvasRef?.nativeElement;
    if (!img || !canvas) return;
    canvas.width  = img.clientWidth;
    canvas.height = img.clientHeight;
    canvas.style.width  = img.clientWidth  + 'px';
    canvas.style.height = img.clientHeight + 'px';
  }

  // Mantém canvas sincronizado com a imagem em mudanças de viewport (rotação,
  // resize, layout shift). Sem isso, em mobile os bounding boxes ficam
  // desacoplados: imagem escala fluida, canvas permanece no tamanho do load
  // inicial — boxes invisíveis ou desalinhados.
  private setupResizeObserver(): void {
    if (this.resizeObserver) return;
    if (typeof ResizeObserver === 'undefined') return;
    const img = this.imageRef?.nativeElement;
    if (!img) return;
    this.resizeObserver = new ResizeObserver(() => {
      this.syncCanvasSize();
      this.drawFindings();
    });
    this.resizeObserver.observe(img);
  }

  toggleAnnotations(): void {
    this.showAnnotations = !this.showAnnotations;
    this.drawFindings();
  }

  highlightFinding(finding: ImagingFinding): void {
    if (this.hiddenIds.has(finding.id)) return;
    this.highlightedId = finding.id === this.highlightedId ? null : finding.id;
    this.drawFindings();
  }

  toggleFinding(event: Event, finding: ImagingFinding): void {
    event.stopPropagation();
    if (this.hiddenIds.has(finding.id)) {
      this.hiddenIds.delete(finding.id);
    } else {
      this.hiddenIds.add(finding.id);
      if (this.highlightedId === finding.id) this.highlightedId = null;
    }
    this.drawFindings();
  }

  drawFindings(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!this.showAnnotations) return;

    this.findings.forEach(f => {
      if (!f.box || this.hiddenIds.has(f.id)) return;
      const [x1p, y1p, x2p, y2p] = f.box;
      const x = x1p * canvas.width;
      const y = y1p * canvas.height;
      const w = (x2p - x1p) * canvas.width;
      const h = (y2p - y1p) * canvas.height;

      const color     = this.severityColor(f.severity);
      const isHighlit = this.highlightedId === f.id;

      ctx.fillStyle = color + (isHighlit ? '44' : '18');
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = color;
      ctx.lineWidth   = isHighlit ? 3 : 2;
      ctx.setLineDash(isHighlit ? [] : [6, 3]);
      ctx.strokeRect(x, y, w, h);

      ctx.setLineDash([]);
      const badgeW = 28, badgeH = 20;
      ctx.fillStyle = color;
      ctx.fillRect(x, y - badgeH, badgeW, badgeH);
      ctx.fillStyle = '#000000';
      ctx.font = `bold ${isHighlit ? 13 : 11}px monospace`;
      ctx.fillText(`[${f.id}]`, x + 3, y - 5);
    });
  }

  severityColor(severity: string): string {
    const map: Record<string, string> = {
      critical: '#FF4444',
      high:     '#FF8800',
      medium:   '#FFDD00',
      low:      '#44BB44',
    };
    return map[severity] ?? '#C0C1FF';
  }

  hasMeasurements(): boolean {
    const m = this.measurements;
    if (!m) return false;
    return !!(m.rate || m.pr_interval || m.qrs_duration || m.qt_interval || m.axis);
  }
}
