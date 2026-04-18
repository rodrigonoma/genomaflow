import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { environment } from '../../../../environments/environment';
import { HUMAN_SPECIALTIES } from '../../shared/models/api.models';

@Component({
  selector: 'app-specialty-onboarding',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatSelectModule],
  styles: [`
    :host {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: #0b1326;
    }
    .card {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.25);
      border-radius: 12px; padding: 2.5rem; width: 420px;
    }
    h1 {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.5rem; color: #dae2fd; margin: 0 0 0.5rem;
    }
    p { font-size: 13px; color: #908fa0; margin: 0 0 2rem; line-height: 1.5; }
    mat-form-field { width: 100%; margin-bottom: 1.5rem; }
    .actions { display: flex; justify-content: flex-end; }
    .error { color: #ffb4ab; font-size: 13px; margin-bottom: 1rem; }
  `],
  template: `
    <div class="card">
      <h1>Qual é sua especialidade?</h1>
      <p>Esta informação é usada para pré-selecionar os agentes de IA mais relevantes para suas análises.</p>

      <mat-form-field appearance="outline">
        <mat-label>Especialidade médica</mat-label>
        <mat-select [(ngModel)]="selectedSpecialty">
          @for (s of specialties; track s.value) {
            <mat-option [value]="s.value">{{ s.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      @if (error()) {
        <div class="error">{{ error() }}</div>
      }

      <div class="actions">
        <button mat-flat-button
                style="background:#c0c1ff;color:#1000a9;font-weight:700"
                [disabled]="!selectedSpecialty || saving()"
                (click)="save()">
          {{ saving() ? 'Salvando…' : 'Continuar' }}
        </button>
      </div>
    </div>
  `
})
export class SpecialtyOnboardingComponent {
  private http   = inject(HttpClient);
  private router = inject(Router);

  specialties = HUMAN_SPECIALTIES;
  selectedSpecialty = '';
  saving = signal(false);
  error  = signal('');

  save(): void {
    if (!this.selectedSpecialty) return;
    this.saving.set(true);
    this.error.set('');
    this.http.put(`${environment.apiUrl}/auth/me/specialty`, { specialty: this.selectedSpecialty })
      .subscribe({
        next: () => this.router.navigate(['/doctor/patients']),
        error: () => {
          this.saving.set(false);
          this.error.set('Erro ao salvar. Tente novamente.');
        }
      });
  }
}
