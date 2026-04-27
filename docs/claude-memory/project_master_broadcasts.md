---
name: Master Broadcasts (Comunicados) — entregue 2026-04-27
description: Canal "Administrador GenomaFlow" → tenants com markdown + anexos + segmentação + read receipts. Reaproveita inter-tenant chat com kind=master_broadcast.
type: project
---

Canal oficial pra comunicar tenants sobre features, bug fixes, promoções, e responder solicitações de melhoria. Master envia, tenants veem como conversa pinned no chat e podem responder. Master responde direto via inbox.

**Why:** demanda do usuário em 2026-04-27 — antes era zero canal in-app, suporte virava gargalo, melhorias passavam despercebidas. Por escolha, reaproveitamos o inter-tenant chat (Arquitetura A) em vez de criar canal isolado (B), pra UX consistente.

**How to apply:** ao adicionar nova feature de comunicação master→tenant, manter padrões abaixo. Mexer em `kind='master_broadcast'` exige checar 4 lugares: trigger, policies RLS, suspension gate em messages.js, e fan-out via `withTenant(MASTER_TENANT_ID)`.

## Migrations 058–061

- **058** — coluna `kind` em tenant_conversations (default preserva existente); tabelas `master_broadcasts`, `master_broadcast_attachments`, `master_broadcast_deliveries` com RLS master-only; trigger `enforce_chat_same_module` skipa kind=master_broadcast
- **059** — RLS fix descoberto em smoke E2E: `mb/mba/mbd_master_only` aceitam tanto contexto vazio quanto contexto = master tenant id (necessário pro fan-out via withTenant)
- **060** — bug fix do trigger compartilhado: `to_jsonb(NEW)->>'kind'` em vez de `NEW.kind` direto, safe quando trigger roda em tenant_invitations (sem coluna kind)
- **061** — `tc/tcr/tm/tma_select` extendidas com NULLIF: master sem contexto vê todas as conversações/leituras/mensagens; tenant com contexto continua isolado

## Padrões críticos

### Fan-out usa MASTER tenant id no contexto, não target

```js
await withTenant(fastify.pg, MASTER_TENANT_ID, async (client) => {
  // INSERT tenant_conversations (master = tenant_a, kind=master_broadcast)
  // INSERT tenant_messages (sender_tenant_id = master = app.tenant_id) ✓
  // INSERT tenant_message_attachments (s3_key compartilhado entre N tenants)
  // INSERT master_broadcast_deliveries
}, { userId: master_user_id, channel: 'system' });
```

`tm_insert` exige `sender_tenant_id = app.tenant_id`, então context tem que ser master. NUNCA usar `withTenant(target.id)` no fan-out.

### Trigger compartilhado com tabela sem coluna

`enforce_chat_same_module` é compartilhado entre tenant_conversations e tenant_invitations. tenant_invitations NÃO tem coluna `kind`. Acessar `NEW.kind` direto quebra com "record NEW has no field". Sempre `to_jsonb(NEW) ->> 'kind'`.

### RLS — master vê cross-tenant via NULLIF

Rotas `master.js` usam `fastify.pg.query` direto (sem withTenant) → app.tenant_id é NULL. Policies que usam `current_setting('app.tenant_id', true)::uuid` direto quebram com `''::uuid`. Padrão correto:

```sql
NULLIF(current_setting('app.tenant_id', true), '') IS NULL
OR <condição normal de tenant>
```

Aplicado em: tc_select, tcr_select, tm_select, tma_select, mb_master_only, mba_master_only, mbd_master_only.

### Frontend — markdown só pra master

```ts
isMasterMessage(m): boolean {
  return this.isMasterConv() && m.sender_tenant_id === MASTER_TENANT_ID;
}
```

Usar markdown render APENAS quando ambos true. Nunca renderizar markdown de mensagem com sender de tenant — abre XSS.

## Endpoints

| Endpoint | Limite | Função |
|---|---|---|
| `POST /master/broadcasts` | 20/dia | Envia broadcast (body markdown + attachments + segment) |
| `GET /master/broadcasts` | — | Histórico paginado com read_count |
| `GET /master/broadcasts/:id` | — | Detalhe com deliveries + flag read_by_tenant |
| `GET /master/conversations` | — | Inbox de master_broadcast convs |
| `GET /master/conversations/:id/messages` | — | Thread completa |
| `POST /master/conversations/:id/reply` | 100/dia | Reply do master direto na conv |

## Garantias contra regressão

- inter-tenant chat tenant↔tenant: 132 testes verdes na suite integração
- ACL master-only: 55 cases (5 endpoints novos × 3 cases + outros)
- Suspension gate: tenant suspenso ainda PODE responder ao admin (intencional), conversas peer-to-peer mantêm gate

## Frontend novo

- `apps/web/src/app/features/master/master.component.ts` — tab "Comunicados" com composer + histórico + inbox + conversation viewer
- `apps/web/src/app/features/chat-inter-tenant/markdown.service.ts` — wrapper marked + DOMPurify
- `apps/web/src/app/features/chat-inter-tenant/conversation-list.component.ts` — branding pinned
- `apps/web/src/app/features/chat-inter-tenant/thread.component.ts` — render markdown condicional + sem botão report

## Branches/commits

- Fase 1: `feat/master-broadcasts-schema` → main (`e04d618c`)
- Fase 2: `feat/master-broadcasts-api` → main (`4cad86f5`)
- Fase 3: `feat/master-broadcasts-tenant-ui` → main (`79fe230f`)
- Fase 4: `feat/master-broadcasts-attachments` → main (`9a342705`)
- Fase 5: `feat/master-broadcasts-master-ui` → main (`188bf5be`)
- Fase 6: `docs/master-broadcasts-finalize` → tests + docs + IAM CDK + higienização

## IAM S3 (CDK)

`infra/lib/ecs-stack.ts` ganhou inline policy no taskRole pra prefixes `uploads/*`, `inter-tenant-chat/*`, `master-broadcasts/*`. Sem `cdk deploy`, prod retorna AccessDenied silencioso ao subir anexo. Ver feedback_iam_s3_prefixes.md.
