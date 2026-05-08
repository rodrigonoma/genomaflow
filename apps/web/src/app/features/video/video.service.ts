import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';


export interface CreateConsultationBody {
  appointment_id: string;
  modality: 'simple' | 'complete';
}

export interface CreateConsultationResponse {
  consultation_id: string;
  join_url: string;
  meeting: { MeetingId: string; MediaPlacement: Record<string, string> };
  doctor_attendee: Record<string, string>;
  modality: string;
  credits_needed: number;
}

export interface ConsultationTokens {
  meeting: { MeetingId: string; MediaPlacement: Record<string, string> };
  doctor_attendee: Record<string, string>;
  patient_attendee: Record<string, string>;
  join_url: string;
  status: string;
}

export interface PublicJoinInfo {
  consultation_id: string;
  status: string;
  meeting: { MeetingId: string; MediaPlacement: Record<string, string> };
  patient_attendee: Record<string, string>;
  clinic_name: string;
  doctor_name: string;
  start_at: string;
  duration_minutes: number;
}

export interface ConsultationFile {
  id: string;
  uploaded_by: 'doctor' | 'patient';
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class VideoService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/video`;

  create(body: CreateConsultationBody): Observable<CreateConsultationResponse> {
    return this.http.post<CreateConsultationResponse>(`${this.base}/consultations`, body);
  }

  getTokens(consultationId: string): Observable<ConsultationTokens> {
    return this.http.get<ConsultationTokens>(`${this.base}/consultations/${consultationId}/tokens`);
  }

  getStatus(consultationId: string): Observable<{ status: string; encounter_id?: string; ai_extraction?: Record<string, unknown> }> {
    return this.http.get<any>(`${this.base}/consultations/${consultationId}`);
  }

  getPublicJoinInfo(token: string): Observable<PublicJoinInfo> {
    return this.http.get<PublicJoinInfo>(`${this.base}/join/${token}`);
  }

  startConsultation(consultationId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/consultations/${consultationId}/start`, {});
  }

  endConsultation(consultationId: string, recordingS3Key?: string): Observable<{ ok: boolean; duration_seconds: number; credits_debited: number; status: string }> {
    return this.http.post<any>(`${this.base}/consultations/${consultationId}/end`, {
      recording_s3_key: recordingS3Key ?? undefined,
    });
  }

  getUploadUrl(consultationId: string, filename: string, mimeType: string, joinToken?: string): Observable<{ upload_url: string; s3_key: string }> {
    const params = joinToken ? `?join_token=${joinToken}` : '';
    return this.http.post<any>(`${this.base}/consultations/${consultationId}/files/upload-url${params}`, {
      filename, mime_type: mimeType,
    });
  }

  notifyFileUploaded(consultationId: string, s3Key: string, filename: string, mimeType: string, sizeBytes: number, joinToken?: string): Observable<{ ok: boolean; file_id: string }> {
    const params = joinToken ? `?join_token=${joinToken}` : '';
    return this.http.post<any>(`${this.base}/consultations/${consultationId}/files/notify${params}`, {
      s3_key: s3Key, filename, mime_type: mimeType, size_bytes: sizeBytes,
    });
  }

  getFiles(consultationId: string): Observable<ConsultationFile[]> {
    return this.http.get<ConsultationFile[]>(`${this.base}/consultations/${consultationId}/files`);
  }
}
