-- Migration 047: Chat entre tenants V1 — schema base
-- Cria 10 tabelas novas (zero ALTER em tabelas existentes), índices, extensão pg_trgm.
-- RLS policies e triggers serão adicionados a este mesmo arquivo nas tasks 2-5 da fase 1.
--
-- Spec: docs/superpowers/specs/2026-04-23-inter-tenant-chat-design.md

-- Política de FK ON DELETE: padrão (RESTRICT) preserva auditoria. Se
-- precisar deletar tenant/user no futuro, criar fluxo explícito de purge
-- antes da exclusão (não cascade silencioso).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 5.1 Configurações de chat por tenant
CREATE TABLE IF NOT EXISTS tenant_chat_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  visible_in_directory BOOLEAN NOT NULL DEFAULT false,
  notify_on_invite_email BOOLEAN NOT NULL DEFAULT true,
  notify_on_message_email BOOLEAN NOT NULL DEFAULT false,
  message_email_quiet_after_minutes INT NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5.2 Diretório (tabela física derivada via trigger)
CREATE TABLE IF NOT EXISTS tenant_directory_listing (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  module TEXT NOT NULL CHECK (module IN ('human', 'veterinary')),
  region_uf CHAR(2),
  region_city TEXT,
  specialties TEXT[] NOT NULL DEFAULT '{}',
  last_active_month DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_directory_module_uf_idx
  ON tenant_directory_listing(module, region_uf);
CREATE INDEX IF NOT EXISTS tenant_directory_specialties_gin
  ON tenant_directory_listing USING GIN (specialties);
CREATE INDEX IF NOT EXISTS tenant_directory_name_trgm
  ON tenant_directory_listing USING GIN (name gin_trgm_ops);

-- 5.3 Convites tenant→tenant
CREATE TABLE IF NOT EXISTS tenant_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  to_tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('human', 'veterinary')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  message TEXT,
  sent_by_user_id UUID NOT NULL REFERENCES users(id),
  responded_by_user_id UUID REFERENCES users(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CHECK (from_tenant_id <> to_tenant_id)
);

CREATE INDEX IF NOT EXISTS tenant_invitations_to_status_idx
  ON tenant_invitations(to_tenant_id, status);
CREATE INDEX IF NOT EXISTS tenant_invitations_from_status_idx
  ON tenant_invitations(from_tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_invitations_pending_unique
  ON tenant_invitations(from_tenant_id, to_tenant_id) WHERE status = 'pending';

-- 5.4 Bloqueios bilaterais
CREATE TABLE IF NOT EXISTS tenant_blocks (
  blocker_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  blocked_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_tenant_id, blocked_tenant_id),
  CHECK (blocker_tenant_id <> blocked_tenant_id)
);

-- 5.5 Conversas (par canônico tenant_a < tenant_b)
CREATE TABLE IF NOT EXISTS tenant_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_a_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_b_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('human', 'veterinary')),
  created_from_invitation_id UUID REFERENCES tenant_invitations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  archived_by_a BOOLEAN NOT NULL DEFAULT false,
  archived_by_b BOOLEAN NOT NULL DEFAULT false,
  CHECK (tenant_a_id < tenant_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_conversations_pair_idx
  ON tenant_conversations(tenant_a_id, tenant_b_id);
CREATE INDEX IF NOT EXISTS tenant_conversations_lookup_a_idx
  ON tenant_conversations(tenant_a_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS tenant_conversations_lookup_b_idx
  ON tenant_conversations(tenant_b_id, last_message_at DESC);

-- 5.6 Mensagens (com tsvector full-text)
CREATE TABLE IF NOT EXISTS tenant_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES tenant_conversations(id) ON DELETE CASCADE,
  sender_tenant_id UUID NOT NULL REFERENCES tenants(id),
  sender_user_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL DEFAULT '',
  body_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('portuguese', body)) STORED,
  has_attachment BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_messages_conv_created_idx
  ON tenant_messages(conversation_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_messages_search_gin
  ON tenant_messages USING GIN (body_tsv);

DO $$ BEGIN
  ALTER TABLE tenant_messages
    ADD CONSTRAINT tenant_messages_body_or_attachment
    CHECK (body <> '' OR has_attachment = true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 5.7 Anexos
CREATE TABLE IF NOT EXISTS tenant_message_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES tenant_messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ai_analysis_card', 'pdf', 'image')),
  s3_key TEXT,
  payload JSONB,
  original_size_bytes BIGINT,
  redacted_regions_count INT NOT NULL DEFAULT 0,
  original_hash TEXT,
  redacted_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_attachments_message_idx
  ON tenant_message_attachments(message_id);

DO $$ BEGIN
  ALTER TABLE tenant_message_attachments
    ADD CONSTRAINT tenant_attachments_kind_payload_check
    CHECK (
      (kind = 'ai_analysis_card' AND payload IS NOT NULL AND s3_key IS NULL)
      OR
      (kind IN ('pdf', 'image') AND s3_key IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 5.8 Audit do filtro PII
CREATE TABLE IF NOT EXISTS tenant_message_pii_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attachment_id UUID NOT NULL REFERENCES tenant_message_attachments(id) ON DELETE CASCADE,
  detected_kinds TEXT[] NOT NULL DEFAULT '{}',
  region_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('clean', 'auto_redacted_confirmed', 'cancelled_by_user')),
  confirmed_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5.9 Reações (curadas — whitelist no app)
CREATE TABLE IF NOT EXISTS tenant_message_reactions (
  message_id UUID NOT NULL REFERENCES tenant_messages(id) ON DELETE CASCADE,
  reactor_tenant_id UUID NOT NULL REFERENCES tenants(id),
  reactor_user_id UUID NOT NULL REFERENCES users(id),
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, reactor_user_id, emoji)
);

CREATE INDEX IF NOT EXISTS tenant_message_reactions_msg_idx
  ON tenant_message_reactions(message_id);

-- 5.10 Last-read por tenant para badge de unread
CREATE TABLE IF NOT EXISTS tenant_conversation_reads (
  conversation_id UUID NOT NULL REFERENCES tenant_conversations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  last_read_message_id UUID REFERENCES tenant_messages(id),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS tenant_conversation_reads_tenant_idx
  ON tenant_conversation_reads(tenant_id);

CREATE INDEX IF NOT EXISTS tenant_message_pii_checks_attachment_idx
  ON tenant_message_pii_checks(attachment_id);

-- GRANTs ao runtime user (genomaflow_app é o owner das queries da API/worker)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenant_chat_settings,
  tenant_directory_listing,
  tenant_invitations,
  tenant_blocks,
  tenant_conversations,
  tenant_messages,
  tenant_message_attachments,
  tenant_message_pii_checks,
  tenant_message_reactions,
  tenant_conversation_reads
TO genomaflow_app;
