-- 021 — Doctor specialty on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS specialty VARCHAR(64);
