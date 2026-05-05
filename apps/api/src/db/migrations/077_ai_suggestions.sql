-- 077_ai_suggestions.sql
-- Phase 4.3: IA pró-ativa no patient-detail.
-- Sugestões de ação clínica baseadas em histórico (comorbidities, exames,
-- prescrições, encontros) + RAG de diretrizes.
--
-- Cache de 24h por paciente — evita LLM calls repetidos. Refresh manual
-- via UI invalida.

CREATE TABLE IF NOT EXISTS ai_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,

  -- Sugestões geradas: array de {id, title, rationale, suggested_action,
  -- priority, source_guideline}
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_version TEXT NOT NULL,

  -- Cache management
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,

  -- IDs de sugestões dismissed pelo profissional (não mostrar mais)
  dismissed_ids JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Auditoria
  generated_by UUID REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1 cache ativo por subject (UNIQUE permite UPSERT no refresh)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_suggestions_subject
  ON ai_suggestions(tenant_id, subject_id);

-- ── RLS NULLIF ────────────────────────────────────────────────────────────
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_suggestions FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_sugg_select ON ai_suggestions
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY ai_sugg_insert ON ai_suggestions
  FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY ai_sugg_update ON ai_suggestions
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY ai_sugg_delete ON ai_suggestions
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- updated_at trigger (reusa fn existente)
CREATE TRIGGER ai_suggestions_updated_at
  BEFORE UPDATE ON ai_suggestions
  FOR EACH ROW EXECUTE FUNCTION trg_clinical_encounters_updated_at();
