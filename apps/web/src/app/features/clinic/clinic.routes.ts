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
  {
    path: 'integrations',
    loadComponent: () =>
      import('./integrations/integrations.component').then(m => m.IntegrationsComponent)
  },
  {
    path: 'integrations/new',
    loadComponent: () =>
      import('./integrations/wizard/wizard.component').then(m => m.WizardComponent)
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
];
