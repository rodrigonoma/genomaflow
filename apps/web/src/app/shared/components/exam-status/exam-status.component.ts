import { Component, Input } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';

type Status = 'pending' | 'processing' | 'done' | 'error';

@Component({
  selector: 'app-exam-status',
  standalone: true,
  imports: [MatProgressSpinnerModule, MatIconModule],
  template: `
    @switch (status) {
      @case ('pending') { <mat-spinner diameter="16" /> }
      @case ('processing') { <mat-spinner diameter="16" mode="indeterminate" /> }
      @case ('done') { <mat-icon class="text-green-600">check_circle</mat-icon> }
      @case ('error') { <mat-icon class="text-red-600">error</mat-icon> }
    }
  `
})
export class ExamStatusComponent {
  @Input() status: Status = 'pending';
}
