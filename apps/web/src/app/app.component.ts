import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AsyncPipe } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from './core/auth/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive, AsyncPipe,
    MatToolbarModule, MatButtonModule, MatIconModule, MatMenuModule
  ],
  template: `
    @if (auth.currentUser$ | async; as user) {
      <mat-toolbar color="primary" class="flex justify-between items-center">
        <span class="font-semibold text-lg">GenomaFlow</span>

        <nav class="flex gap-2">
          @if (user.role === 'doctor') {
            <a mat-button routerLink="/doctor/patients" routerLinkActive="opacity-70">Pacientes</a>
          }
          @if (user.role === 'lab_tech') {
            <a mat-button routerLink="/lab/uploads" routerLinkActive="opacity-70">Uploads</a>
          }
          @if (user.role === 'admin') {
            <a mat-button routerLink="/clinic/dashboard" routerLinkActive="opacity-70">Dashboard</a>
            <a mat-button routerLink="/clinic/users" routerLinkActive="opacity-70">Usuários</a>
          }
        </nav>

        <button mat-icon-button [matMenuTriggerFor]="menu">
          <mat-icon>account_circle</mat-icon>
        </button>
        <mat-menu #menu="matMenu">
          <div class="px-4 py-2 text-sm text-gray-600">{{ user.role }}</div>
          <button mat-menu-item (click)="auth.logout()">
            <mat-icon>logout</mat-icon> Sair
          </button>
        </mat-menu>
      </mat-toolbar>
    }

    <router-outlet />
  `
})
export class AppComponent {
  auth = inject(AuthService);
}
