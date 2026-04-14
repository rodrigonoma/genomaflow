
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  name TEXT
);

CREATE TABLE patients (
  id UUID PRIMARY KEY,
  tenant_id UUID,
  name TEXT
);

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON patients
USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
