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
