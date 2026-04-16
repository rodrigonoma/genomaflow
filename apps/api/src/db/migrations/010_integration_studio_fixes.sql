-- Add FK constraint on integration_logs.tenant_id
ALTER TABLE integration_logs
  ADD CONSTRAINT integration_logs_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- Add index for RLS tenant filter
CREATE INDEX idx_integration_logs_tenant ON integration_logs(tenant_id);

-- Add delete policy for tenant-scoped cleanup
-- integration_logs is primarily append-only; DELETE allowed for tenant-scoped cleanup
CREATE POLICY tenant_isolation_delete ON integration_logs
  FOR DELETE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
