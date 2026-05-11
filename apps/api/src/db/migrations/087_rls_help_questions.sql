-- 087_rls_help_questions.sql
-- Defesa em profundidade — habilita RLS em help_questions.
--
-- Tabela criada na migration 052 com tenant_id (FK pra tenants) mas SEM
-- ENABLE ROW LEVEL SECURITY. Hoje funciona "por acidente" porque o master
-- panel filtra cross-tenant deliberadamente via fastify.pg.query direto, e
-- o INSERT/UPDATE do product-help passam tenant_id explicitamente do JWT.
-- Mas se uma rota nova esquecer `AND tenant_id = $X`, vaza analytics
-- cross-tenant silenciosamente (regra de defesa em profundidade: RLS é a
-- última camada, mas é OBRIGATÓRIA).
--
-- Padrão NULLIF (mesmo do audit_log em migration 055): permite leitura
-- master cross-tenant quando `app.tenant_id` não está setado, mas restringe
-- a tenant específico quando setado via withTenant().
--
-- Comportamento esperado pós-migration:
-- - master /help-analytics (fastify.pg direto, sem withTenant) → vê todos
-- - INSERT do product-help (fastify.pg direto, tenant_id explícito no body)
--   → permitido (primeira cláusula NULLIF IS NULL passa)
-- - UPDATE do product-help feedback (fastify.pg direto, WHERE user_id) →
--   permitido (mesma razão)
-- - Qualquer query nova dentro de withTenant(tid, ...) → restringida a tid

ALTER TABLE help_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE help_questions FORCE ROW LEVEL SECURITY;

CREATE POLICY help_questions_tenant_iso ON help_questions
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
