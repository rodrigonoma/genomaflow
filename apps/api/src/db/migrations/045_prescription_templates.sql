-- Migration 045: templates de prescrição por tenant
-- Permite salvar receitas como template reutilizável e aplicar com 1 clique.
-- Escopo: por tenant (todos os profissionais da clínica compartilham os templates).

CREATE TABLE IF NOT EXISTS prescription_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  agent_type  TEXT NOT NULL CHECK (agent_type IN ('therapeutic', 'nutrition')),
  items       JSONB NOT NULL DEFAULT '[]',
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, name, agent_type)
);

CREATE INDEX IF NOT EXISTS prescription_templates_tenant_idx
  ON prescription_templates(tenant_id, agent_type);

ALTER TABLE prescription_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY prescription_templates_isolation ON prescription_templates
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON prescription_templates TO genomaflow_app;
