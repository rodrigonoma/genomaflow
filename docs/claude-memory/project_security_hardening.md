---
name: Security Hardening — April 2026
description: Auditoria completa de segurança aplicada em abril/2026 — RLS, auth fixes, rate limiting, senha rotacionada
type: project
originSessionId: 70201c53-e120-4e84-a6d1-e96d8946598d
---
Auditoria completa aplicada e mergeada na main em 2026-04-20.

**Why:** Revisão proativa identificou problemas de isolamento multi-tenant, endpoint sem auth, e ausência de rate limiting antes do lançamento.

**How to apply:** Estas correções já estão na main. Novas features devem seguir os padrões estabelecidos.

## Migrations aplicadas

- `032_security_hardening.sql` — RLS em `users` (ENABLE+FORCE, política NULLIF para login cross-tenant), RLS em `treatment_items` (via subquery a `treatment_plans`), FORCE em `owners` e `treatment_plans`
- `033_tighten_users_insert_policy.sql` — Restringe `users_insert` policy após `/register` usar withTenant
- `034_rotate_master_password.sql` — Rotaciona hash da senha master (hash antigo estava na migration 031)

## Tabelas COM RLS (ENABLE + FORCE)

Após as corrections: `patients`, `exams`, `clinical_results`, `integration_connectors`, `integration_logs`, `review_audit_log`, `owners`, `treatment_plans`, `chat_embeddings`, `users`, `treatment_items`

## Senha master rotacionada

- Hash antigo (migration 031) invalidado em produção via migration 034
- Nova senha: armazenar APENAS no vault seguro (AWS Secrets Manager / 1Password) — nunca no repo
- Próxima rotação: gerar nova migration numerada sequencialmente

## Padrões adicionados

- Rate limiting: `/auth/login` (10/min), `/auth/register` (5/10min), `/chat/message` (30/min) via `@fastify/rate-limit@^9`
- `trustProxy: true` no Fastify para IP real atrás do AWS ALB
- Embedding model via `EMBEDDING_MODEL` env var (fallback: `text-embedding-3-small`)
- WebSocket heartbeat ping/pong (30s interval) para detectar conexões mortas
- HTTPS redirect via `X-Forwarded-Proto` no nginx (ambos server blocks)
- Constantes centralizadas em `apps/api/src/constants.js`

## Endpoint removido

- `POST /auth/activate` — era público e permitia qualquer pessoa ativar tenants. Removido. Ativação agora só via `PATCH /master/tenants/:id/activate` (master auth).

---

## Auditoria 2026-04-23 — Defense in Depth multi-tenant

**Gatilho:** usuário reportou aparente vazamento cross-tenant (novo usuário human viu animal de outro usuário vet). Investigação em produção (ECS run-task com diagnóstico) provou que RLS estava OK (`genomaflow_app` sem BYPASSRLS/SUPERUSER, dados nos tenants corretos). Causa provável do sintoma: JWT antigo em localStorage + UI sem indicador de tenant. MAS a auditoria expôs bugs reais que teriam causado vazamento se RLS falhasse.

**Correções aplicadas (branch `security/tenant-isolation-defense-in-depth` → main):**

1. **Filtro explícito de tenant_id em todas as queries:**
   - `apps/api/src/routes/patients.js` — GET /, /search, /:id, PUT /:id, DELETE /:id, /:id/treatments, PUT /treatments/:plan_id, /owners, PUT /owners/:id
   - `apps/api/src/routes/exams.js` — todas queries + fix de `set_config`
   - `apps/api/src/routes/prescriptions.js`, `prescription-templates.js`, `dashboard.js`, `alerts.js`, `integrations.js`
   - `apps/worker/src/rag/indexer.js` — 5 queries em indexExam, indexSubject, indexAggregates
   
2. **SQL Injection fix em `exams.js:257`:**
   ```js
   // Antes (template literal — vulnerável):
   await client.query(`SET LOCAL app.tenant_id = '${tenant_id}'`);
   // Depois (parametrizado):
   await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant_id]);
   ```
   
3. **ACL fix em `feedback.js` e `error-log.js`:**
   ```js
   // Antes — vazamento cross-tenant: todo admin de clínica era 'admin':
   if (role !== 'admin') return 403;
   // Depois — apenas superusuário master vê cross-tenant:
   if (role !== 'master') return 403;
   ```

4. **Migration 046 — defesa em profundidade de role privileges:**
   - `046_ensure_app_user_no_bypass_rls.sql`: tenta remover BYPASSRLS/SUPERUSER do `genomaflow_app` (com EXCEPTION `insufficient_privilege` para não falhar o deploy se o usuário da migration não tiver privilégio; apenas emite WARNING).

5. **Auth frontend — UX anti-confusão:**
   - `AuthService.resetSession()`: limpa token + WS + signal sem navegar, usado quando usuário abre `/onboarding`.
   - `OnboardingComponent`: chama `resetSession()` em `ngOnInit` se há token (evita JWT antigo ativo durante criação de novo tenant).
   - `AuthService.currentProfile$`: fetch de `/auth/me` cacheado, inclui `tenant_name`.
   - `AppComponent` topbar: chip `[icone-modulo] [tenant_name] [HUMAN|VET]` sempre visível — previne confusão entre contas.
   - `/auth/me`: passou a retornar `t.name AS tenant_name`.

**Regra universal:** toda query em tabela com RLS → filtro explícito de `tenant_id`. RLS é a ÚLTIMA camada de defesa, nunca a ÚNICA.
