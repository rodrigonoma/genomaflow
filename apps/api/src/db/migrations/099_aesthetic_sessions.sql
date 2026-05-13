-- 099_aesthetic_sessions.sql
-- Wrapper de avaliação estética V2: agrupa N fotos padronizadas + 1 análise multi-pose.
-- Aderente ao spec docs/superpowers/specs/2026-05-12-aesthetic-v2-fase1-design.md §5.1.
-- tier='advanced' em aesthetic_analyses exigirá session_id obrigatório (validado em rota).

CREATE TABLE IF NOT EXISTS aesthetic_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id    UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  session_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_type  VARCHAR(50) NOT NULL,
  notes         TEXT,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT aesthetic_sessions_type_check
    CHECK (session_type IN ('facial_analysis', 'body_analysis'))
);

ALTER TABLE aesthetic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY aesthetic_sessions_tenant ON aesthetic_sessions
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_aesthetic_sessions_subject
  ON aesthetic_sessions (tenant_id, subject_id, session_date DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER aesthetic_sessions_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_sessions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
