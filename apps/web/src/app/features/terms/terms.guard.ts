import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { TermsService } from './terms.service';

/**
 * Guard: bloqueia acesso à aplicação caso o usuário tenha documentos legais pendentes.
 * Redireciona para /onboarding/terms.
 */
export const termsGuard: CanActivateFn = () => {
  const terms = inject(TermsService);
  const router = inject(Router);

  return terms.getStatus().pipe(
    map(status => {
      if (status.all_accepted) return true;
      return router.parseUrl('/onboarding/terms');
    }),
    catchError(() => of(true)) // Em caso de erro, não bloqueia (evita lockout)
  );
};
