-- Allow integration-sourced exams
ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_source_check;
ALTER TABLE exams ADD CONSTRAINT exams_source_check
  CHECK (source IN ('upload', 'hl7', 'fhir', 'integration'));

-- Connector registry
CREATE TABLE integration_connectors (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('swagger', 'hl7', 'file_drop')),
  config       JSONB NOT NULL DEFAULT '{}',
  field_map    JSONB NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'inactive'
                 CHECK (status IN ('active', 'inactive', 'error')),
  last_sync_at TIMESTAMPTZ,
  sync_count   INTEGER DEFAULT 0,
  error_msg    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_connectors_tenant ON integration_connectors(tenant_id);

CREATE TRIGGER trg_integration_connectors_updated_at
  BEFORE UPDATE ON integration_connectors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sync/ingest logs
CREATE TABLE integration_logs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connector_id   UUID NOT NULL REFERENCES integration_connectors(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type     TEXT NOT NULL CHECK (event_type IN ('ingest', 'test', 'error')),
  status         TEXT NOT NULL CHECK (status IN ('success', 'error')),
  records_in     INTEGER DEFAULT 0,
  records_out    INTEGER DEFAULT 0,
  error_detail   TEXT,
  duration_ms    INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_logs_connector ON integration_logs(connector_id);
CREATE INDEX idx_integration_logs_tenant ON integration_logs(tenant_id);

-- RLS
ALTER TABLE integration_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connectors FORCE ROW LEVEL SECURITY;
ALTER TABLE integration_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON integration_connectors
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_write ON integration_connectors
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_update ON integration_connectors
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_delete ON integration_connectors
  FOR DELETE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON integration_logs
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_write ON integration_logs
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- integration_logs is primarily append-only; DELETE allowed for tenant-scoped cleanup
CREATE POLICY tenant_isolation_delete ON integration_logs
  FOR DELETE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
