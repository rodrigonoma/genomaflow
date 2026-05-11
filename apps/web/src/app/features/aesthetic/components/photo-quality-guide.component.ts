import { Component, ElementRef, EventEmitter, Output, ViewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

interface Guideline {
  icon: string;
  text: string;
}

const GUIDELINES: Guideline[] = [
  { icon: '✅', text: 'Foto frontal centralizada, rosto ocupando 60–80% do quadro' },
  { icon: '✅', text: 'Iluminação uniforme e difusa, sem sombras fortes no rosto' },
  { icon: '✅', text: 'Resolução mínima de 1024×1024 pixels' },
  { icon: '✅', text: 'Sem maquiagem e sem óculos (maquiagem interfere na análise de pele)' },
  { icon: '✅', text: 'Fundo neutro (branco ou cinza claro)' },
  { icon: '✅', text: 'Máximo de 3 fotos por análise de simetria' },
  { icon: '⚠️', text: 'Foto ruim ou fora dos padrões pode gerar análise imprecisa' },
];

@Component({
  selector: 'app-photo-quality-guide',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  styles: [`
    :host { display: block; }
    .guide-header {
      padding: 1.5rem 1.5rem 0;
    }
    h2 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 1.125rem; font-weight: 700; color: #dae2fd; margin: 0 0 1rem;
    }
    .guide-body { padding: 0 1.5rem 1rem; }
    .guideline-list {
      list-style: none; margin: 0 0 1.25rem; padding: 0;
    }
    .guideline-list li {
      display: flex; align-items: flex-start; gap: 0.5rem;
      font-family: 'Inter', sans-serif; font-size: 13px; color: #9b9aad;
      line-height: 1.5; padding: 0.35rem 0;
      border-bottom: 1px solid rgba(70,69,84,0.1);
    }
    .guideline-list li:last-child { border-bottom: none; }
    .icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
    .footer {
      display: flex; justify-content: flex-end;
      padding: 1rem 1.5rem;
      border-top: 1px solid rgba(70,69,84,0.15);
    }
    input[type=file] { display: none; }
  `],
  template: `
    <div class="guide-header">
      <h2>Orientações para a Foto</h2>
    </div>

    <div class="guide-body">
      <ul class="guideline-list">
        @for (g of guidelines; track g.text) {
          <li>
            <span class="icon">{{ g.icon }}</span>
            <span>{{ g.text }}</span>
          </li>
        }
      </ul>
    </div>

    <div class="footer">
      <button mat-flat-button color="primary" (click)="fileInput.click()">
        Selecionar fotos
      </button>
    </div>

    <input
      #fileInput
      type="file"
      accept="image/jpeg,image/png"
      multiple
      (change)="onFilesChange(fileInput.files)"
    />
  `,
})
export class PhotoQualityGuideComponent {
  @Output() readonly photosSelected = new EventEmitter<File[]>();
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  readonly guidelines: Guideline[] = GUIDELINES;

  onFilesChange(fileList: FileList | null): void {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, 3);
    this.photosSelected.emit(files);
  }
}
