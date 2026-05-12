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

export interface CreateSeriesBody {
  start_at: string;
  duration_minutes: number;
  count: number;
  interval_days: number;
  subject_id: string;
  appointment_type?: string;
  reason?: string | null;
  notes?: string | null;
}

export interface SeriesCreatedResult {
  count: number;
  appointments: Appointment[];
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

  listAppointments(from?: string, to?: string, professionalId?: string | 'all'): Observable<{ results: Appointment[] }> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    if (professionalId) params = params.set('professional_id', professionalId);
    return this.http.get<{ results: Appointment[] }>(`${this.base}/appointments`, { params });
  }

  // Fase 1 PMS expansion — lista profissionais da clínica pra seletor multi-prof
  listProfessionals(): Observable<{ results: Array<{
    id: string; email: string; role: string; specialty: string | null;
    crm_number: string | null; crm_uf: string | null; professional_verified: boolean;
  }> }> {
    return this.http.get<any>(`${this.base}/professionals`);
  }

  create(body: CreateAppointmentBody): Observable<Appointment> {
    return this.http.post<Appointment>(`${this.base}/appointments`, body);
  }

  createSeries(body: CreateSeriesBody): Observable<SeriesCreatedResult> {
    return this.http.post<SeriesCreatedResult>(`${this.base}/appointments/series`, body);
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
