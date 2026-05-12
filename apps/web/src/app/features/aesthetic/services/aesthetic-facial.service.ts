import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  AestheticConsent,
  CreateConsentPayload,
  AestheticPhoto,
  PhotoUrlResponse,
  AestheticAnalysisDetail,
  AestheticAnalysisListItem,
  CreateAnalysisPayload,
  ListAnalysesResponse,
  CompareResult,
  AnalysisType,
} from '../models/analysis.model';

@Injectable({ providedIn: 'root' })
export class AestheticFacialService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/aesthetic`;

  // -------------------------------------------------------------------------
  // Consent
  // -------------------------------------------------------------------------

  getConsent(subjectId: string): Observable<AestheticConsent> {
    return this.http.get<AestheticConsent>(`${this.base}/consent/${subjectId}`);
  }

  createConsent(payload: CreateConsentPayload): Observable<AestheticConsent> {
    return this.http.post<AestheticConsent>(`${this.base}/consent`, payload);
  }

  // -------------------------------------------------------------------------
  // Photos
  // -------------------------------------------------------------------------

  uploadPhoto(formData: FormData): Observable<AestheticPhoto> {
    return this.http.post<AestheticPhoto>(`${this.base}/photos`, formData);
  }

  /**
   * Chama POST /aesthetic/photos/preview-blur.
   * Retorna a resposta completa (headers + blob) para que o chamador
   * possa ler X-Auto-Crop-Applied e X-Auto-Crop-Regions.
   * NÃO persiste nada no banco nem no S3.
   */
  previewBlur(file: File, subjectId: string): Observable<HttpResponse<Blob>> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('subject_id', subjectId);
    return this.http.post(`${this.base}/photos/preview-blur`, fd, {
      observe: 'response',
      responseType: 'blob',
    });
  }

  getPhotoUrl(photoId: string): Observable<PhotoUrlResponse> {
    return this.http.get<PhotoUrlResponse>(`${this.base}/photos/${photoId}/url`);
  }

  deletePhoto(photoId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/photos/${photoId}`);
  }

  // -------------------------------------------------------------------------
  // Analyses
  // -------------------------------------------------------------------------

  createAnalysis(payload: CreateAnalysisPayload): Observable<AestheticAnalysisDetail> {
    return this.http.post<AestheticAnalysisDetail>(`${this.base}/analyses`, payload);
  }

  listAnalyses(
    subjectId: string,
    type?: AnalysisType,
    limit?: number,
    offset?: number,
  ): Observable<ListAnalysesResponse> {
    let params = new HttpParams().set('subject_id', subjectId);
    if (type !== undefined) params = params.set('type', type);
    if (limit !== undefined) params = params.set('limit', String(limit));
    if (offset !== undefined) params = params.set('offset', String(offset));
    return this.http.get<ListAnalysesResponse>(`${this.base}/analyses`, { params });
  }

  getAnalysis(id: string): Observable<AestheticAnalysisDetail> {
    return this.http.get<AestheticAnalysisDetail>(`${this.base}/analyses/${id}`);
  }

  deleteAnalysis(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/analyses/${id}`);
  }

  compareAnalyses(currentId: string, baselineId: string): Observable<CompareResult> {
    return this.http.post<CompareResult>(`${this.base}/analyses/${currentId}/compare`, {
      baseline_id: baselineId,
    });
  }
}
