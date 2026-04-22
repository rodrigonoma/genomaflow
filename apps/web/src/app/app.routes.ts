import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { Router } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { masterGuard } from './core/auth/master.guard';
import { termsGuard } from './features/terms/terms.guard';
import { AuthService } from './core/auth/auth.service';

const homeForRole = (router: Router, role: string | undefined) => {
  if (role === 'master') return router.createUrlTree(['/master']);
  return router.createUrlTree(['/clinic/dashboard']);
};

const rootRedirectGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.currentUser) return router.createUrlTree(['/login']);
  return homeForRole(router, auth.currentUser.role);
};

const loginGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.currentUser) return true;
  return homeForRole(router, auth.currentUser.role);
};

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () =>
      import('./features/auth/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'master',
    canActivate: [authGuard, masterGuard],
    loadComponent: () =>
      import('./features/master/master.component').then(m => m.MasterComponent)
  },
  {
    path: 'doctor',
    canActivate: [authGuard, termsGuard],
    loadChildren: () =>
      import('./features/doctor/doctor.routes').then(m => m.DOCTOR_ROUTES)
  },
  {
    path: 'clinic',
    canActivate: [authGuard, termsGuard],
    loadChildren: () =>
      import('./features/clinic/clinic.routes').then(m => m.CLINIC_ROUTES)
  },
  {
    path: 'results/:examId',
    canActivate: [authGuard, termsGuard],
    loadComponent: () =>
      import('./features/doctor/results/result-panel.component').then(m => m.ResultPanelComponent)
  },
  {
    path: 'onboarding/terms',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/terms/terms-acceptance.component').then(m => m.TermsAcceptanceComponent)
  },
  {
    path: 'onboarding',
    loadComponent: () =>
      import('./features/onboarding/onboarding.component').then(m => m.OnboardingComponent)
  },
  { path: '', canActivate: [rootRedirectGuard], children: [] },
  { path: '**', redirectTo: 'login' }
];
