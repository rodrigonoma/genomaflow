import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

export const masterGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = auth.currentUser;
  if (!user) return router.createUrlTree(['/login']);
  if (user.role !== 'master') return router.createUrlTree(['/login']);
  return true;
};
