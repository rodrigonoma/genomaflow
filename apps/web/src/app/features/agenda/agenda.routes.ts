import { Routes } from '@angular/router';

export const AGENDA_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./agenda-page.component').then(m => m.AgendaPageComponent),
  },
];
