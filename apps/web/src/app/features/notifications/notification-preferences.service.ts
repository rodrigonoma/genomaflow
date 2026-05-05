import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface NotificationPreferences {
  tenant_id?: string;
  appointment_reminder_enabled: boolean;
  reminder_hours_before: number[];
  reminder_via: 'whatsapp' | 'email' | 'both';
  send_window_start: string;
  send_window_end: string;
  nps_enabled: boolean;
  nps_via: 'email' | 'whatsapp';
  nps_delay_hours: number;
  // Phase 4.2 follow-ups
  post_consultation_followup_enabled: boolean;
  post_consultation_followup_days: number;
  exam_alert_followup_enabled: boolean;
  exam_alert_followup_days: number;
  vaccine_dose_reminder_enabled: boolean;
  vaccine_dose_reminder_hours_before: number[];
  is_default?: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationPreferencesService {
  private http = inject(HttpClient);
  private base = environment.apiUrl + '/notifications';

  get(): Observable<NotificationPreferences> {
    return this.http.get<NotificationPreferences>(`${this.base}/preferences`);
  }

  update(patch: Partial<NotificationPreferences>): Observable<NotificationPreferences> {
    return this.http.put<NotificationPreferences>(`${this.base}/preferences`, patch);
  }
}
