import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  Appointment,
  ScheduleSettings,
  FreeSlot,
  AppointmentStatus,
} from './agenda.models';

export interface CreateAppointmentBody {
  start_at: string;
  duration_minutes: number;
  status: AppointmentStatus;
  subject_id?: string | null;
  reason?: string | null;
  notes?: string | null;
}

export interface UpdateAppointmentBody {
  start_at?: string;
  duration_minutes?: number;
  status?: AppointmentStatus;
  subject_id?: string | null;
  reason?: string | null;
  notes?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AgendaService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/agenda`;

  getSettings(): Observable<ScheduleSettings> {
    return this.http.get<ScheduleSettings>(`${this.base}/settings`);
  }

  saveSettings(settings: { default_slot_minutes: number; business_hours: any }): Observable<ScheduleSettings> {
    return this.http.put<ScheduleSettings>(`${this.base}/settings`, settings);
  }

  listAppointments(from?: string, to?: string): Observable<{ results: Appointment[] }> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<{ results: Appointment[] }>(`${this.base}/appointments`, { params });
  }

  create(body: CreateAppointmentBody): Observable<Appointment> {
    return this.http.post<Appointment>(`${this.base}/appointments`, body);
  }

  update(id: string, body: UpdateAppointmentBody): Observable<Appointment> {
    return this.http.patch<Appointment>(`${this.base}/appointments/${id}`, body);
  }

  cancel(id: string): Observable<{ id: string; status: string; cancelled_at: string }> {
    return this.http.post<any>(`${this.base}/appointments/${id}/cancel`, {});
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/appointments/${id}`);
  }

  freeSlots(date: string): Observable<{ date: string; day_of_week: string; default_slot_minutes: number; slots: FreeSlot[] }> {
    return this.http.get<any>(`${this.base}/appointments/free-slots`, { params: { date } });
  }
}
