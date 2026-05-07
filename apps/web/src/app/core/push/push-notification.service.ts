// apps/web/src/app/core/push/push-notification.service.ts
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  Token,
  ActionPerformed
} from '@capacitor/push-notifications';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private router = inject(Router);
  private http = inject(HttpClient);

  async initialize(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return;

    await PushNotifications.register();

    PushNotifications.addListener('registration', (token: Token) => {
      this.registerToken(token.value);
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('[push] registration error:', err);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      const route = action.notification.data?.route;
      if (route) this.router.navigateByUrl(route);
    });
  }

  private registerToken(token: string): void {
    const platform = Capacitor.getPlatform() as 'android' | 'ios';
    this.http.post(`${environment.apiUrl}/auth/device-token`, { token, platform })
      .subscribe({ error: (e) => console.error('[push] token registration failed:', e) });
  }

  removeToken(token: string): void {
    if (!Capacitor.isNativePlatform()) return;
    this.http.delete(`${environment.apiUrl}/auth/device-token`, { body: { token } })
      .subscribe({ error: () => {} });
  }
}
