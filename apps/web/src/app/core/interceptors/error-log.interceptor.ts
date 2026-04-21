import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export const errorLogInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  // Capture user context at request time — before a potential 401 triggers logout
  const currentUser = auth.currentUser;
  const token = auth.getToken();

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const url = req.url;
      const skipLog = url.includes('/error-log') || url.includes('/auth/login');

      if (!skipLog && error.status >= 400) {
        const backendMsg = error.error?.error || error.error?.message || null;
        const errorMessage = backendMsg
          ? `[${error.status}] ${backendMsg}`
          : `[${error.status}] ${error.statusText || 'Unknown error'}`;
        const body = {
          url,
          method: req.method,
          status_code: error.status,
          error_message: errorMessage,
          tenant_id: (currentUser as any)?.tenant_id ?? null,
          user_id: (currentUser as any)?.user_id ?? null
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
