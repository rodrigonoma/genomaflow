-- 058_master_broadcasts.sql
-- Master Broadcasts: canal "Administrador do GenomaFlow" → tenants.
-- Reaproveita tenant_conversations/tenant_messages com kind='master_broadcast'.
-- Idempotente. Spec: docs/superpowers/specs/2026-04-27-master-broadcasts-design.md

-- 1. Coluna kind em tenant_conversations (default preserva comportamento atual)
ALTER TABLE tenant_conversations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'tenant_to_tenant';

DO $$ BEGIN
  ALTER TABLE tenant_conversations
    ADD CONSTRAINT tenant_conversations_kind_check
    CHECK (kind IN ('tenant_to_tenant', 'master_broadcast'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS tenant_conversations_kind_master_idx
  ON tenant_conversations(kind, last_message_at DESC) WHERE kind = 'master_broadcast';

-- 2. Atualiza enforce_chat_same_module pra skip em master_broadcast.
-- Master tenant é human (031), mas envia broadcast pra vet também.
-- O resto da função preservado byte-a-byte.
CREATE OR REPLACE FUNCTION enforce_chat_same_module() RETURNS trigger AS $$
DECLARE
  module_a TEXT;
  module_b TEXT;
BEGIN
  -- Master broadcasts são cross-module by design — skip a validação
  IF TG_TABLE_NAME = 'tenant_conversations' AND NEW.kind = 'master_broadcast' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'tenant_conversations' THEN
    SELECT module INTO module_a FROM tenants WHERE id = NEW.tenant_a_id;
    SELECT module INTO module_b FROM tenants WHERE id = NEW.tenant_b_id;
  ELSIF TG_TABLE_NAME = 'tenant_invitations' THEN
    SELECT module INTO module_a FROM tenants WHERE id = NEW.from_tenant_id;
    SELECT module INTO module_b FROM tenants WHERE id = NEW.to_tenant_id;
  END IF;

  IF module_a IS NULL OR module_b IS NULL THEN
    RAISE EXCEPTION 'tenant não encontrado ao validar cross-module em %', TG_TABLE_NAME;
  END IF;

  IF module_a <> NEW.module OR module_b <> NEW.module THEN
    RAISE EXCEPTION 'cross-module proibido: tenants devem ser do módulo % (got % e %)',
      NEW.module, module_a, module_b;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Trigger já está registrado em 047 — só atualizamos a função.

-- 3. Tabela canônica de broadcasts (auditoria + métricas)
CREATE TABLE IF NOT EXISTS master_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  segment_kind TEXT NOT NULL CHECK (segment_kind IN ('all', 'module', 'tenant')),
  segment_value TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS master_broadcasts_created_at_idx
  ON master_broadcasts(created_at DESC);

ALTER TABLE master_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_broadcasts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mb_master_only ON master_broadcasts;
CREATE POLICY mb_master_only ON master_broadcasts USING (
  NULLIF(current_setting('app.tenant_id', true), '') IS NULL
);

-- 4. Anexos do broadcast (1 broadcast → N anexos compartilhados entre tenants)
CREATE TABLE IF NOT EXISTS master_broadcast_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES master_broadcasts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'pdf')),
  filename TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS master_broadcast_attachments_broadcast_idx
  ON master_broadcast_attachments(broadcast_id);

ALTER TABLE master_broadcast_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_broadcast_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mba_master_only ON master_broadcast_attachments;
CREATE POLICY mba_master_only ON master_broadcast_attachments USING (
  NULLIF(current_setting('app.tenant_id', true), '') IS NULL
);

-- 5. Delivery tracking — métricas + rastreabilidade por tenant
CREATE TABLE IF NOT EXISTS master_broadcast_deliveries (
  broadcast_id UUID NOT NULL REFERENCES master_broadcasts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES tenant_conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES tenant_messages(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (broadcast_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS mbd_tenant_delivered_idx
  ON master_broadcast_deliveries(tenant_id, delivered_at DESC);

ALTER TABLE master_broadcast_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_broadcast_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mbd_master_only ON master_broadcast_deliveries;
CREATE POLICY mbd_master_only ON master_broadcast_deliveries USING (
  NULLIF(current_setting('app.tenant_id', true), '') IS NULL
);

-- 6. GRANTs ao runtime user
GRANT SELECT, INSERT, UPDATE ON master_broadcasts TO genomaflow_app;
GRANT SELECT, INSERT, DELETE ON master_broadcast_attachments TO genomaflow_app;
GRANT SELECT, INSERT, DELETE ON master_broadcast_deliveries TO genomaflow_app;
