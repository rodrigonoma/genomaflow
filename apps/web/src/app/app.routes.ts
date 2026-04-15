import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';

export const routes: Routes = [
  {
    path: 'login',
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
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: '**', redirectTo: 'login' }
];
