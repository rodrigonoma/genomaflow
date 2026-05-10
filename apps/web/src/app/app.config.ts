import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';
import { routes } from './app.routes';
import { jwtInterceptor } from './core/interceptors/jwt.interceptor';
import { errorLogInterceptor } from './core/interceptors/error-log.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([jwtInterceptor, errorLogInterceptor])),
    provideAnimationsAsync(),
    // Cap global de largura — protege dialogs em mobile <640px sem precisar
    // adicionar maxWidth em cada dialog.open() individual. width específico
    // (ex: '480px') continua respeitado quando cabe; só caps no viewport.
    { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: { maxWidth: '95vw' } },
  ]
};
