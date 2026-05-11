-- 091_aesthetic_treatments.sql
-- Catálogo curado de tratamentos estéticos.
-- tenant_id NULL = catálogo global GenomaFlow (master gerencia)
-- tenant_id setado = tratamento proprietário da clínica
-- RLS visibility: NULL (global) OR same tenant.
-- Spec §4.4

CREATE TABLE IF NOT EXISTS aesthetic_treatments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  category               TEXT NOT NULL CHECK (category IN
                           ('corpo_modelagem','corpo_flacidez',
                            'facial_rejuvenescimento','facial_pigmentacao',
                            'facial_acne','facial_preenchimento','facial_toxina',
                            'cabelo','procedimento_cirurgico',
                            'wellness_drenagem','outro')),
  indications            TEXT[] NOT NULL,
  contraindications      TEXT[] NOT NULL,
  typical_sessions       INT,
  interval_days          INT,
  cost_estimate_brl_min  DECIMAL(10,2),
  cost_estimate_brl_max  DECIMAL(10,2),
  evidence_level         TEXT CHECK (evidence_level IN ('A','B','C','D')),
  description            TEXT,
  protocol_notes         TEXT,
  requires_medico        BOOLEAN NOT NULL DEFAULT false,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  usage_count_30d        INT NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aesthetic_treatments_visibility
  ON aesthetic_treatments(tenant_id, category, is_active);

CREATE INDEX IF NOT EXISTS idx_aesthetic_treatments_indications
  ON aesthetic_treatments USING gin(indications);

ALTER TABLE aesthetic_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_treatments FORCE ROW LEVEL SECURITY;

-- RLS: global OR same tenant
CREATE POLICY aesthetic_treatments_visibility ON aesthetic_treatments
  USING (
    tenant_id IS NULL
    OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE TRIGGER aesthetic_treatments_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_treatments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
