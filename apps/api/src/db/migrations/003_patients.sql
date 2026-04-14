CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  birth_date DATE NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('M', 'F', 'other')),
  cpf_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
