export interface ChatSettings {
  tenant_id: string;
  visible_in_directory: boolean;
  notify_on_invite_email: boolean;
  notify_on_message_email: boolean;
  message_email_quiet_after_minutes: number;
  created_at?: string;
  updated_at?: string;
}

export interface DirectoryEntry {
  tenant_id: string;
  name: string;
  module: 'human' | 'veterinary';
  region_uf: string | null;
  region_city: string | null;
  specialties: string[];
  last_active_month: string | null;
}

export interface InterTenantInvitation {
  id: string;
  from_tenant_id: string;
  to_tenant_id: string;
  from_tenant_name: string;
  to_tenant_name: string;
  module: 'human' | 'veterinary';
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  message: string | null;
  sent_at: string;
  responded_at: string | null;
}

export interface InterTenantConversation {
  id: string;
  counterpart_tenant_id: string;
  counterpart_name: string;
  module: 'human' | 'veterinary';
  last_message_at: string | null;
  created_at: string;
  last_message_preview: string | null;
  unread_count: number;
  archived: boolean;
}

export interface InterTenantMessage {
  id: string;
  conversation_id: string;
  sender_tenant_id: string;
  sender_user_id: string;
  body: string;
  has_attachment: boolean;
  created_at: string;
}

export interface ChatSearchResult {
  id: string;
  sender_tenant_id: string;
  body: string;
  created_at: string;
  snippet: string;
}

export interface TenantBlock {
  blocker_tenant_id: string;
  blocked_tenant_id: string;
  blocked_tenant_name?: string;
  reason: string | null;
  created_at: string;
}
