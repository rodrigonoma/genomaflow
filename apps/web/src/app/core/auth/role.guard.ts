import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export function roleGuard(requiredRole: string): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.currentUser || auth.currentUser.role !== requiredRole) {
      router.navigate(['/login']);
      return false;
    }
    return true;
  };
}
