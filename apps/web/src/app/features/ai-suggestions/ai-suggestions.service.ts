import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AiSuggestion {
  id: string;
  title: string;
  rationale: string;
  suggested_action: string | null;
  priority: 'high' | 'medium' | 'low';
  source_guideline: string | null;
}

export interface AiSuggestionsCache {
  id: string;
  tenant_id: string;
  subject_id: string;
  suggestions: AiSuggestion[];
  model_version: string;
  generated_at: string;
  expires_at: string;
  dismissed_ids: string[];
  generated_by: string | null;
}

export interface AiSuggestionsResponse {
  cached: AiSuggestionsCache | null;
  expired?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AiSuggestionsService {
  private http = inject(HttpClient);
  private base(subjectId: string) {
    return `${environment.apiUrl}/patients/${subjectId}/ai-suggestions`;
  }

  /** Retorna cache atual (ou null se nunca gerado). expired=true se TTL passou. */
  get(subjectId: string): Observable<AiSuggestionsResponse> {
    return this.http.get<AiSuggestionsResponse>(this.base(subjectId));
  }

  /** Regenera sugestões via LLM. Custosa — usar com confirmação do usuário. */
  refresh(subjectId: string): Observable<AiSuggestionsCache> {
    return this.http.post<AiSuggestionsCache>(`${this.base(subjectId)}/refresh`, {});
  }

  /** Marca uma sugestão como descartada (não mostrar mais). */
  dismiss(subjectId: string, suggestionId: string): Observable<AiSuggestionsCache> {
    return this.http.post<AiSuggestionsCache>(`${this.base(subjectId)}/dismiss`, { suggestion_id: suggestionId });
  }
}
