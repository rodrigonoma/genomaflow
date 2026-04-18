// apps/web/src/app/features/chat/chat.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface ChatSource {
  type: 'interpretation' | 'alert' | 'recommendation' | 'patient_profile';
  source_label: string;
  chunk_excerpt: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
}

export interface ChatResponse {
  session_id: string;
  answer: string;
  sources: ChatSource[];
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/chat`;

  sendMessage(question: string, sessionId?: string): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(`${this.base}/message`, {
      question,
      session_id: sessionId
    });
  }

  clearSession(sessionId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/session/${sessionId}`);
  }
}
