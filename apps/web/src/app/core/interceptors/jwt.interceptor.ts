import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../auth/auth.service';

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const snack = inject(MatSnackBar);
  const token = auth.getToken();

  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        if (error.error?.error === 'session_replaced') {
          snack.open(
            error.error?.message ?? 'Sua sessão foi encerrada porque outro dispositivo fez login com esta conta.',
            'Fechar',
            { duration: 8000, panelClass: ['snack-warn'] }
          );
        }
        auth.logout();
      }
      return throwError(() => error);
    })
  );
};
