-- 080_device_tokens.sql
-- Mobile push notification infrastructure: device tokens table
-- Stores FCM (Android) and APNs (iOS) tokens for push delivery
-- No RLS (not clinical data) — isolation via explicit user_id + tenant_id in queries

CREATE TABLE IF NOT EXISTS device_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL,
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);

-- Index for sendToUser push lookups (single user → all devices)
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);

-- Note: no RLS policy (infrastructure table, not clinical data)
-- Isolation guaranteed via explicit tenant_id filter in all queries
-- Example: SELECT token FROM device_tokens WHERE user_id = $1 AND tenant_id = $2
