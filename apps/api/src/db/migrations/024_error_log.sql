CREATE TABLE IF NOT EXISTS error_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  url          TEXT,
  method       TEXT,
  status_code  INT,
  error_message TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
