import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatProgressSpinnerModule
  ],
  template: `
    <div class="flex items-center justify-center min-h-screen">
      <mat-card class="w-full max-w-sm p-6">
        <mat-card-header>
          <mat-card-title class="text-2xl mb-4">GenomaFlow</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <form (ngSubmit)="submit()" class="flex flex-col gap-4">
            <mat-form-field>
              <mat-label>E-mail</mat-label>
              <input matInput type="email" [(ngModel)]="email" name="email" required />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Senha</mat-label>
              <input matInput type="password" [(ngModel)]="password" name="password" required />
            </mat-form-field>
            @if (error) {
              <p class="text-red-600 text-sm">{{ error }}</p>
            }
            <button mat-flat-button color="primary" type="submit" [disabled]="loading">
              @if (loading) { <mat-spinner diameter="20" /> } @else { Entrar }
            </button>
          </form>
        </mat-card-content>
      </mat-card>
    </div>
  `
})
export class LoginComponent {
  private auth = inject(AuthService);

  email = '';
  password = '';
  error = '';
  loading = false;

  submit(): void {
    this.error = '';
    this.loading = true;
    this.auth.login(this.email, this.password).subscribe({
      next: () => { this.loading = false; },
      error: () => {
        this.loading = false;
        this.error = 'E-mail ou senha inválidos.';
      }
    });
  }
}
