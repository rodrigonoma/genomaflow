import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-disclaimer',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div class="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded mt-4">
      <mat-icon class="text-amber-600 text-base leading-tight">info</mat-icon>
      <p class="text-xs text-amber-800 m-0">
        Esta análise é um suporte à decisão clínica e não substitui avaliação médica profissional.
      </p>
    </div>
  `
})
export class DisclaimerComponent {}
