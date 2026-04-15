import { Component, Input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';

type Severity = 'low' | 'medium' | 'high' | 'critical';

@Component({
  selector: 'app-alert-badge',
  standalone: true,
  imports: [MatChipsModule],
  template: `
    <mat-chip [class]="colorClass">{{ severity }}</mat-chip>
  `,
  styles: [`
    .low { background: #e0e0e0 !important; }
    .medium { background: #fff3e0 !important; color: #e65100 !important; }
    .high { background: #ffe0b2 !important; color: #bf360c !important; }
    .critical { background: #ffebee !important; color: #b71c1c !important; font-weight: bold; }
  `]
})
export class AlertBadgeComponent {
  @Input() severity: Severity = 'low';
  get colorClass(): string { return this.severity; }
}
