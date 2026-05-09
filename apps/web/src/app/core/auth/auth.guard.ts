import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.currentUser) {
    router.navigate(['/login']);
    return false;
  }
  // Força troca de senha quando master marcou a flag — exceto se já está na tela de troca
  // (evita loop) ou se está na tela de login.
  const path = route.routeConfig?.path || '';
  if (auth.currentProfile?.password_change_required && path !== 'account/change-password' && path !== 'login') {
    return router.parseUrl('/account/change-password');
  }
  return true;
};
