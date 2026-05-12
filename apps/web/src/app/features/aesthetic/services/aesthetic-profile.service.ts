import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface AestheticProfile {
  height_cm?: number;
  weight_kg?: number;
  age?: number;
  sex?: 'F' | 'M';
  activity_level?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  goals?: string[];
  allergies?: string[];
  medical_conditions?: string[];
  dietary_restrictions?: string[];
  updated_at?: string;
}

export interface ComputedNutrition {
  tmb: number;
  calories: number;
  macros: { protein_g: number; carbs_g: number; fat_g: number };
}

export interface ProfileResponse {
  profile: AestheticProfile;
  computed: ComputedNutrition | null;
}

export interface ProfileHistoryEntry {
  id: string;
  action: 'insert' | 'update' | 'delete';
  actor_user_id: string | null;
  actor_channel: string | null;
  actor_email: string | null;
  changed_fields: string[] | null;
  created_at: string;
  aesthetic_profile_before: AestheticProfile | null;
  aesthetic_profile_after: AestheticProfile | null;
}

export const ACTIVITY_LEVELS = [
  { value: 'sedentary', label: 'Sedentário (< 1h/sem)' },
  { value: 'light', label: 'Leve (1-3h/sem)' },
  { value: 'moderate', label: 'Moderado (3-5h/sem)' },
  { value: 'active', label: 'Ativo (6-7h/sem)' },
  { value: 'very_active', label: 'Muito ativo (>7h/sem)' },
] as const;

export const GOAL_OPTIONS = [
  { value: 'fat_loss', label: 'Perda de gordura' },
  { value: 'tone', label: 'Tonificação' },
  { value: 'wellness', label: 'Bem-estar / manutenção' },
  { value: 'mass', label: 'Ganho de massa' },
] as const;

export const DIETARY_OPTIONS = [
  { value: 'vegetarian', label: 'Vegetariano' },
  { value: 'vegan', label: 'Vegano' },
  { value: 'lactose', label: 'Intolerância à lactose' },
  { value: 'gluten', label: 'Sem glúten' },
  { value: 'low_carb', label: 'Low carb' },
  { value: 'low_sodium', label: 'Baixo sódio' },
  { value: 'diabetic_friendly', label: 'Diabético' },
  { value: 'none', label: 'Sem restrição' },
] as const;

@Injectable({ providedIn: 'root' })
export class AestheticProfileService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/aesthetic/profile`;

  get(subjectId: string): Observable<ProfileResponse> {
    return this.http.get<ProfileResponse>(`${this.base}/${subjectId}`);
  }

  update(subjectId: string, profile: AestheticProfile): Observable<ProfileResponse> {
    return this.http.put<ProfileResponse>(`${this.base}/${subjectId}`, profile);
  }

  history(subjectId: string, limit = 20): Observable<{ items: ProfileHistoryEntry[] }> {
    return this.http.get<{ items: ProfileHistoryEntry[] }>(
      `${this.base}/${subjectId}/history`,
      { params: { limit: String(limit) } }
    );
  }
}
