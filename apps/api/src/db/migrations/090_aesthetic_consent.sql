-- 090_aesthetic_consent.sql
-- Confirmação operacional do profissional. 1× por paciente.
-- Paciente não acessa o sistema — profissional confirma que tem
-- consentimento offline do paciente.
-- Spec §4.3

CREATE TABLE IF NOT EXISTS aesthetic_consent (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id          UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id),
  ip                  TEXT,
  user_agent          TEXT,
  notes               TEXT,
  reinforced_regions  TEXT[],
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, subject_id)
);

ALTER TABLE aesthetic_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_consent FORCE ROW LEVEL SECURITY;

CREATE POLICY aesthetic_consent_tenant ON aesthetic_consent
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE TRIGGER aesthetic_consent_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_consent
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
