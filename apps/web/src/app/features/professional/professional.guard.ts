import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ProfessionalService } from './professional.service';
import { AuthService } from '../../core/auth/auth.service';

/**
 * Guard: bloqueia acesso à aplicação caso o usuário ainda não tenha preenchido
 * CRM/CRMV + UF e confirmado a declaração de veracidade.
 * Redireciona para /onboarding/professional-info.
 * Usuários com role 'master' passam direto.
 */
export const professionalInfoGuard: CanActivateFn = () => {
  const svc = inject(ProfessionalService);
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.currentUser?.role === 'master') return true;

  return svc.getStatus().pipe(
    map(status => {
      if (status.confirmed) return true;
      return router.parseUrl('/onboarding/professional-info');
    }),
    catchError(() => of(true)) // Em caso de erro de rede, não bloqueia (evita lockout)
  );
};
