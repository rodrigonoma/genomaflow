-- 081_video_consultations.sql
-- Consulta por vídeo: Amazon Chime SDK + Whisper + Claude
-- Spec: docs/superpowers/specs/2026-05-08-video-consultation-design.md

-- ── video_consultations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_consultations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  appointment_id      UUID NOT NULL REFERENCES appointments(id),
  meeting_id          TEXT NOT NULL,
  doctor_attendee_id  TEXT NOT NULL,
  patient_attendee_id TEXT NOT NULL,
  join_token          TEXT NOT NULL UNIQUE,
  modality            TEXT NOT NULL CHECK (modality IN ('simple','complete')),
  status              TEXT NOT NULL DEFAULT 'waiting'
                        CHECK (status IN ('waiting','active','ended','transcribing','done','failed')),
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  duration_seconds    INT,
  recording_s3_key    TEXT,
  transcript_text     TEXT,
  ai_extraction       JSONB,
  encounter_id        UUID REFERENCES clinical_encounters(id),
  credits_debited     INT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_consultations_tenant_apt
  ON video_consultations(tenant_id, appointment_id);

CREATE INDEX IF NOT EXISTS idx_video_consultations_join_token
  ON video_consultations(join_token);

CREATE INDEX IF NOT EXISTS idx_video_consultations_tenant_status
  ON video_consultations(tenant_id, status);

ALTER TABLE video_consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_consultations FORCE ROW LEVEL SECURITY;

CREATE POLICY video_consultations_tenant_isolation ON video_consultations
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- ── video_consultation_files ─────────────────────────────────────────────
-- Arquivos trocados durante a consulta (exames, fotos, RX, ECG)
-- Sem RLS própria — isolamento via FK em video_consultations (que tem RLS)
CREATE TABLE IF NOT EXISTS video_consultation_files (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  UUID NOT NULL REFERENCES video_consultations(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL,
  uploaded_by      TEXT NOT NULL CHECK (uploaded_by IN ('doctor','patient')),
  s3_key           TEXT NOT NULL,
  filename         TEXT NOT NULL,
  mime_type        TEXT,
  size_bytes       INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vcf_consultation_id
  ON video_consultation_files(consultation_id);

-- ── clinical_encounters: campo source ────────────────────────────────────
ALTER TABLE clinical_encounters
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'
    CHECK (source IN ('manual','video_ai'));

-- ── credit_ledger kinds novos ────────────────────────────────────────────
-- Documentação: video_simple (-2), video_complete (-6), video_transcription_refund (+4)
-- Sem alteração de schema (kind é TEXT livre na tabela)
