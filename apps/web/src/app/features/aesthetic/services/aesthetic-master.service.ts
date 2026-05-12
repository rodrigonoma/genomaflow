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

// ── AI Suggestion types ──────────────────────────────────────────────────────

export interface AestheticTreatmentSuggestion {
  id: string;
  name: string;
  category: string;
  indications: string[] | null;
  contraindications: string[] | null;
  typical_sessions: number | null;
  interval_days: number | null;
  cost_estimate_brl_min: number | null;
  cost_estimate_brl_max: number | null;
  evidence_level: string | null;
  description: string | null;
  protocol_notes: string | null;
  sources: string[] | null;
  status: 'pending_review' | 'approved' | 'rejected' | 'superseded';
  rejected_reason: string | null;
  reviewed_by: string | null;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  promoted_treatment_id: string | null;
  source_run_id: string;
  generation_model: string | null;
  generated_at: string;
}

export interface SuggestionRun {
  source_run_id: string;
  started_at: string;
  generation_model: string | null;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  superseded: number;
}

// ────────────────────────────────────────────────────────────────────────────

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

  // ── Treatment Suggestions ────────────────────────────────────────────────

  listSuggestions(
    opts: { status?: string; limit?: number; offset?: number } = {}
  ): Observable<{ items: AestheticTreatmentSuggestion[] }> {
    const params: Record<string, string> = {};
    if (opts.status) params['status'] = opts.status;
    if (opts.limit != null) params['limit'] = String(opts.limit);
    if (opts.offset != null) params['offset'] = String(opts.offset);
    return this.http.get<{ items: AestheticTreatmentSuggestion[] }>(
      `${this.base}/treatment-suggestions`, { params }
    );
  }

  listRuns(): Observable<{ items: SuggestionRun[] }> {
    return this.http.get<{ items: SuggestionRun[] }>(`${this.base}/treatment-suggestions/runs`);
  }

  approveSuggestion(
    id: string,
    overrides: Partial<TreatmentInput> = {}
  ): Observable<{ treatment: AestheticTreatment; suggestion_id: string }> {
    return this.http.post<{ treatment: AestheticTreatment; suggestion_id: string }>(
      `${this.base}/treatment-suggestions/${id}/approve`, overrides
    );
  }

  rejectSuggestion(
    id: string,
    reason: string
  ): Observable<{ id: string; status: string; rejected_reason: string }> {
    return this.http.post<{ id: string; status: string; rejected_reason: string }>(
      `${this.base}/treatment-suggestions/${id}/reject`, { reason }
    );
  }

  supersedeSuggestion(
    id: string,
    existingTreatmentId: string
  ): Observable<{ id: string; status: string; promoted_treatment_id: string }> {
    return this.http.post<{ id: string; status: string; promoted_treatment_id: string }>(
      `${this.base}/treatment-suggestions/${id}/supersede`, { existing_treatment_id: existingTreatmentId }
    );
  }
}
