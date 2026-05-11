-- 089_aesthetic_analyses.sql
-- Análises IA estéticas. Schema flexível com `metrics`/`observations`/`recommendations`
-- JSONB. analysis_type enum extensível por região anatômica.
-- Spec §4.2

CREATE TABLE IF NOT EXISTS aesthetic_analyses (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id               UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id                  UUID REFERENCES users(id) ON DELETE SET NULL,
  analysis_type            TEXT NOT NULL CHECK (analysis_type IN (
    'facial','eyelids','neck','breast','arms',
    'abdomen','legs','glutes','full_body','other')),
  photo_ids                UUID[] NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN
                             ('pending','processing','done','error')),
  metrics                  JSONB,
  observations             JSONB,
  recommendations          JSONB,
  model_metrics            TEXT,
  model_recommendations    TEXT,
  tokens_input             INT,
  tokens_output            INT,
  error_code               TEXT,
  error_message            TEXT,
  baseline_analysis_id     UUID REFERENCES aesthetic_analyses(id) ON DELETE SET NULL,
  credits_charged          INT NOT NULL DEFAULT 5,
  credits_refunded         BOOLEAN NOT NULL DEFAULT false,
  deleted_at               TIMESTAMPTZ NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_aesthetic_analyses_subject
  ON aesthetic_analyses(tenant_id, subject_id, analysis_type, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_aesthetic_analyses_pending
  ON aesthetic_analyses(status, created_at)
  WHERE status IN ('pending','processing');

ALTER TABLE aesthetic_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_analyses FORCE ROW LEVEL SECURITY;

CREATE POLICY aesthetic_analyses_tenant ON aesthetic_analyses
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE TRIGGER aesthetic_analyses_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_analyses
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
