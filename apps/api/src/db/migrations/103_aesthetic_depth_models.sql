-- 103_aesthetic_depth_models.sql
-- V2 Fase 3: modelos 3D (heightmap MVP + multi-view fusion futuro).
-- 1 entry por análise quando esteticista pede "Gerar 3D". Sem custo de
-- créditos extras — incluído nos 10cr do tier advanced.
-- Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase3-design.md §5.

CREATE TABLE IF NOT EXISTS aesthetic_depth_models (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  analysis_id       UUID NOT NULL REFERENCES aesthetic_analyses(id) ON DELETE CASCADE,
  status            TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'error')),
  model_type        VARCHAR(40) NOT NULL DEFAULT 'heightmap',
  -- 'heightmap' (F3.1 MVP) | 'multiview_fusion' (F3.2 futuro)
  s3_key_glb        TEXT,    -- F3.2: GLTF binário (.glb) com mesh real
  s3_key_depth      TEXT,    -- F3.1+: PNG grayscale do depth map (foto frontal)
  s3_key_texture    TEXT,    -- F3.1+: textura UV (geralmente = foto frontal s3_key, denormalizado pra fetch direto)
  provider          VARCHAR(40) NOT NULL DEFAULT 'depth-anything-v2-small',
  provider_version  VARCHAR(40),
  metadata          JSONB,
  -- ex: { vertex_count, processing_ms, photo_used, depth_resolution: "518x518" }
  error_code        TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

ALTER TABLE aesthetic_depth_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_depth_models FORCE ROW LEVEL SECURITY;

CREATE POLICY aesthetic_depth_tenant ON aesthetic_depth_models
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- Lookup principal: pegar depth de uma análise específica
CREATE INDEX IF NOT EXISTS idx_aesthetic_depth_analysis
  ON aesthetic_depth_models (analysis_id);

-- Pending jobs: worker pode varrer pra recover crashes
CREATE INDEX IF NOT EXISTS idx_aesthetic_depth_status_pending
  ON aesthetic_depth_models (status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE TRIGGER aesthetic_depth_models_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_depth_models
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

COMMENT ON COLUMN aesthetic_depth_models.model_type IS
  'heightmap (F3.1 MVP — plano deformado por depth) | multiview_fusion (F3.2 — mesh GLTF de 5 poses)';

COMMENT ON COLUMN aesthetic_depth_models.s3_key_glb IS
  'GLB binário com mesh + textura UV. Populado em F3.2; NULL em F3.1.';

COMMENT ON COLUMN aesthetic_depth_models.s3_key_depth IS
  'PNG grayscale do depth map. Frontend faz heightmap displacement com isso em F3.1.';
