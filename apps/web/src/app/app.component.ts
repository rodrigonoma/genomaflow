import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AsyncPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from './core/auth/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AsyncPipe,
            MatIconModule, MatMenuModule, MatButtonModule, MatTooltipModule],
  styles: [`
    :host { display: block; }

    .sidebar {
      position: fixed; left: 0; top: 0; bottom: 0;
      width: 240px; background: #0b1326;
      border-right: 1px solid rgba(70,69,84,0.15);
      display: flex; flex-direction: column; z-index: 100;
    }

    .sidebar-brand {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid rgba(70,69,84,0.15);
    }

    .brand-name {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 1.125rem;
      color: #c0c1ff; letter-spacing: -0.02em;
    }

    .brand-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; text-transform: uppercase;
      letter-spacing: 0.1em; color: #464554;
      margin-top: 2px;
    }

    .sidebar-nav { flex: 1; padding: 0.75rem 0; overflow-y: auto; }

    .nav-section-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; text-transform: uppercase;
      letter-spacing: 0.15em; color: #464554;
      padding: 0 1.5rem; margin: 1rem 0 0.25rem;
    }

    .nav-item {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.625rem 1.5rem;
      color: #908fa0;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 500; font-size: 0.875rem;
      text-decoration: none; cursor: pointer; background: none; border: none; width: 100%;
      border-left: 3px solid transparent;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
      text-align: left;
    }
    .nav-item:hover { background: #131b2e; color: #dae2fd; }
    .nav-item.active { background: #171f33; color: #c0c1ff; border-left-color: #494bd6; }
    ::ng-deep .nav-item .mat-icon { font-size: 18px !important; width: 18px !important; height: 18px !important; opacity: 0.7; }
    ::ng-deep .nav-item.active .mat-icon { opacity: 1; }

    .sidebar-footer {
      padding: 1rem 1.5rem;
      border-top: 1px solid rgba(70,69,84,0.15);
    }

    .topbar {
      position: fixed; top: 0; left: 240px; right: 0;
      height: 56px; background: #0b1326;
      border-bottom: 1px solid rgba(70,69,84,0.15);
      display: flex; align-items: center; justify-content: flex-end;
      padding: 0 1.5rem; z-index: 99;
    }

    .user-chip {
      display: flex; align-items: center; gap: 0.5rem;
      cursor: pointer; padding: 0.375rem 0.75rem;
      border-radius: 4px;
      border: 1px solid rgba(70,69,84,0.25);
      background: transparent;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .user-chip:hover { background: #131b2e; }

    .user-role-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.1em; color: #908fa0;
    }

    .main-content {
      margin-left: 240px;
      margin-top: 56px;
      min-height: calc(100vh - 56px);
      background: #0b1326;
    }
  `],
  template: `
    @if (auth.currentUser$ | async; as user) {
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="brand-name">GenomaFlow</div>
          <div class="brand-badge">Clinical AI &middot; v1.0</div>
        </div>

        <nav class="sidebar-nav">
          @if (user.role === 'admin') {
            <div class="nav-section-label">Gestão</div>
            <a class="nav-item" routerLink="/clinic/dashboard" routerLinkActive="active">
              <mat-icon>dashboard</mat-icon> Dashboard
            </a>
            <a class="nav-item" routerLink="/clinic/users" routerLinkActive="active">
              <mat-icon>group</mat-icon> Usuários
            </a>
            <a class="nav-item" routerLink="/clinic/integrations" routerLinkActive="active">
              <mat-icon>cable</mat-icon> Integrações
            </a>
          }
          @if (user.role === 'doctor') {
            <div class="nav-section-label">Clínica</div>
            <a class="nav-item" routerLink="/doctor/patients" routerLinkActive="active">
              <mat-icon>people</mat-icon> Pacientes
            </a>
          }
          @if (user.role === 'lab_tech') {
            <div class="nav-section-label">Laboratório</div>
            <a class="nav-item" routerLink="/lab/uploads" routerLinkActive="active">
              <mat-icon>upload_file</mat-icon> Upload de Exames
            </a>
          }
          <div class="nav-section-label" style="margin-top: 2rem">Sistema</div>
          <button class="nav-item" (click)="auth.logout()">
            <mat-icon>logout</mat-icon> Sair
          </button>
        </nav>

        <div class="sidebar-footer">
          <div class="user-role-label">{{ user.role }}</div>
        </div>
      </aside>

      <header class="topbar">
        <div class="user-chip" [matMenuTriggerFor]="menu">
          <mat-icon style="font-size:16px;width:16px;height:16px;color:#c0c1ff">account_circle</mat-icon>
          <span class="user-role-label">{{ user.role }}</span>
          <mat-icon style="font-size:14px;width:14px;height:14px;color:#464554">expand_more</mat-icon>
        </div>
        <mat-menu #menu="matMenu">
          <div style="padding:0.5rem 1rem;font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#908fa0;border-bottom:1px solid rgba(70,69,84,0.2);margin-bottom:4px;">
            {{ user.role }}
          </div>
          <button mat-menu-item (click)="auth.logout()">
            <mat-icon>logout</mat-icon> Sair
          </button>
        </mat-menu>
      </header>

      <main class="main-content">
        <router-outlet />
      </main>
    } @else {
      <router-outlet />
    }
  `
})
export class AppComponent {
  auth = inject(AuthService);
}
