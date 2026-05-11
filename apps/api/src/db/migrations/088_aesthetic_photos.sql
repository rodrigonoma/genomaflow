-- 088_aesthetic_photos.sql
-- Tabela genérica de fotos estéticas (facial + corporal + antes/depois).
-- RLS NULLIF (igual audit_log/055) + audit trigger.
-- Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md §4.1

CREATE TABLE IF NOT EXISTS aesthetic_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  photo_type   TEXT NOT NULL CHECK (photo_type IN (
    'facial_front','facial_left','facial_right',
    'eyelids_close','neck_front','neck_side',
    'breast_front','breast_side',
    'body_front','body_back','body_left','body_right',
    'arms_front','arms_relaxed','arms_flexed',
    'abdomen_front','abdomen_side',
    'legs_front','legs_back','legs_side',
    'glutes_back',
    'full_body_front','full_body_back','full_body_side',
    'other')),
  s3_key       TEXT NOT NULL,
  is_sensitive BOOLEAN NOT NULL DEFAULT false,
  taken_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes        TEXT,
  deleted_at   TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aesthetic_photos_subject
  ON aesthetic_photos(tenant_id, subject_id, taken_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_aesthetic_photos_sensitive_retention
  ON aesthetic_photos(created_at)
  WHERE is_sensitive = true AND deleted_at IS NULL;

ALTER TABLE aesthetic_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_photos FORCE ROW LEVEL SECURITY;

CREATE POLICY aesthetic_photos_tenant ON aesthetic_photos
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE TRIGGER aesthetic_photos_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_photos
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
