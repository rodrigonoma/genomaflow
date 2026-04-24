import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ChatSettings, DirectoryEntry, InterTenantInvitation,
  InterTenantConversation, InterTenantMessage, ChatSearchResult, TenantBlock
} from '../../shared/models/chat.models';

interface Page<T> { results: T[]; page?: number; page_size?: number; }

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/inter-tenant-chat`;

  getSettings(): Observable<ChatSettings> { return this.http.get<ChatSettings>(`${this.base}/settings`); }
  updateSettings(patch: Partial<ChatSettings>): Observable<ChatSettings> {
    return this.http.put<ChatSettings>(`${this.base}/settings`, patch);
  }

  searchDirectory(opts: { uf?: string; specialty?: string; q?: string; page?: number; page_size?: number } = {}): Observable<Page<DirectoryEntry>> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(opts)) if (v != null && v !== '') params = params.set(k, String(v));
    return this.http.get<Page<DirectoryEntry>>(`${this.base}/directory`, { params });
  }

  listInvitations(direction: 'incoming' | 'outgoing' = 'incoming'): Observable<Page<InterTenantInvitation>> {
    return this.http.get<Page<InterTenantInvitation>>(`${this.base}/invitations`, { params: { direction } });
  }
  sendInvitation(to_tenant_id: string, message?: string): Observable<InterTenantInvitation> {
    return this.http.post<InterTenantInvitation>(`${this.base}/invitations`, { to_tenant_id, message });
  }
  acceptInvitation(id: string): Observable<{ invitation_id: string; conversation_id: string }> {
    return this.http.post<{ invitation_id: string; conversation_id: string }>(`${this.base}/invitations/${id}/accept`, {});
  }
  rejectInvitation(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/invitations/${id}/reject`, {});
  }
  cancelInvitation(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/invitations/${id}`);
  }

  listConversations(): Observable<Page<InterTenantConversation>> {
    return this.http.get<Page<InterTenantConversation>>(`${this.base}/conversations`);
  }
  getConversation(id: string): Observable<InterTenantConversation> {
    return this.http.get<InterTenantConversation>(`${this.base}/conversations/${id}`);
  }
  archiveConversation(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/conversations/${id}/archive`, {});
  }
  unarchiveConversation(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/conversations/${id}/unarchive`, {});
  }
  deleteConversation(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/conversations/${id}`);
  }

  listMessages(conversationId: string, opts: { before?: string; limit?: number } = {}): Observable<Page<InterTenantMessage>> {
    let params = new HttpParams();
    if (opts.before) params = params.set('before', opts.before);
    if (opts.limit)  params = params.set('limit',  String(opts.limit));
    return this.http.get<Page<InterTenantMessage>>(`${this.base}/conversations/${conversationId}/messages`, { params });
  }
  sendMessage(
    conversationId: string,
    payload: {
      body?: string;
      ai_analysis_card?: { exam_id: string; agent_types: string[] };
      pdf?: { filename: string; data_base64: string; mime_type: string };
      image?: { filename: string; data_base64: string; mime_type: string; user_confirmed_anonymized: true };
    }
  ): Observable<InterTenantMessage> {
    return this.http.post<InterTenantMessage>(`${this.base}/conversations/${conversationId}/messages`, payload);
  }

  getAttachmentSignedUrl(attachmentId: string): Observable<{ url: string; expires_in: number }> {
    return this.http.get<{ url: string; expires_in: number }>(`${this.base}/attachments/${attachmentId}/url`);
  }

  toggleReaction(messageId: string, emoji: string): Observable<{ action: 'added' | 'removed'; emoji: string; count: number }> {
    return this.http.post<{ action: 'added' | 'removed'; emoji: string; count: number }>(
      `${this.base}/messages/${messageId}/reactions`, { emoji }
    );
  }

  reportTenant(reported_tenant_id: string, reason: string, related_message_id?: string): Observable<{ id: string; status: string }> {
    return this.http.post<{ id: string; status: string }>(`${this.base}/reports`, {
      reported_tenant_id, reason, related_message_id
    });
  }
  searchMessages(conversationId: string, q: string): Observable<Page<ChatSearchResult>> {
    return this.http.get<Page<ChatSearchResult>>(`${this.base}/conversations/${conversationId}/search`, { params: { q } });
  }
  markRead(conversationId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/conversations/${conversationId}/read`, {});
  }

  listBlocks(): Observable<Page<TenantBlock>> { return this.http.get<Page<TenantBlock>>(`${this.base}/blocks`); }
  blockTenant(blocked_tenant_id: string, reason?: string): Observable<void> {
    return this.http.post<void>(`${this.base}/blocks`, { blocked_tenant_id, reason });
  }
  unblockTenant(tenantId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/blocks/${tenantId}`);
  }
}
