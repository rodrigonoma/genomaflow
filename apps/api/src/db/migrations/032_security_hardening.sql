-- apps/api/src/db/migrations/032_security_hardening.sql

-- ============================================================
-- 1. RLS na tabela users
-- ============================================================
-- SELECT: aberto quando sem contexto (login, master), restrito com contexto (tenant routes)
-- INSERT/UPDATE/DELETE: aberto sem contexto (registro, criação master), restrito com contexto

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_select ON users
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY users_insert ON users
  FOR INSERT WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY users_update ON users
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ) WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY users_delete ON users
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- ============================================================
-- 2. RLS na tabela treatment_items (sem tenant_id — via JOIN)
-- ============================================================

ALTER TABLE treatment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_items FORCE ROW LEVEL SECURITY;

CREATE POLICY ti_select ON treatment_items
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM treatment_plans tp
      WHERE tp.id = treatment_items.plan_id
        AND tp.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );

CREATE POLICY ti_insert ON treatment_items
  FOR INSERT WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM treatment_plans tp
      WHERE tp.id = treatment_items.plan_id
        AND tp.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );

CREATE POLICY ti_update ON treatment_items
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM treatment_plans tp
      WHERE tp.id = treatment_items.plan_id
        AND tp.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );

CREATE POLICY ti_delete ON treatment_items
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM treatment_plans tp
      WHERE tp.id = treatment_items.plan_id
        AND tp.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );

-- ============================================================
-- 3. FORCE RLS em owners e treatment_plans
-- ============================================================

ALTER TABLE owners FORCE ROW LEVEL SECURITY;
ALTER TABLE treatment_plans FORCE ROW LEVEL SECURITY;
