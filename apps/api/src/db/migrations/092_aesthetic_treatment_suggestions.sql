-- 092_aesthetic_treatment_suggestions.sql
-- Fila de revisão de tratamentos sugeridos pela IA mensalmente.
-- Master revisa, aprova/rejeita, aprovado vira row em aesthetic_treatments.
-- Admin-only (acessada via /master/treatment-suggestions, master role).
-- Sem RLS — tabela administrativa não tenant-scoped.
-- Spec §4.5

CREATE TABLE IF NOT EXISTS aesthetic_treatment_suggestions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  category               TEXT NOT NULL,
  indications            TEXT[],
  contraindications      TEXT[],
  typical_sessions       INT,
  interval_days          INT,
  cost_estimate_brl_min  DECIMAL(10,2),
  cost_estimate_brl_max  DECIMAL(10,2),
  evidence_level         TEXT,
  description            TEXT,
  protocol_notes         TEXT,
  sources                TEXT[],
  status                 TEXT NOT NULL CHECK (status IN
                           ('pending_review','approved','rejected','superseded')),
  rejected_reason        TEXT,
  reviewed_by            UUID REFERENCES users(id),
  reviewed_at            TIMESTAMPTZ,
  promoted_treatment_id  UUID REFERENCES aesthetic_treatments(id),
  source_run_id          UUID NOT NULL,
  generation_model       TEXT,
  generated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_treatment_suggestions_status
  ON aesthetic_treatment_suggestions(status, generated_at DESC);

-- Idempotência: 1 sugestão por (run_id, LOWER(name)) — evita duplicação cross-runs
CREATE UNIQUE INDEX IF NOT EXISTS idx_treatment_suggestions_dedup
  ON aesthetic_treatment_suggestions(source_run_id, LOWER(name));
