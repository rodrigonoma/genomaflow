import { Component, ElementRef, EventEmitter, Output, ViewChild, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { AnalysisType } from '../models/analysis.model';

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

const GUIDE_BY_REGION: Record<AnalysisType, { protocol: string; tips: string[] }> = {
  facial:    { protocol: '1 foto frontal + opcional 2 laterais (perfil 45° e 90°)',
               tips: ['Rosto centralizado', 'Olhar diretamente pra câmera', 'Iluminação uniforme', 'Sem maquiagem pesada/óculos/franja'] },
  eyelids:   { protocol: 'Close-up frontal + close-up perfil',
               tips: ['Olhos abertos naturalmente', 'Sem máscara/sombra escura', 'Foco nas pálpebras'] },
  neck:      { protocol: 'Frontal de pescoço + perfil',
               tips: ['Cabeça em posição neutra', 'Sem gola alta', 'Iluminação lateral pra mostrar contornos'] },
  breast:    { protocol: 'Frontal de tronco descoberto + perfil',
               tips: ['Paciente em pé, braços ao lado', 'Sem soutien', '⚠️ Região sensível — consentimento reforçado obrigatório'] },
  arms:      { protocol: '2 fotos: braços relaxados + braços flexionados (ambos frontal)',
               tips: ['Braços abertos lateralmente', 'Sem pulseiras/relógios', 'Mostrar tríceps'] },
  abdomen:   { protocol: 'Frontal + 2 perfis (esquerdo/direito)',
               tips: ['Em pé, postura natural', 'Sem roupa cobrindo abdômen', '⚠️ Região sensível'] },
  legs:      { protocol: 'Frontal de pernas + costas + 2 perfis',
               tips: ['Em pé, pernas levemente separadas', 'Roupa íntima neutra ou shorts curto', 'Pernas relaxadas'] },
  glutes:    { protocol: 'Foto de costas em pé',
               tips: ['Postura natural', 'Roupa íntima ou shorts justo', '⚠️ Região sensível'] },
  full_body: { protocol: 'Silhueta completa: frontal + costas + 2 perfis (4 fotos)',
               tips: ['Em pé, postura ereta', 'Braços ao lado', 'Roupa justa pra mostrar silhueta', 'Fundo neutro'] },
  other:     { protocol: 'Foto da região de interesse',
               tips: ['Foco na área específica', 'Iluminação clara'] },
};

const REGION_LABELS: Record<AnalysisType, string> = {
  facial: 'Facial', eyelids: 'Pálpebras', neck: 'Pescoço', breast: 'Mama/Tórax',
  arms: 'Braços', abdomen: 'Abdômen', legs: 'Coxas', glutes: 'Glúteos',
  full_body: 'Silhueta completa', other: 'Região',
};

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
    .protocol {
      font-family: 'Inter', sans-serif; font-size: 13px; color: #9b9aad;
      margin: 0 0 0.75rem;
    }
    h4 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 0.95rem; font-weight: 600; color: #dae2fd; margin: 0 0 0.5rem;
    }
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
      <h4>Protocolo de fotos para {{ regionLabel(region()) }}</h4>
      <p class="protocol">{{ guideFor(region()).protocol }}</p>
      <ul class="guideline-list">
        @for (tip of guideFor(region()).tips; track $index) {
          <li>
            <span>{{ tip }}</span>
          </li>
        }
      </ul>
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
  readonly region = input<AnalysisType>('facial');

  @Output() readonly photosSelected = new EventEmitter<File[]>();
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  readonly guidelines: Guideline[] = GUIDELINES;

  guideFor(r: AnalysisType) {
    return GUIDE_BY_REGION[r] ?? GUIDE_BY_REGION['facial'];
  }

  regionLabel(r: AnalysisType) {
    return REGION_LABELS[r] ?? 'Região';
  }

  onFilesChange(fileList: FileList | null): void {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, 3);
    this.photosSelected.emit(files);
  }
}
