-- ============================================================
-- 019 — Patient profiles, owners, treatment plans
-- ============================================================

-- Make birth_date nullable (animals don't always have it)
ALTER TABLE subjects ALTER COLUMN birth_date DROP NOT NULL;

-- Clinical fields on subjects
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS weight        NUMERIC(6,2),        -- kg
  ADD COLUMN IF NOT EXISTS height        NUMERIC(5,1),        -- cm (humans)
  ADD COLUMN IF NOT EXISTS blood_type    TEXT,                -- A+, B-, O+, etc.
  ADD COLUMN IF NOT EXISTS allergies     TEXT,
  ADD COLUMN IF NOT EXISTS comorbidities TEXT,
  ADD COLUMN IF NOT EXISTS notes         TEXT,
  ADD COLUMN IF NOT EXISTS phone         TEXT,
  -- veterinary-specific
  ADD COLUMN IF NOT EXISTS breed         TEXT,
  ADD COLUMN IF NOT EXISTS color         TEXT,
  ADD COLUMN IF NOT EXISTS microchip     TEXT,
  ADD COLUMN IF NOT EXISTS neutered      BOOLEAN;

-- ============================================================
-- Owners (veterinary) — one owner can have multiple animals
-- ============================================================
CREATE TABLE IF NOT EXISTS owners (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  cpf_hash   TEXT,
  cpf_last4  TEXT,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS owners_tenant_id_idx ON owners(tenant_id);

ALTER TABLE owners ENABLE ROW LEVEL SECURITY;

CREATE POLICY owners_isolation        ON owners FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY owners_isolation_insert ON owners FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY owners_isolation_update ON owners FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY owners_isolation_delete ON owners FOR DELETE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON owners TO genomaflow_app;

-- Link animals to owner record
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES owners(id) ON DELETE SET NULL;

CREATE TRIGGER trg_owners_updated_at
  BEFORE UPDATE ON owners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Treatment plans
-- ============================================================
CREATE TABLE IF NOT EXISTS treatment_plans (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id  UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  exam_id     UUID REFERENCES exams(id) ON DELETE SET NULL,  -- optional origin
  created_by  UUID REFERENCES users(id),
  type        TEXT NOT NULL CHECK (type IN ('therapeutic', 'nutritional')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  title       TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS treatment_plans_subject_idx ON treatment_plans(subject_id);
CREATE INDEX IF NOT EXISTS treatment_plans_tenant_idx  ON treatment_plans(tenant_id);

ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY tp_isolation        ON treatment_plans FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tp_isolation_insert ON treatment_plans FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tp_isolation_update ON treatment_plans FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tp_isolation_delete ON treatment_plans FOR DELETE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON treatment_plans TO genomaflow_app;

CREATE TRIGGER trg_treatment_plans_updated_at
  BEFORE UPDATE ON treatment_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Treatment items (lines of a plan)
-- ============================================================
CREATE TABLE IF NOT EXISTS treatment_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id     UUID NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,   -- ex: "Rosuvastatina", "Proteína diária"
  value       TEXT,            -- ex: "10mg", "120g"
  frequency   TEXT,            -- ex: "1x ao dia", "às refeições"
  duration    TEXT,            -- ex: "12 semanas", "contínuo"
  notes       TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS treatment_items_plan_idx ON treatment_items(plan_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON treatment_items TO genomaflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO genomaflow_app;
