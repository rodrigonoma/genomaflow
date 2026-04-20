import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export const specialtyGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const http   = inject(HttpClient);
  const router = inject(Router);

  // Only doctors on the human module need a specialty set
  if (auth.currentUser?.module !== 'human' || auth.currentUser?.role !== 'doctor') return true;

  return http.get<{ specialty: string | null }>(`${environment.apiUrl}/auth/me`).pipe(
    map(user => {
      if (!user.specialty) {
        return router.createUrlTree(['/onboarding/specialty']);
      }
      return true;
    }),
    catchError(() => of(true as const))
  );
};
