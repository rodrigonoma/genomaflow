-- 104_aesthetic_analysis_shares.sql
-- V2 Fase 4: audit trail de compartilhamentos de relatório paciente
-- (email SES + WhatsApp Z-API send-document). 1 entry por canal × send.
-- Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase4-design.md §4

CREATE TABLE IF NOT EXISTS aesthetic_analysis_shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  analysis_id     UUID NOT NULL REFERENCES aesthetic_analyses(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  recipient       TEXT NOT NULL,                       -- email RFC ou phone E.164
  status          TEXT NOT NULL CHECK (status IN ('queued','sent','delivered','failed')),
  provider_id     TEXT,                                 -- message_id retornado por SES/Z-API
  error_code      TEXT,
  error_message   TEXT,
  s3_key_pdf      TEXT,                                 -- cache do PDF paciente (compartilhado entre shares da mesma análise)
  custom_message  TEXT,                                 -- mensagem opcional do esteticista
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ
);

ALTER TABLE aesthetic_analysis_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_analysis_shares FORCE ROW LEVEL SECURITY;

CREATE POLICY aesthetic_shares_tenant ON aesthetic_analysis_shares
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_aesthetic_shares_analysis
  ON aesthetic_analysis_shares (analysis_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_aesthetic_shares_tenant_recent
  ON aesthetic_analysis_shares (tenant_id, sent_at DESC);

CREATE TRIGGER aesthetic_shares_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_analysis_shares
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
