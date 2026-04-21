-- Migration 039: prescriptions table + clinic profile columns

-- Novas colunas em tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cnpj TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS clinic_logo_url TEXT;

-- Tabela de receitas
CREATE TABLE IF NOT EXISTS prescriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  subject_id  UUID NOT NULL REFERENCES subjects(id),
  exam_id     UUID NOT NULL REFERENCES exams(id),
  created_by  UUID NOT NULL REFERENCES users(id),
  agent_type  TEXT NOT NULL CHECK (agent_type IN ('therapeutic', 'nutrition')),
  items       JSONB NOT NULL DEFAULT '[]',
  notes       TEXT,
  pdf_url     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- RLS obrigatório (ENABLE + FORCE)
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions FORCE ROW LEVEL SECURITY;

-- Policy: tenant só acessa suas próprias receitas
CREATE POLICY prescriptions_tenant ON prescriptions
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- Índices de performance
CREATE INDEX IF NOT EXISTS prescriptions_tenant_idx  ON prescriptions(tenant_id);
CREATE INDEX IF NOT EXISTS prescriptions_exam_idx    ON prescriptions(exam_id);
CREATE INDEX IF NOT EXISTS prescriptions_subject_idx ON prescriptions(subject_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON prescriptions TO genomaflow_app;
