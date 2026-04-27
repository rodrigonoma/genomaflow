-- 059_master_broadcasts_rls_fix.sql
-- Fix de RLS pra fan-out de master broadcasts.
--
-- Discovery em smoke test E2E após 058: ao chamar withTenant(target.id) pra
-- inserir tenant_messages do master, a policy `tm_insert` exige
-- `sender_tenant_id = app.tenant_id`. Sender é master (00...001) mas
-- app.tenant_id era o target → INSERT bloqueado.
--
-- Fix: usar withTenant(MASTER_TENANT_ID) no fan-out. Isso satisfaz
--   - tc_insert (master = tenant_a_id)
--   - tm_insert (sender = master = app.tenant_id; app_is_conversation_member ✓)
-- mas quebra as policies master-only (`NULLIF(...) IS NULL`) porque
-- agora app.tenant_id está setado.
--
-- Solução: estender policies master-only pra aceitar TANTO contexto vazio
-- (rotas master sem set_config) QUANTO contexto = master tenant id (fan-out).
-- Tenants normais (com tenant_id próprio) continuam bloqueados.

-- master_broadcasts
DROP POLICY IF EXISTS mb_master_only ON master_broadcasts;
CREATE POLICY mb_master_only ON master_broadcasts USING (
  NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  OR current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000001'
);

-- master_broadcast_attachments
DROP POLICY IF EXISTS mba_master_only ON master_broadcast_attachments;
CREATE POLICY mba_master_only ON master_broadcast_attachments USING (
  NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  OR current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000001'
);

-- master_broadcast_deliveries
DROP POLICY IF EXISTS mbd_master_only ON master_broadcast_deliveries;
CREATE POLICY mbd_master_only ON master_broadcast_deliveries USING (
  NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  OR current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000001'
);
