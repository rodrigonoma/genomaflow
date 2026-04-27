-- 061_master_cross_tenant_read.sql
-- Permite que rotas master leiam tenant_conversations e
-- tenant_conversation_reads SEM setar app.tenant_id (padrão de rotas
-- master). Sem este fix, queries do painel "Comunicados" quebram em:
--   - GET /master/broadcasts: tcr_select tenta ''::uuid → erro 22P02
--   - GET /master/conversations: tc_select retorna vazio (sem contexto)
--
-- Padrão NULLIF segue o que já é usado em audit_log e users — quando
-- app.tenant_id NÃO é setado, master vê tudo. Tenant com contexto
-- continua vendo só o próprio (comportamento preservado).
--
-- IMPORTANTE: tm (tenant_messages) e tma (tenant_message_attachments)
-- usam app_is_conversation_member que JÁ tem NULLIF protetor — se
-- app.tenant_id é NULL, retorna false. Pra master ler thread completa
-- usamos `fastify.pg.query` direto que pula RLS via SECURITY DEFINER...
-- na verdade não — vamos precisar estender tm também.

-- 1. tenant_conversations: master sem contexto vê todas as conversações
DROP POLICY IF EXISTS tc_select ON tenant_conversations;
CREATE POLICY tc_select ON tenant_conversations FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_a_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR tenant_b_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- 2. tenant_conversation_reads: master sem contexto vê todas as leituras
-- (necessário pra computar read_count em /master/broadcasts)
DROP POLICY IF EXISTS tcr_select ON tenant_conversation_reads;
CREATE POLICY tcr_select ON tenant_conversation_reads FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- 3. tenant_messages: master sem contexto vê todas (pra ler threads via
-- /master/conversations/:id/messages). Reusa app_is_conversation_member
-- que já tem NULLIF interno, mas adiciona OR pro caso master.
DROP POLICY IF EXISTS tm_select ON tenant_messages;
CREATE POLICY tm_select ON tenant_messages FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR app_is_conversation_member(conversation_id)
  );

-- 4. tenant_message_attachments: idem (master vê todos os anexos das
-- master_broadcast conversations pra renderizar)
DROP POLICY IF EXISTS tma_select ON tenant_message_attachments;
CREATE POLICY tma_select ON tenant_message_attachments FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM tenant_messages m
      WHERE m.id = message_id AND app_is_conversation_member(m.conversation_id)
    )
  );

-- IMPORTANTE: policies de INSERT/UPDATE/DELETE NÃO foram alteradas.
-- Master NUNCA insere via fastify.pg.query direto — fan-out usa
-- withTenant(MASTER_TENANT_ID) que satisfaz tc_insert/tm_insert
-- existentes. Master reply via /master/conversations/:id/reply também
-- usa withTenant. Então mantemos write protection inalterada.
