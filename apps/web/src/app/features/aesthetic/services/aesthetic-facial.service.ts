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

  // -------------------------------------------------------------------------
  // V2 — aesthetic_sessions (wrapper para tier=advanced)
  // -------------------------------------------------------------------------

  /**
   * Cria um aesthetic_session wrapper. tier=advanced exige este ID
   * obrigatoriamente no payload de POST /aesthetic/analyses.
   */
  createSession(payload: {
    subject_id: string;
    session_type: 'facial_analysis' | 'body_analysis';
    notes?: string;
  }): Observable<{ id: string; session_date: string; session_type: string }> {
    return this.http.post<{ id: string; session_date: string; session_type: string }>(
      `${this.base}/sessions`,
      payload,
    );
  }

  /**
   * Upload de foto V2 com pose + landmarks JSON (MediaPipe).
   * Form data fields adicionais (todos opcionais, backward compat F1-F6):
   *   pose         — string da whitelist (frontal | profile_left | ...)
   *   landmarks    — JSON.stringify dos landmarks gerados no cliente
   *   session_id   — UUID da session wrapper
   */
  uploadPhotoV2(formData: FormData): Observable<AestheticPhoto & { pose?: string; session_id?: string }> {
    return this.http.post<AestheticPhoto & { pose?: string; session_id?: string }>(
      `${this.base}/photos`,
      formData,
    );
  }

  // -------------------------------------------------------------------------
  // V2 Fase 3 — depth model (Pseudo-3D)
  // -------------------------------------------------------------------------

  /**
   * POST /aesthetic/analyses/:id/depth — cria depth model + enfileira
   * worker (idempotente: depth existente em done/pending → retorna direto).
   */
  generateDepth(analysisId: string): Observable<DepthModelResponse> {
    return this.http.post<DepthModelResponse>(
      `${this.base}/analyses/${analysisId}/depth`,
      {},
    );
  }

  /** GET /aesthetic/analyses/:id/depth — polling fallback. */
  getDepth(analysisId: string): Observable<DepthModelResponse> {
    return this.http.get<DepthModelResponse>(
      `${this.base}/analyses/${analysisId}/depth`,
    );
  }

  // -------------------------------------------------------------------------
  // V2 Fase 4 — Compartilhamento relatório paciente + Timeline evolutiva
  // -------------------------------------------------------------------------

  /** POST /aesthetic/analyses/:id/share — envia por email e/ou WhatsApp. */
  shareAnalysis(
    analysisId: string,
    payload: ShareAnalysisPayload,
  ): Observable<ShareAnalysisResponse> {
    return this.http.post<ShareAnalysisResponse>(
      `${this.base}/analyses/${analysisId}/share`,
      payload,
    );
  }

  /** Download direto do PDF paciente — retorna blob pra anchor download. */
  exportPatientPdfBlob(analysisId: string): Observable<Blob> {
    return this.http.get(`${this.base}/analyses/${analysisId}/export-patient.pdf`, {
      responseType: 'blob',
    });
  }

  /** GET /aesthetic/subjects/:id/aesthetic-evolution — timeline temporal. */
  getEvolution(subjectId: string, limit?: number): Observable<EvolutionResponse> {
    let params = new HttpParams();
    if (limit) params = params.set('limit', String(limit));
    return this.http.get<EvolutionResponse>(
      `${this.base}/subjects/${subjectId}/aesthetic-evolution`,
      { params },
    );
  }
}

export interface ShareAnalysisPayload {
  channels: Array<'email' | 'whatsapp'>;
  recipient_email?: string;
  recipient_phone?: string;
  custom_message?: string;
}

export interface ShareChannelResult {
  sent: boolean;
  share_id: string;
  provider_id?: string;
  error?: string;
}

export interface ShareAnalysisResponse {
  email?: ShareChannelResult | null;
  whatsapp?: ShareChannelResult | null;
  share_ids: string[];
}

export interface EvolutionPoint {
  analysis_id: string;
  completed_at: string;
  tier: 'standard' | 'advanced';
  analysis_type: string;
  aggregate_scores: {
    skin_texture: number | null;
    spots: number | null;
    symmetry: number | null;
    wrinkles: number | null;
    dark_circles: number | null;
    acne: number | null;
  };
}

export interface EvolutionResponse {
  subject_id: string;
  points: EvolutionPoint[];
}

export interface DepthModelResponse {
  id: string;
  analysis_id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  model_type: 'heightmap' | 'multiview_fusion';
  depth_url?: string;
  glb_url?: string;
  texture_url?: string;
  metadata?: Record<string, unknown>;
  /** V2 Fase 3.2-A: URLs assinadas por pose (frontal/profile_L/R/45_L/R). */
  poses_depth_urls?: Record<string, string>;
  /** V2 Fase 3.2-A: textura (foto) por pose. */
  poses_texture_urls?: Record<string, string>;
  error_code?: string;
  error_message?: string;
  created_at?: string;
  completed_at?: string;
}
