# Visual Identity — Clinical Sentinel Design System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the Clinical Sentinel design system to the GenomaFlow Angular 18 app, replacing the current generic Material UI with a dark-mode-first, AI-native clinical interface.

**Architecture:** Tailwind custom tokens → Angular Material theme override → component-by-component redesign. Task 1 must complete before any other task. Tasks 2–7 are independent of each other.

**Tech Stack:** Angular 18 standalone components, Angular Material, Tailwind CSS 3, SCSS, Google Fonts (Space Grotesk, Inter, JetBrains Mono, Material Symbols Outlined)

---

## Design System Reference

### Colors (exact hex)
```
background / surface:           #0b1326
surface_container_lowest:       #060e20
surface_container_low:          #131b2e
surface_container:              #171f33
surface_container_high:         #222a3d
surface_container_highest:      #2d3449
surface_bright:                 #31394d

primary:                        #c0c1ff
on_primary:                     #1000a9
primary_container:              #8083ff
on_primary_container:           #0d0096
inverse_primary:                #494bd6

on_background / on_surface:     #dae2fd
on_surface_variant:             #c7c4d7
outline:                        #908fa0
outline_variant:                #464554

error:                          #ffb4ab
on_error:                       #690005
error_container:                #93000a
on_error_container:             #ffdad6

tertiary:                       #ffb783
on_tertiary:                    #4f2500
tertiary_container:             #d97721

secondary:                      #c0c1ff
secondary_container:            #42447b
on_secondary_container:         #b2b3f2
```

### Typography
- **font-headline**: Space Grotesk (700 for titles, 500 for section headers)
- **font-body / font-label**: Inter (400/500/600)
- **font-mono**: JetBrains Mono — ALL numeric data, timestamps, lab values, status codes
- **Icons**: Material Symbols Outlined (wght 400, FILL 0)

### Border Radius
- DEFAULT: 2px | lg: 4px | xl: 8px | full: 12px

### Spacing / Motion
- 8px grid. Transitions: 150ms cubic-bezier(0.4, 0, 0.2, 1) on all interactive elements.
- `intelligence-pulse`: animated 2px line sweep across top of processing cards
- `ghost-border`: 1px solid rgba(70,69,84,0.15) — "felt, not seen"

### Design Rules
- Dark mode ONLY — `<html class="dark">`, background always #0b1326
- No 1px solid borders for layout sectioning — use background color shifts
- ALL numbers/values in JetBrains Mono
- Left border 4px on patient/exam cards: critical=#ffb4ab, high=#ffb783, medium=#c0c1ff
- Left border 2px inverse_primary (#494bd6) on AI-generated content
- 150ms cubic-bezier on all transitions

---

## Task 1: Design Tokens + Global Styles + Fonts

**Files:**
- Modify: `apps/web/tailwind.config.js`
- Modify: `apps/web/src/index.html`
- Modify: `apps/web/src/styles.scss`

- [ ] **Step 1: Update tailwind.config.js**

Replace entire file with:

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0b1326',
        surface: '#0b1326',
        'surface-dim': '#0b1326',
        'surface-bright': '#31394d',
        'surface-container-lowest': '#060e20',
        'surface-container-low': '#131b2e',
        'surface-container': '#171f33',
        'surface-container-high': '#222a3d',
        'surface-container-highest': '#2d3449',
        'surface-variant': '#2d3449',
        primary: '#c0c1ff',
        'on-primary': '#1000a9',
        'primary-container': '#8083ff',
        'on-primary-container': '#0d0096',
        'primary-fixed': '#e1e0ff',
        'primary-fixed-dim': '#c0c1ff',
        'on-primary-fixed': '#07006c',
        'on-primary-fixed-variant': '#2f2ebe',
        'inverse-primary': '#494bd6',
        'surface-tint': '#c0c1ff',
        secondary: '#c0c1ff',
        'on-secondary': '#292a60',
        'secondary-container': '#42447b',
        'on-secondary-container': '#b2b3f2',
        'secondary-fixed': '#e1e0ff',
        'secondary-fixed-dim': '#c0c1ff',
        'on-secondary-fixed': '#13144a',
        'on-secondary-fixed-variant': '#404178',
        tertiary: '#ffb783',
        'on-tertiary': '#4f2500',
        'tertiary-container': '#d97721',
        'on-tertiary-container': '#452000',
        'tertiary-fixed': '#ffdcc5',
        'tertiary-fixed-dim': '#ffb783',
        'on-tertiary-fixed': '#301400',
        'on-tertiary-fixed-variant': '#703700',
        error: '#ffb4ab',
        'on-error': '#690005',
        'error-container': '#93000a',
        'on-error-container': '#ffdad6',
        'on-background': '#dae2fd',
        'on-surface': '#dae2fd',
        'on-surface-variant': '#c7c4d7',
        outline: '#908fa0',
        'outline-variant': '#464554',
        'inverse-on-surface': '#283044',
        'inverse-surface': '#dae2fd',
        scrim: '#000000',
        shadow: '#000000',
      },
      borderRadius: {
        DEFAULT: '0.125rem',
        lg: '0.25rem',
        xl: '0.5rem',
        full: '0.75rem',
      },
      fontFamily: {
        headline: ['Space Grotesk', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        label: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false,
  },
};
```

- [ ] **Step 2: Update index.html**

Replace entire file with:

```html
<!doctype html>
<html lang="pt-BR" class="dark">
<head>
  <meta charset="utf-8">
  <title>GenomaFlow</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet">
</head>
<body class="mat-typography bg-background text-on-background">
  <app-root></app-root>
</body>
</html>
```

- [ ] **Step 3: Replace styles.scss**

Replace entire file with:

```scss
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ─── Base ─────────────────────────────────────────────── */
* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: #0b1326;
  color: #dae2fd;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* ─── Typography helpers ────────────────────────────────── */
.font-headline { font-family: 'Space Grotesk', sans-serif; }
.font-mono     { font-family: 'JetBrains Mono', monospace; }

/* ─── Custom components ─────────────────────────────────── */
.ghost-border {
  border: 1px solid rgba(70, 69, 84, 0.15);
}

.intelligence-pulse {
  position: relative;
  overflow: hidden;
}
.intelligence-pulse::after {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 2px;
  background: #c0c1ff;
  box-shadow: 0 0 8px #c0c1ff;
  animation: pulse-slide 2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
@keyframes pulse-slide {
  0%   { left: -100%; }
  100% { left: 100%; }
}

.page-container {
  max-width: 1600px;
  margin: 0 auto;
  padding: 2rem;
}

/* ─── Angular Material overrides ────────────────────────── */

/* Toolbar */
.mat-toolbar {
  background: #0b1326 !important;
  color: #dae2fd !important;
  border-bottom: 1px solid rgba(70, 69, 84, 0.15) !important;
  font-family: 'Space Grotesk', sans-serif !important;
}

/* Buttons */
.mat-mdc-raised-button.mat-primary,
.mat-mdc-flat-button.mat-primary {
  --mdc-filled-button-container-color: #c0c1ff;
  --mdc-filled-button-label-text-color: #1000a9;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  letter-spacing: 0.05em;
  border-radius: 4px;
}

.mat-mdc-button {
  color: #c7c4d7 !important;
  font-family: 'Space Grotesk', sans-serif !important;
  font-weight: 700 !important;
  &:hover { color: #dae2fd !important; }
}

.mat-mdc-icon-button {
  color: #c7c4d7 !important;
  &:hover { color: #c0c1ff !important; }
}

/* Menu */
.mat-mdc-menu-panel {
  background: #222a3d !important;
  border: 1px solid rgba(70, 69, 84, 0.3) !important;
  border-radius: 4px !important;
}
.mat-mdc-menu-item {
  color: #dae2fd !important;
  font-family: 'Inter', sans-serif !important;
  &:hover { background: #2d3449 !important; }
}

/* Form fields */
.mat-mdc-form-field {
  --mdc-outlined-text-field-outline-color: rgba(70,69,84,0.4);
  --mdc-outlined-text-field-focus-outline-color: #c0c1ff;
  --mdc-outlined-text-field-label-text-color: #908fa0;
  --mdc-outlined-text-field-input-text-color: #dae2fd;
  --mdc-outlined-text-field-container-color: #2d3449;
  font-family: 'Inter', sans-serif;
}
.mat-mdc-form-field-focus-overlay { background: transparent !important; }

/* Select */
.mat-mdc-select-value { color: #dae2fd !important; }
.mat-mdc-select-arrow { color: #908fa0 !important; }
.mat-mdc-option {
  background: #222a3d !important;
  color: #dae2fd !important;
  &:hover, &.mat-mdc-option-active { background: #2d3449 !important; }
}
.mat-mdc-select-panel {
  background: #222a3d !important;
  border: 1px solid rgba(70,69,84,0.3) !important;
}

/* Table */
.mat-mdc-table {
  background: transparent !important;
  font-family: 'Inter', sans-serif;
}
.mat-mdc-header-row {
  background: #171f33 !important;
}
.mat-mdc-header-cell {
  color: #908fa0 !important;
  font-family: 'JetBrains Mono', monospace !important;
  font-size: 10px !important;
  text-transform: uppercase !important;
  letter-spacing: 0.1em !important;
  border-bottom: 1px solid rgba(70,69,84,0.15) !important;
}
.mat-mdc-row {
  background: transparent !important;
  &:hover { background: rgba(23,31,51,0.5) !important; }
}
.mat-mdc-cell {
  color: #dae2fd !important;
  border-bottom: 1px solid rgba(70,69,84,0.1) !important;
}

/* Tabs */
.mat-mdc-tab {
  font-family: 'Space Grotesk', sans-serif !important;
  color: #908fa0 !important;
}
.mat-mdc-tab.mdc-tab--active {
  color: #c0c1ff !important;
}
.mat-mdc-tab-header {
  border-bottom: 1px solid rgba(70,69,84,0.15) !important;
}
.mdc-tab-indicator__content--underline {
  border-color: #c0c1ff !important;
}

/* Input */
.mat-mdc-input-element {
  color: #dae2fd !important;
  font-family: 'Inter', sans-serif !important;
  caret-color: #c0c1ff !important;
}

/* Tooltip */
.mat-mdc-tooltip {
  background: #2d3449 !important;
  color: #dae2fd !important;
  font-family: 'Inter', sans-serif !important;
  font-size: 12px !important;
  border-radius: 4px !important;
}

/* Snackbar */
.mat-mdc-snack-bar-container {
  background: #222a3d !important;
  color: #dae2fd !important;
  border: 1px solid rgba(70,69,84,0.3) !important;
  border-radius: 4px !important;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #0b1326; }
::-webkit-scrollbar-thumb { background: #2d3449; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #464554; }

/* Material Symbols */
.material-symbols-outlined {
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}
```

- [ ] **Step 4: Verify ng serve recompiles without error**

```bash
tail -5 /tmp/ng-serve.log
```
Expected: "Application bundle generation complete" with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
cd /home/rodrigonoma/GenomaFlow
git add apps/web/tailwind.config.js apps/web/src/index.html apps/web/src/styles.scss
git commit -m "feat: apply Clinical Sentinel design tokens, fonts and global styles"
```

---

## Task 2: App Shell — Sidebar + Topbar

**Files:**
- Modify: `apps/web/src/app/app.component.ts`

Current file is a simple top toolbar. Replace with a two-column layout: fixed left sidebar (navigation) + fixed top bar (brand + user menu) + scrollable main content area.

- [ ] **Step 1: Replace app.component.ts template and class**

```typescript
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
      display: flex; align-items: center; gap: 0.75rem;
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

    .sidebar-nav { flex: 1; padding: 1rem 0; overflow-y: auto; }

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
      text-decoration: none; cursor: pointer;
      border-left: 3px solid transparent;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .nav-item:hover {
      background: #131b2e; color: #dae2fd;
    }
    .nav-item.active {
      background: #171f33; color: #c0c1ff;
      border-left-color: #494bd6;
    }
    .nav-item .mat-icon {
      font-size: 18px; width: 18px; height: 18px;
      opacity: 0.7;
    }
    .nav-item.active .mat-icon { opacity: 1; }

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

    .user-info {
      display: flex; align-items: center; gap: 0.5rem;
      cursor: pointer; padding: 0.375rem 0.75rem;
      border-radius: 4px;
      border: 1px solid rgba(70,69,84,0.2);
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .user-info:hover { background: #131b2e; }

    .user-role {
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
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div>
            <div class="brand-name">GenomaFlow</div>
            <div class="brand-badge">Clinical AI · v1.0</div>
          </div>
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
          <div class="nav-section-label" style="margin-top:2rem">Sistema</div>
          <a class="nav-item" style="cursor:pointer" (click)="auth.logout()">
            <mat-icon>logout</mat-icon> Sair
          </a>
        </nav>

        <div class="sidebar-footer">
          <div class="user-role">{{ user.role }}</div>
        </div>
      </aside>

      <!-- Topbar -->
      <header class="topbar">
        <div class="user-info" [matMenuTriggerFor]="menu">
          <mat-icon style="font-size:16px;width:16px;height:16px;color:#c0c1ff">account_circle</mat-icon>
          <span class="user-role">{{ user.role }}</span>
          <mat-icon style="font-size:14px;width:14px;height:14px;color:#464554">expand_more</mat-icon>
        </div>
        <mat-menu #menu="matMenu">
          <div style="padding:0.5rem 1rem;font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#908fa0;">
            {{ user.role }}
          </div>
          <button mat-menu-item (click)="auth.logout()">
            <mat-icon>logout</mat-icon> Sair
          </button>
        </mat-menu>
      </header>

      <!-- Main -->
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
```

- [ ] **Step 2: Verify ng serve recompiles without error**

```bash
tail -5 /tmp/ng-serve.log
```

- [ ] **Step 3: Commit**

```bash
cd /home/rodrigonoma/GenomaFlow
git add apps/web/src/app/app.component.ts
git commit -m "feat: Clinical Sentinel app shell — sidebar + topbar layout"
```

---

## Task 3: Login Component

**Files:**
- Modify: `apps/web/src/app/features/auth/login.component.ts`

- [ ] **Step 1: Replace login component template**

```typescript
import { Component, inject } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  styles: [`
    :host {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: #0b1326;
    }
    .login-card {
      width: 400px; background: #131b2e;
      border: 1px solid rgba(70,69,84,0.2);
      border-radius: 4px; padding: 2.5rem;
    }
    .brand {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 1.5rem;
      color: #c0c1ff; letter-spacing: -0.02em;
      margin-bottom: 0.25rem;
    }
    .brand-sub {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.15em; color: #464554;
      margin-bottom: 2rem;
    }
    h2 {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 1.125rem;
      color: #dae2fd; margin: 0 0 1.5rem;
    }
    .field { margin-bottom: 1rem; width: 100%; }
    .error-msg {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; color: #ffb4ab;
      background: rgba(147,0,10,0.15);
      border: 1px solid rgba(255,180,171,0.2);
      border-radius: 4px; padding: 0.5rem 0.75rem;
      margin-bottom: 1rem;
    }
    .submit-btn {
      width: 100%; height: 44px;
      background: #c0c1ff; color: #1000a9;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 0.8125rem;
      text-transform: uppercase; letter-spacing: 0.08em;
      border: none; border-radius: 4px; cursor: pointer;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .submit-btn:hover:not(:disabled) { filter: brightness(1.1); }
    .submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  `],
  template: `
    <div class="login-card">
      <div class="brand">GenomaFlow</div>
      <div class="brand-sub">Clinical AI Platform · v1.0</div>
      <h2>Acesso ao sistema</h2>

      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field class="field" appearance="outlined">
          <mat-label>E-mail</mat-label>
          <input matInput type="email" formControlName="email" autocomplete="email" />
        </mat-form-field>

        <mat-form-field class="field" appearance="outlined">
          <mat-label>Senha</mat-label>
          <input matInput [type]="showPass ? 'text' : 'password'" formControlName="password" autocomplete="current-password" />
          <button mat-icon-button matSuffix type="button" (click)="showPass = !showPass">
            <mat-icon>{{ showPass ? 'visibility_off' : 'visibility' }}</mat-icon>
          </button>
        </mat-form-field>

        @if (error) {
          <div class="error-msg">{{ error }}</div>
        }

        <button class="submit-btn" type="submit" [disabled]="form.invalid || loading">
          {{ loading ? 'AUTENTICANDO...' : 'ENTRAR' }}
        </button>
      </form>
    </div>
  `
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required]
  });

  error = '';
  loading = false;
  showPass = false;

  async submit() {
    if (this.form.invalid) return;
    this.loading = true;
    this.error = '';
    const { email, password } = this.form.value;
    this.auth.login(email!, password!).subscribe({
      next: () => this.router.navigate(['/']),
      error: () => {
        this.error = 'E-mail ou senha inválidos';
        this.loading = false;
      }
    });
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
tail -5 /tmp/ng-serve.log
```

- [ ] **Step 3: Commit**

```bash
cd /home/rodrigonoma/GenomaFlow
git add apps/web/src/app/features/auth/login.component.ts
git commit -m "feat: Clinical Sentinel login page design"
```

---

## Task 4: Lab Uploads Component

**Files:**
- Modify: `apps/web/src/app/features/lab/uploads/uploads.component.ts`

Read the current file first, then replace ONLY the `template` and `styles` (or `styles: []`) — keep all the TypeScript class logic (properties and methods) exactly as-is.

The new template must:
- Dark card layout with `surface-container-low` background
- "Upload de Exames" title in Space Grotesk bold
- Two tabs (Individual / Lote) styled with the design system
- Patient search input styled with ghost border
- File selector button in primary color
- "Enviar" button: primary style, full width
- Queue table: JetBrains Mono for filenames/dates, status pills with left-border risk colors
  - pending: outline-variant color
  - processing: primary color + intelligence-pulse on row
  - done: green (#10b981)
  - error: error color (#ffb4ab)
- Actions column: icon button to view results

Add component-level styles with `:host { display: block; background: #0b1326; min-height: 100vh; padding: 2rem; }` and keep existing TypeScript logic intact.

- [ ] **Step 1: Read current file to preserve TypeScript logic**

Read `/home/rodrigonoma/GenomaFlow/apps/web/src/app/features/lab/uploads/uploads.component.ts` fully.

- [ ] **Step 2: Rewrite component with Clinical Sentinel design, preserving all TS logic**

Keep all imports, interfaces, and class methods unchanged. Only update `template` and add `styles`.

- [ ] **Step 3: Verify compilation**

```bash
tail -5 /tmp/ng-serve.log
```

- [ ] **Step 4: Commit**

```bash
cd /home/rodrigonoma/GenomaFlow
git add apps/web/src/app/features/lab/uploads/uploads.component.ts
git commit -m "feat: Clinical Sentinel design — uploads component"
```

---

## Task 5: Result Panel Component

**Files:**
- Modify: `apps/web/src/app/features/doctor/results/result-panel.component.ts`

Read the current file first. Redesign with:
- Full dark background page, max-width 1200px centered, padding 2rem
- Top section: patient info + exam status badge (JetBrains Mono)
- Per agent result card:
  - Left border 4px: critical=#ffb4ab, high=#ffb783, medium=#c0c1ff, low=#10b981
  - Agent type badge: JetBrains Mono, 10px, uppercase, ghost-border
  - Risk score: JetBrains Mono bold 1.5rem, colored by severity
  - Interpretation text: Inter 14px, on-surface-variant
  - Left border 2px #494bd6 (inverse-primary) on the interpretation block (AI-generated content marker)
- Alerts section: each alert as a pill with severity color
- Disclaimer: italic, on-surface-variant, 12px, font-mono
- Keep ALL TypeScript logic unchanged

- [ ] **Step 1: Read current result-panel.component.ts**
- [ ] **Step 2: Redesign template + add styles, preserve TS logic**
- [ ] **Step 3: Verify compilation**
- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/doctor/results/result-panel.component.ts
git commit -m "feat: Clinical Sentinel design — result panel component"
```

---

## Task 6: Patient List + Patient Detail

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-list.component.ts`
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`

Read both files first. For patient-list:
- Dark page with `surface-container-low` patient cards
- Left border 4px on each patient card (use risk color if available, else primary)
- Patient name: Space Grotesk bold 1rem
- CPF/date: JetBrains Mono 11px, on-surface-variant
- "Ver detalhes" button: secondary style (surface-container-highest, primary text)
- Preserve all TS logic

For patient-detail:
- Header with patient name (Space Grotesk 1.5rem bold), metadata in JetBrains Mono
- Exam list as cards with status pills and left-border colors
- "Novo exame" button: primary style
- Preserve all TS logic

- [ ] **Step 1: Read both files**
- [ ] **Step 2: Redesign both, preserve TS logic**
- [ ] **Step 3: Verify compilation**
- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/doctor/patients/patient-list.component.ts \
        apps/web/src/app/features/doctor/patients/patient-detail.component.ts
git commit -m "feat: Clinical Sentinel design — patient list and detail"
```

---

## Task 7: Clinic Dashboard + Users

**Files:**
- Modify: `apps/web/src/app/features/clinic/dashboard/dashboard.component.ts`
- Modify: `apps/web/src/app/features/clinic/users/users.component.ts`

Read both files first.

For dashboard:
- 4-column metric grid: each card `surface-container-low`, ghost-border, value in JetBrains Mono bold 1.875rem primary color, label in JetBrains Mono 10px uppercase on-surface-variant
- Section titles in Space Grotesk bold 1rem
- intelligence-pulse animation on any "processing" indicator
- Preserve all TS logic

For users:
- Table with Clinical Sentinel style (header: JetBrains Mono 10px uppercase, rows: Inter 14px, hover: surface-container/50)
- "Novo usuário" button: primary style
- Role badges: JetBrains Mono 10px, rounded-lg, colored by role (admin: primary/10 text-primary, doctor: secondary/10, lab_tech: tertiary/10)
- Preserve all TS logic

- [ ] **Step 1: Read both files**
- [ ] **Step 2: Redesign both, preserve TS logic**
- [ ] **Step 3: Verify compilation**
- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/clinic/dashboard/dashboard.component.ts \
        apps/web/src/app/features/clinic/users/users.component.ts
git commit -m "feat: Clinical Sentinel design — dashboard and users"
```
