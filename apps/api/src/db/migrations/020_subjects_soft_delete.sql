ALTER TABLE subjects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_subjects_deleted_at ON subjects (deleted_at)
  WHERE deleted_at IS NULL;
