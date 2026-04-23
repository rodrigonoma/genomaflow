import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ProfessionalStatus {
  confirmed: boolean;
  crm_number?: string | null;
  crm_uf?: string | null;
  confirmed_at?: string | null;
}

export interface ProfessionalInfoPayload {
  crm_number: string;
  crm_uf: string;
  truthfulness_confirmed: boolean;
}

@Injectable({ providedIn: 'root' })
export class ProfessionalService {
  private http = inject(HttpClient);
  private authBase = `${environment.apiUrl}/auth`;

  getStatus(): Observable<ProfessionalStatus> {
    return this.http.get<any>(`${this.authBase}/me`).pipe(
      map(me => ({
        confirmed: !!me.professional_data_confirmed_at,
        crm_number: me.crm_number ?? null,
        crm_uf: me.crm_uf ?? null,
        confirmed_at: me.professional_data_confirmed_at ?? null,
      }))
    );
  }

  submit(payload: ProfessionalInfoPayload): Observable<unknown> {
    return this.http.post(`${this.authBase}/professional-info`, payload);
  }
}
