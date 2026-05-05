import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface NpsResponseRow {
  id: string;
  subject_id: string;
  encounter_id: string | null;
  score: number | null;
  feedback: string | null;
  responded_at: string | null;
  sent_at: string;
  sent_via: 'email' | 'whatsapp' | 'manual';
  subject_name: string | null;
}

export interface NpsStats {
  total_sent: number;
  total_responded: number;
  nps_score: number | null;
  promoters: number;
  passives: number;
  detractors: number;
}

export interface NpsResponsesPayload {
  items: NpsResponseRow[];
  stats: NpsStats;
  period_days: number;
}

@Injectable({ providedIn: 'root' })
export class NpsService {
  private http = inject(HttpClient);
  private base = environment.apiUrl + '/nps';

  /** Lista respostas do tenant + stats agregadas. period em dias (1-365). */
  list(period: number = 90): Observable<NpsResponsesPayload> {
    return this.http.get<NpsResponsesPayload>(`${this.base}/responses?period=${period}`);
  }

  /** Reenvia pesquisa pra paciente — cria novo token. */
  send(body: {
    subject_id: string;
    sent_to: string;
    sent_via?: 'email' | 'whatsapp' | 'manual';
    encounter_id?: string;
    appointment_id?: string;
  }): Observable<{ id: string; token: string }> {
    return this.http.post<{ id: string; token: string }>(`${this.base}/send`, body);
  }
}
