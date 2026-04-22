import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface LegalDocument {
  type: string;
  version: string;
  title: string;
  pdf_url: string;
  content_hash: string;
}

export interface TermsStatus {
  all_accepted: boolean;
  pending: LegalDocument[];
}

@Injectable({ providedIn: 'root' })
export class TermsService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/terms`;

  getStatus(): Observable<TermsStatus> {
    return this.http.get<TermsStatus>(`${this.base}/status`);
  }

  getDocuments(): Observable<LegalDocument[]> {
    return this.http.get<LegalDocument[]>(`${this.base}/documents`);
  }

  accept(docs: LegalDocument[]): Observable<{ ok: boolean; accepted: number }> {
    const acceptances = docs.map(d => ({
      document_type: d.type,
      version: d.version,
      content_hash: d.content_hash,
    }));
    return this.http.post<{ ok: boolean; accepted: number }>(`${this.base}/accept`, { acceptances });
  }
}
