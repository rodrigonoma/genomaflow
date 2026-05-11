import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface AestheticTreatment {
  id: string;
  tenant_id: string | null;
  name: string;
  category: string;
  indications: string[];
  contraindications: string[];
  typical_sessions: number | null;
  interval_days: number | null;
  cost_estimate_brl_min: number | null;
  cost_estimate_brl_max: number | null;
  evidence_level: 'A' | 'B' | 'C' | 'D' | null;
  description: string | null;
  protocol_notes: string | null;
  requires_medico: boolean;
  is_active: boolean;
  usage_count_30d: number;
  created_at: string;
  updated_at: string;
}

export type TreatmentInput = Partial<Omit<AestheticTreatment, 'id' | 'tenant_id' | 'created_at' | 'updated_at' | 'usage_count_30d' | 'is_active'>>;

export const TREATMENT_CATEGORIES = [
  'corpo_modelagem',
  'corpo_flacidez',
  'facial_rejuvenescimento',
  'facial_pigmentacao',
  'facial_acne',
  'facial_preenchimento',
  'facial_toxina',
  'cabelo',
  'procedimento_cirurgico',
  'wellness_drenagem',
  'outro',
] as const;

export type TreatmentCategory = typeof TREATMENT_CATEGORIES[number];

@Injectable({ providedIn: 'root' })
export class AestheticMasterService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/master`;

  list(opts: { category?: string; active?: 'true' | 'false' | 'all' } = {}): Observable<{ items: AestheticTreatment[] }> {
    const params: Record<string, string> = {};
    if (opts.category) params['category'] = opts.category;
    if (opts.active) params['active'] = opts.active;
    return this.http.get<{ items: AestheticTreatment[] }>(`${this.base}/aesthetic-treatments`, { params });
  }

  create(body: TreatmentInput): Observable<AestheticTreatment> {
    return this.http.post<AestheticTreatment>(`${this.base}/aesthetic-treatments`, body);
  }

  update(id: string, body: TreatmentInput): Observable<AestheticTreatment> {
    return this.http.put<AestheticTreatment>(`${this.base}/aesthetic-treatments/${id}`, body);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/aesthetic-treatments/${id}`);
  }
}
