import { Routes } from '@angular/router';
export const CHAT_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./chat-page.component').then(m => m.ChatPageComponent) },
];
