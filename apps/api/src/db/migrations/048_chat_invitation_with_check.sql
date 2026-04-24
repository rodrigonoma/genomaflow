-- Migration 048: completa WITH CHECK na policy ti_update
-- (NOTE-1 do review final da Phase 1 do chat entre tenants)
--
-- A policy original tinha apenas USING, o que é funcionalmente seguro hoje
-- porque o Postgres aplica USING ao row pós-UPDATE, mas inconsistente com
-- as outras UPDATE policies da fase (tc_update, tm_update, tcs_update, etc.)
-- que têm USING + WITH CHECK explícitos.

DROP POLICY IF EXISTS ti_update ON tenant_invitations;
CREATE POLICY ti_update ON tenant_invitations FOR UPDATE
  USING (
    from_tenant_id = current_setting('app.tenant_id', true)::uuid OR
    to_tenant_id   = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    from_tenant_id = current_setting('app.tenant_id', true)::uuid OR
    to_tenant_id   = current_setting('app.tenant_id', true)::uuid
  );
