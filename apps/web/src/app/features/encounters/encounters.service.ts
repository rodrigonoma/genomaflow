import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface VitalSigns {
  weight_kg?: number | null;
  temperature_c?: number | null;
  heart_rate_bpm?: number | null;
  respiratory_rate_rpm?: number | null;
  pain_score?: number | null;
  // human only
  blood_pressure_systolic?: number | null;
  blood_pressure_diastolic?: number | null;
  // vet only
  hydration?: 'normal' | 'leve' | 'moderada' | 'severa' | null;
  mucosa?: 'normocoradas' | 'hipocoradas' | 'cianoticas' | 'ictericas' | 'congestas' | null;
  notes?: string | null;
}

export interface ClinicalEncounter {
  id: string;
  tenant_id: string;
  subject_id: string;
  professional_user_id: string;
  professional_email?: string;
  appointment_id: string | null;
  encounter_type: 'consulta' | 'retorno' | 'evolucao' | 'procedimento' | 'telemedicina' | 'outro';
  chief_complaint: string | null;
  anamnesis: string | null;
  physical_exam: string | null;
  hypothesis: string | null;
  conduct: string | null;
  return_recommendation: string | null;
  // human only
  medical_history?: string | null;
  medications_in_use?: string | null;
  allergies?: string | null;
  // estetica only
  related_aesthetic_analysis_id?: string | null;
  attachments: any[];
  source?: 'manual' | 'video_ai' | null;
  signed_at: string | null;
  signed_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  // joined vital signs (when present)
  weight_kg?: number;
  temperature_c?: number;
  heart_rate_bpm?: number;
  respiratory_rate_rpm?: number;
  pain_score?: number;
  blood_pressure_systolic?: number;
  blood_pressure_diastolic?: number;
  hydration?: string;
  mucosa?: string;
  vs_notes?: string;
}

export interface EncounterCreatePayload {
  subject_id: string;
  appointment_id?: string | null;
  encounter_type?: ClinicalEncounter['encounter_type'];
  chief_complaint?: string | null;
  anamnesis?: string | null;
  physical_exam?: string | null;
  hypothesis?: string | null;
  conduct?: string | null;
  return_recommendation?: string | null;
  medical_history?: string | null;
  medications_in_use?: string | null;
  allergies?: string | null;
  // estetica only — vínculo com análise estética (F6)
  related_aesthetic_analysis_id?: string | null;
  attachments?: any[];
  vital_signs?: VitalSigns;
}

export interface EncountersListResponse {
  items: ClinicalEncounter[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface TimelineEvent {
  event_type: 'encounter' | 'exam' | 'prescription' | 'ai_analysis';
  event_id: string;
  event_at: string;
  payload: any;
}

export interface TimelineResponse {
  items: TimelineEvent[];
  next_cursor: string | null;
  has_more: boolean;
}

@Injectable({ providedIn: 'root' })
export class EncountersService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  list(subjectId: string, cursor: string | null = null, limit = 50): Observable<EncountersListResponse> {
    let url = `${this.api}/encounters?subject_id=${encodeURIComponent(subjectId)}&limit=${limit}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    return this.http.get<EncountersListResponse>(url);
  }

  get(id: string): Observable<ClinicalEncounter> {
    return this.http.get<ClinicalEncounter>(`${this.api}/encounters/${id}`);
  }

  create(payload: EncounterCreatePayload): Observable<ClinicalEncounter> {
    return this.http.post<ClinicalEncounter>(`${this.api}/encounters`, payload);
  }

  update(id: string, payload: Partial<EncounterCreatePayload>): Observable<ClinicalEncounter> {
    return this.http.patch<ClinicalEncounter>(`${this.api}/encounters/${id}`, payload);
  }

  sign(id: string): Observable<ClinicalEncounter> {
    return this.http.post<ClinicalEncounter>(`${this.api}/encounters/${id}/sign`, {});
  }

  timeline(subjectId: string, cursor: string | null = null, limit = 50): Observable<TimelineResponse> {
    let url = `${this.api}/patients/${subjectId}/timeline?limit=${limit}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    return this.http.get<TimelineResponse>(url);
  }

  /** Co-piloto IA: analisa rascunho e sugere hipóteses + exames + red flags. */
  copilot(payload: CopilotRequest): Observable<CopilotResponse> {
    return this.http.post<CopilotResponse>(`${this.api}/encounters/copilot`, payload);
  }
}

// ── Co-piloto types (4.4) ────────────────────────────────────────────────
export interface CopilotRequest {
  subject_id: string;
  chief_complaint?: string | null;
  anamnesis?: string | null;
  physical_exam?: string | null;
  hypothesis?: string | null;
  vital_signs?: VitalSigns | null;
}

export interface CopilotHypothesis {
  name: string;
  icd10: string | null;
  prob_score: number;
  rationale: string;
}

export interface CopilotExam {
  name: string;
  type: 'lab' | 'imaging' | 'other';
  priority: 'high' | 'medium' | 'low';
  indication: string;
}

export interface CopilotRedFlag {
  signal: string;
  urgency: 'imediata' | 'hoje' | 'esta_semana';
  recommendation: string;
}

export interface CopilotResponse {
  hypotheses: CopilotHypothesis[];
  recommended_exams: CopilotExam[];
  red_flags: CopilotRedFlag[];
  needs_more_info: string[];
  model_version: string;
}
