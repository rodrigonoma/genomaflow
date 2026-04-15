import { Component, Input } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';

const RISK_VALUES: Record<string, number> = {
  baixo: 20, low: 20,
  moderado: 50, medium: 50,
  alto: 80, high: 80,
  crítico: 100, critical: 100
};

@Component({
  selector: 'app-risk-meter',
  standalone: true,
  imports: [MatProgressBarModule],
  template: `
    <div class="mb-2">
      <span class="text-sm font-medium">{{ label }}: </span>
      <span class="text-sm text-gray-600">{{ value }}</span>
    </div>
    <mat-progress-bar [value]="numericValue" [color]="barColor" />
  `
})
export class RiskMeterComponent {
  @Input() label = '';
  @Input() value = '';

  get numericValue(): number {
    return RISK_VALUES[this.value?.toLowerCase()] ?? 0;
  }

  get barColor(): 'primary' | 'accent' | 'warn' {
    const v = this.numericValue;
    if (v >= 80) return 'warn';
    if (v >= 50) return 'accent';
    return 'primary';
  }
}
