import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { Router } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';
import { AuthService } from './core/auth/auth.service';

const rootRedirectGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = auth.currentUser;
  if (!user) return router.createUrlTree(['/login']);
  if (user.role === 'doctor') return router.createUrlTree(['/doctor/patients']);
  if (user.role === 'lab_tech') return router.createUrlTree(['/lab/uploads']);
  return router.createUrlTree(['/clinic/dashboard']);
};

const loginGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = auth.currentUser;
  if (!user) return true;
  if (user.role === 'doctor') return router.createUrlTree(['/doctor/patients']);
  if (user.role === 'lab_tech') return router.createUrlTree(['/lab/uploads']);
  return router.createUrlTree(['/clinic/dashboard']);
};

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () =>
      import('./features/auth/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'doctor',
    canActivate: [authGuard, roleGuard('doctor')],
    loadChildren: () =>
      import('./features/doctor/doctor.routes').then(m => m.DOCTOR_ROUTES)
  },
  {
    path: 'lab',
    canActivate: [authGuard, roleGuard('lab_tech')],
    loadChildren: () =>
      import('./features/lab/lab.routes').then(m => m.LAB_ROUTES)
  },
  {
    path: 'clinic',
    canActivate: [authGuard, roleGuard('admin')],
    loadChildren: () =>
      import('./features/clinic/clinic.routes').then(m => m.CLINIC_ROUTES)
  },
  {
    path: 'results/:examId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/doctor/results/result-panel.component').then(m => m.ResultPanelComponent)
  },
  {
    path: 'onboarding',
    loadComponent: () =>
      import('./features/onboarding/onboarding.component').then(m => m.OnboardingComponent)
  },
  { path: '', canActivate: [rootRedirectGuard], children: [] },
  { path: '**', redirectTo: 'login' }
];
