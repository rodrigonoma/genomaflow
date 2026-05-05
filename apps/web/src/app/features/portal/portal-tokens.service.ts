import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface PortalToken {
  id: string;
  subject_id: string | null;
  owner_id: string | null;
  subject_name?: string | null;
  owner_name?: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  last_accessed_at: string | null;
  access_count: number;
  // Apenas no POST response — link completo pra copiar/enviar
  link?: string;
  token?: string;
}

@Injectable({ providedIn: 'root' })
export class PortalTokensService {
  private http = inject(HttpClient);
  private base = environment.apiUrl + '/portal';

  /** Gera novo token. Body precisa de subject_id OU owner_id (XOR). */
  create(body: { subject_id?: string; owner_id?: string }): Observable<PortalToken> {
    return this.http.post<PortalToken>(`${this.base}/tokens`, body);
  }

  /** Lista tokens do tenant (200 últimos). */
  list(): Observable<{ items: PortalToken[] }> {
    return this.http.get<{ items: PortalToken[] }>(`${this.base}/tokens`);
  }

  /** Revoga (soft-delete via revoked_at). */
  revoke(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/tokens/${id}`);
  }
}
