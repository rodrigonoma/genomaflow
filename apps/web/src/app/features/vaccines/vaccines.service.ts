import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface VaccineProtocol {
  id: string;
  tenant_id: string | null;
  species: string;
  name: string;
  description: string | null;
  doses: Array<{ label: string; age_min_days?: number; age_max_days?: number }>;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Vaccine {
  id: string;
  tenant_id: string;
  subject_id: string;
  professional_user_id: string;
  professional_email?: string;
  encounter_id: string | null;
  vaccine_name: string;
  manufacturer: string | null;
  lot_number: string | null;
  applied_at: string;
  next_dose_date: string | null;
  protocol_id: string | null;
  protocol_name?: string;
  protocol_dose_index: number | null;
  notes: string | null;
  attachments: any[];
  created_at: string;
  updated_at: string;
}

export interface VaccineUpcoming {
  id: string;
  subject_id: string;
  subject_name: string;
  species: string;
  vaccine_name: string;
  next_dose_date: string;
  days_overdue?: number;
}

@Injectable({ providedIn: 'root' })
export class VaccinesService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  listProtocols(species?: string): Observable<{ items: VaccineProtocol[] }> {
    let url = `${this.api}/vaccines/protocols`;
    if (species) url += `?species=${encodeURIComponent(species)}`;
    return this.http.get<{ items: VaccineProtocol[] }>(url);
  }

  listForSubject(subjectId: string): Observable<{ items: Vaccine[] }> {
    return this.http.get<{ items: Vaccine[] }>(`${this.api}/vaccines?subject_id=${encodeURIComponent(subjectId)}`);
  }

  upcoming(days = 30): Observable<{ items: VaccineUpcoming[]; days: number }> {
    return this.http.get<any>(`${this.api}/vaccines/upcoming?days=${days}`);
  }

  overdue(): Observable<{ items: VaccineUpcoming[] }> {
    return this.http.get<any>(`${this.api}/vaccines/overdue`);
  }

  create(payload: {
    subject_id: string;
    vaccine_name: string;
    applied_at: string;
    next_dose_date?: string | null;
    manufacturer?: string | null;
    lot_number?: string | null;
    protocol_id?: string | null;
    encounter_id?: string | null;
    notes?: string | null;
  }): Observable<Vaccine> {
    return this.http.post<Vaccine>(`${this.api}/vaccines`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api}/vaccines/${id}`);
  }
}
