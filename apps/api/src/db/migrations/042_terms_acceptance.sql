-- Migration 042: registro de aceite de documentos jurídicos (LGPD + CDS)
-- Cada linha = 1 aceite de 1 documento por 1 usuário em 1 versão específica.

CREATE TABLE IF NOT EXISTS terms_acceptance (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_type  TEXT NOT NULL CHECK (document_type IN (
    'contrato_saas','dpa','politica_incidentes','politica_seguranca','politica_uso_aceitavel'
  )),
  version        TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  accepted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip             TEXT,
  user_agent     TEXT,
  UNIQUE (user_id, document_type, version)
);

CREATE INDEX IF NOT EXISTS terms_acceptance_user_idx   ON terms_acceptance(user_id);
CREATE INDEX IF NOT EXISTS terms_acceptance_tenant_idx ON terms_acceptance(tenant_id);

ALTER TABLE terms_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE terms_acceptance FORCE ROW LEVEL SECURITY;

CREATE POLICY terms_acceptance_isolation ON terms_acceptance
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON terms_acceptance TO genomaflow_app;
