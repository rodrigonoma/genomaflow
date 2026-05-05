import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type DocType = 'atestado' | 'pedido_exame' | 'encaminhamento' | 'relatorio' | 'termo_consentimento';

export interface ClinicalDocumentTemplate {
  id: string;
  doc_type: DocType;
  name: string;
  body: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClinicalDocument {
  id: string;
  doc_type: DocType;
  title: string;
  body?: string;
  encounter_id: string | null;
  template_id: string | null;
  pdf_s3_key: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
  professional_user_id: string | null;
  professional_email?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ClinicalDocumentsService {
  private http = inject(HttpClient);
  private base = environment.apiUrl + '/clinical-documents';

  // ── Templates ─────────────────────────────────────────────────────────
  listTemplates(doc_type?: DocType): Observable<{ items: ClinicalDocumentTemplate[] }> {
    const q = doc_type ? `?doc_type=${doc_type}` : '';
    return this.http.get<{ items: ClinicalDocumentTemplate[] }>(`${this.base}/templates${q}`);
  }
  createTemplate(body: { doc_type: DocType; name: string; body: string }): Observable<ClinicalDocumentTemplate> {
    return this.http.post<ClinicalDocumentTemplate>(`${this.base}/templates`, body);
  }
  updateTemplate(id: string, body: Partial<{ doc_type: DocType; name: string; body: string; active: boolean }>): Observable<ClinicalDocumentTemplate> {
    return this.http.put<ClinicalDocumentTemplate>(`${this.base}/templates/${id}`, body);
  }
  deleteTemplate(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/templates/${id}`);
  }

  // ── Documents ─────────────────────────────────────────────────────────
  listDocuments(subject_id: string, doc_type?: DocType): Observable<{ items: ClinicalDocument[] }> {
    let url = `${this.base}?subject_id=${encodeURIComponent(subject_id)}`;
    if (doc_type) url += `&doc_type=${doc_type}`;
    return this.http.get<{ items: ClinicalDocument[] }>(url);
  }
  getDocument(id: string): Observable<ClinicalDocument> {
    return this.http.get<ClinicalDocument>(`${this.base}/${id}`);
  }
  createDocument(body: {
    subject_id: string;
    doc_type: DocType;
    title: string;
    body: string;
    template_id?: string;
    encounter_id?: string;
  }): Observable<ClinicalDocument> {
    return this.http.post<ClinicalDocument>(this.base, body);
  }
  updateDocument(id: string, body: Partial<{ doc_type: DocType; title: string; body: string }>): Observable<ClinicalDocument> {
    return this.http.patch<ClinicalDocument>(`${this.base}/${id}`, body);
  }
  signDocument(id: string): Observable<ClinicalDocument> {
    return this.http.post<ClinicalDocument>(`${this.base}/${id}/sign`, {});
  }
  uploadPdfKey(id: string, s3_key: string): Observable<{ id: string; pdf_s3_key: string }> {
    return this.http.post<{ id: string; pdf_s3_key: string }>(`${this.base}/${id}/upload-pdf`, { s3_key });
  }
}

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  atestado: 'Atestado',
  pedido_exame: 'Pedido de exame',
  encaminhamento: 'Encaminhamento',
  relatorio: 'Relatório',
  termo_consentimento: 'Termo de consentimento',
};

export const DOC_TYPE_ICONS: Record<DocType, string> = {
  atestado: 'description',
  pedido_exame: 'biotech',
  encaminhamento: 'forward_to_inbox',
  relatorio: 'article',
  termo_consentimento: 'verified_user',
};
