-- Migration 049: tabela de denúncias do chat entre tenants
-- Fase 7: anti-abuso. 3 denúncias de tenants distintos nos últimos 30 dias
-- suspende o tenant denunciado no chat (reads-only em invitations/messages).
--
-- Spec: docs/superpowers/specs/2026-04-23-inter-tenant-chat-design.md §12

CREATE TABLE IF NOT EXISTS tenant_chat_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reported_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  related_message_id UUID REFERENCES tenant_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  -- status: 'pending' = aberta, 'dismissed' = master descartou, 'actioned' = master suspendeu
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'actioned')),
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id UUID REFERENCES users(id),
  CHECK (reporter_tenant_id <> reported_tenant_id)
);

CREATE INDEX IF NOT EXISTS tenant_chat_reports_reported_idx
  ON tenant_chat_reports(reported_tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_chat_reports_reporter_idx
  ON tenant_chat_reports(reporter_tenant_id, created_at DESC);
-- Anti-spam: 1 denúncia por par (reporter, reported) ativa por vez (status=pending)
CREATE UNIQUE INDEX IF NOT EXISTS tenant_chat_reports_unique_pending
  ON tenant_chat_reports(reporter_tenant_id, reported_tenant_id)
  WHERE status = 'pending';

ALTER TABLE tenant_chat_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_chat_reports FORCE ROW LEVEL SECURITY;

-- Reporter vê suas próprias denúncias; master vê tudo (via bypass no handler).
DROP POLICY IF EXISTS tcr_reporter_select ON tenant_chat_reports;
CREATE POLICY tcr_reporter_select ON tenant_chat_reports FOR SELECT
  USING (reporter_tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS tcr_reporter_insert ON tenant_chat_reports;
CREATE POLICY tcr_reporter_insert ON tenant_chat_reports FOR INSERT
  WITH CHECK (reporter_tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON tenant_chat_reports TO genomaflow_app;
