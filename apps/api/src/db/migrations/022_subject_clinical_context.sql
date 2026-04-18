-- 022 — Clinical context fields on subjects (human patients)
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS medications        TEXT,
  ADD COLUMN IF NOT EXISTS smoking            VARCHAR(16),
  ADD COLUMN IF NOT EXISTS alcohol            VARCHAR(16),
  ADD COLUMN IF NOT EXISTS diet_type          VARCHAR(32),
  ADD COLUMN IF NOT EXISTS physical_activity  VARCHAR(16),
  ADD COLUMN IF NOT EXISTS family_history     TEXT;
