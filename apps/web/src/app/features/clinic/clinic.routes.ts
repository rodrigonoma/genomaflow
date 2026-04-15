import { Routes } from '@angular/router';

export const CLINIC_ROUTES: Routes = [
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'users',
    loadComponent: () =>
      import('./users/users.component').then(m => m.UsersComponent)
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
];
