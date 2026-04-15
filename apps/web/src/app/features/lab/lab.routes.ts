import { Routes } from '@angular/router';

export const LAB_ROUTES: Routes = [
  {
    path: 'uploads',
    loadComponent: () =>
      import('./uploads/uploads.component').then(m => m.UploadsComponent)
  },
  { path: '', redirectTo: 'uploads', pathMatch: 'full' }
];
