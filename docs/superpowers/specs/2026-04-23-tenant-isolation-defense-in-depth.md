---
title: "Incidente 2026-04-23 — Isolamento multi-tenant (defesa em profundidade)"
date: 2026-04-23
status: concluído
severity: crítica
owners: [backend, platform, frontend]
---

## Resumo executivo

Em 2026-04-23, um usuário criou uma nova conta (`rafaela.noma@hotmail.com`, módulo **human**) e afirmou ver o animal "Amendoim" — que pertence a `rafaelanoma@hotmail.com` (módulo **veterinary**). Isso foi reportado como "falha gravíssima de vazamento de dados entre tenants".

Investigação em produção (ECS `run-task` com diagnóstico Node) **provou que RLS está íntegro**:
- Role `genomaflow_app` **sem** `BYPASSRLS` e **sem** `SUPERUSER`.
- `rafaelanoma@hotmail.com` → tenant `2344dc84-...` (vet).
- `rafaela.noma@hotmail.com` → tenant `e44d469a-...` (human).
- `Amendoim` existe **apenas** no tenant `2344dc84-...` (vet).

A causa mais provável do sintoma é **JWT antigo em localStorage**: o usuário anteriormente autenticou no tenant vet, criou a segunda conta sem deslogar, e seguiu usando a aplicação com o JWT antigo — portanto via dados do tenant antigo.

Apesar de a RLS não ter falhado, a auditoria expôs **bugs reais** que teriam causado vazamento se a RLS falhasse — e corrigi-los é defesa em profundidade legítima. Este spec registra as correções e estabelece regras obrigatórias para todo código futuro.

---

## Bugs descobertos e corrigidos

### 1. Queries confiando apenas em RLS (sem filtro explícito de `tenant_id`)

Arquivos com queries SELECT/UPDATE/DELETE que dependiam exclusivamente de RLS:

- `apps/api/src/routes/patients.js` — GET `/`, `/search`, `/:id`, PUT `/:id`, DELETE `/:id`, `/:id/treatments`, PUT `/treatments/:plan_id`, GET `/treatments/:plan_id`, `/owners`, PUT `/owners/:id`
- `apps/api/src/routes/exams.js` — GET `/`, `/:id`, DELETE `/:id`
- `apps/api/src/routes/prescriptions.js`, `prescription-templates.js`, `dashboard.js`, `alerts.js`, `integrations.js`
- `apps/worker/src/rag/indexer.js` — `indexExam`, `indexSubject`, `indexAggregates` (5 queries)

**Correção:** toda query recebeu `AND tenant_id = $X` explícito usando `request.user.tenant_id` (JWT verificado).

### 2. SQL Injection em `exams.js:257` — template literal em `SET LOCAL`

```js
// Antes (vulnerável):
await client.query(`SET LOCAL app.tenant_id = '${tenant_id}'`);

// Depois (parametrizado):
await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant_id]);
```

Apesar do `tenant_id` vir do JWT verificado e ser `UUID` validado, a regra é **nunca interpolar em SQL**. Qualquer valor acaba em SQL parametrizado — zero exceções.

### 3. ACL trocada em `feedback.js` e `error-log.js`

```js
// Antes — vazamento cross-tenant:
if (role !== 'admin') return reply.status(403).send(...);

// Depois — apenas superusuário master:
if (role !== 'master') return reply.status(403).send(...);
```

Todo admin de clínica tem role `'admin'`. A checagem antiga permitia que qualquer admin visse feedback/error-logs de **todas** as clínicas.

### 4. Migration 046 — defesa em profundidade de privilégios de role

`apps/api/src/db/migrations/046_ensure_app_user_no_bypass_rls.sql` tenta garantir que `genomaflow_app` **não** tem `BYPASSRLS` nem `SUPERUSER`. Se o usuário que roda migrations não tiver privilégio para alterar, emite `RAISE WARNING` (não falha deploy) e exige verificação manual.

### 5. Frontend — UX anti-confusão

Bugs de UX que ampliaram a percepção de vazamento:

- **JWT antigo persistia em localStorage** ao criar novo tenant. Corrigido com `AuthService.resetSession()` chamado em `OnboardingComponent.ngOnInit()`.
- **Topbar não mostrava tenant_name**. Usuário não tinha como saber qual tenant estava ativo. Corrigido com:
  - `/auth/me` passou a retornar `t.name AS tenant_name`.
  - `AuthService.currentProfile$` cacheia o perfil.
  - Topbar ganhou chip `[icone-modulo] [tenant_name] [HUMAN|VET]` sempre visível.

---

## Regras permanentes (OBRIGATÓRIO em 100% do código futuro)

Adicionadas a `CLAUDE.md` → seção `## Arquitetura Multi-tenant` e `## Comportamentos NÃO Esperados`.

1. **Toda query SELECT/UPDATE/DELETE em tabela com RLS precisa de `AND tenant_id = $X` explícito.** RLS é a ÚLTIMA camada, nunca a ÚNICA.
2. **`set_config('app.tenant_id', $1, true)` sempre parametrizado.** Template literal em SQL = proibido.
3. **Endpoints master-only checam `role !== 'master'`**, nunca `role !== 'admin'`.
4. **UI sempre mostra tenant_name + módulo** em local visível (topbar). Confusão visual gera falsos reports.
5. **`/onboarding` limpa sessão ativa** — JWT antigo não pode persistir durante criação de novo tenant.
6. **PR review checklist para mudanças em tabelas RLS:** (a) filtro explícito de `tenant_id`, (b) parametrização, (c) teste com dois tenants diferentes.

## Validação em produção

Script de diagnóstico executado via `aws ecs run-task` com base64 decode:
- `genomaflow_app`: `rolsuper=false`, `rolbypassrls=false` ✓
- Todos os registros no tenant correto ✓

## Lições

- RLS é necessária mas **não é suficiente**. Defesa em profundidade exige filtro explícito em cada query.
- Bugs de UX que obscurecem o estado (qual tenant está ativo) amplificam falsas percepções de incidentes de segurança.
- Verificar **estado real de produção** (ECS run-task + SQL direto) é obrigatório antes de concluir investigação — nunca confiar só em raciocínio.
- Auditoria completa vale a pena mesmo quando a hipótese inicial estava errada: os bugs reais encontrados teriam causado o incidente previsto se RLS falhasse por qualquer razão.
