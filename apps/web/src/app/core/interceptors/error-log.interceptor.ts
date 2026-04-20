import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export const errorLogInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const url = req.url;
      const skipLog = url.includes('/error-log') || url.includes('/auth/login');

      if (!skipLog && error.status >= 400) {
        const token = auth.getToken();
        const body = {
          url,
          method: req.method,
          status_code: error.status,
          error_message: error.message ?? String(error.status)
        };
        fetch('/api/error-log', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify(body),
          keepalive: true
        }).catch(() => {});
      }

      return throwError(() => error);
    })
  );
};
