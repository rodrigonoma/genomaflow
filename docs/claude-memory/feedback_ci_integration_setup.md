---
name: CI Integration Tests — contrato com app e service containers
description: 6 iterações bootstrap revelaram contratos não-óbvios entre CI integration tests e o app Fastify. Lições pra estabilizar + estender pra outras features (copilot, video, agenda).
type: feedback
---

# CI Integration Tests — Setup do contrato app ↔ CI

## Contexto

Camada 2 (smoke integration tests contra Postgres real) foi adicionada
em 2026-05-12 pra pegar bugs como o `updated_at` que rotas unit-mocked
não cobrem. Bootstrap inicial teve 6 iterações antes de revelar que o
boot do app no CI cold start excede o `beforeAll` default do Jest (60s).

Status atual: **GATE OBRIGATÓRIO** desde 2026-05-12 — `needs: [test, integration]`
no deploy job. Estabilizado via:
- migrations FORA do Jest (step CI separado)
- `pluginTimeout: 0` em NODE_ENV=test (Fastify server.js)
- `beforeAll` + `jest.setTimeout` 180s no integration suite
- Postgres + Redis service containers

Bugs schema/SQL futuros são pegos antes de chegar em prod.
Bug 4 do 2026-05-12 (`ref_id` em credit_ledger) foi a gota — passou pelos
9 testes unitários mockados + Camada 1 (production build) e só explodiu
em prod. Camada 2 obrigatória previne classe inteira.

## Iterações já validadas

| # | Sintoma | Causa | Fix |
|---|---|---|---|
| 1 | `database "genomaflow" does not exist` em migration 018 | Migration tem `GRANT CONNECT ON DATABASE genomaflow` literal. CI usava `genomaflow_test`. | Padronizar `POSTGRES_DB=genomaflow` no service container. |
| 2 | `database "genomaflow_test" does not exist` (com env CI correto) | `jest.config.js` hardcodava `DATABASE_URL_TEST=...genomaflow_test`, sobrescrevendo env do workflow. | Pattern `process.env.X = process.env.X \|\| default`. |
| 3 | `Plugin did not start in time: routes/auth` | Server boota plugin Redis sem service no CI → ioredis retry indefinido. | `redis:7-alpine` como service container. |
| 4 | Mesmo erro com Redis disponível | `plugins/postgres.js` usa `process.env.DATABASE_URL`, não `_TEST`. CI só setava `_TEST`. | Setar ambos no workflow env. |
| 5 | Mesmo erro com tudo setado | Default Fastify `pluginTimeout=10s`. Cold boot CI ultrapassa. | `pluginTimeout: 30_000` (prod) / `0` (test env). |
| 6 | Mesmo erro com pluginTimeout=0 | Migrations rodavam dentro do `beforeAll`, consumindo a janela. | Migrations em step CI separado (`node src/db/migrate.js`) antes do Jest. |
| 7 | Test passou 65s mas Jest abortou | Jest `beforeAll` timeout default = 60s. Boot completo do app + migrations + seed excede. | TODO: aumentar Jest timeout OU lazy boot OU reusar app entre suites. |

## Contrato resultante (state-of-the-art atual)

### Workflow CI (`.github/workflows/deploy.yml`)
```yaml
integration:
  services:
    postgres:
      image: pgvector/pgvector:pg15
      env:
        POSTGRES_USER: postgres
        POSTGRES_PASSWORD: postgres
        POSTGRES_DB: genomaflow   # NÃO genomaflow_test (migration 018)
    redis:
      image: redis:7-alpine        # OBRIGATÓRIO (plugin redis + pubsub)
  env:
    DATABASE_URL: postgres://...:5432/genomaflow       # OBRIGATÓRIO (plugin pg)
    DATABASE_URL_TEST: postgres://...:5432/genomaflow  # OBRIGATÓRIO (setup.js)
    REDIS_URL: redis://localhost:6379
    NODE_ENV: test
  steps:
    - npm ci
    - node src/db/migrate.js     # FORA do Jest
    - npm run test:integration
```

### `jest.config.js`
```js
// Respeitar env do CI; default cai pro localhost
process.env.DATABASE_URL      = process.env.DATABASE_URL      || 'postgres://.../genomaflow_test';
process.env.DATABASE_URL_TEST = process.env.DATABASE_URL_TEST || 'postgres://.../genomaflow_test';
```

### `server.js`
```js
// pluginTimeout: 0 (sem timeout) em test, 30s em prod
const PLUGIN_TIMEOUT = process.env.NODE_ENV === 'test' ? 0 : 30_000;
const app = Fastify({ ..., pluginTimeout: PLUGIN_TIMEOUT });
```

### Suite integration test
```js
// Migrations já aplicadas pelo step CI ANTES do Jest
// beforeAll só faz seed + app.ready()
beforeAll(async () => {
  await app.ready();
  ctx = await seedAestheticTenant();
}, 90_000);  // Jest timeout aumentado se necessário
```

## Pendência (iteração 7+ futura)

O 65s Jest timeout ainda é apertado pra cold boot do CI com 50+ rotas Fastify. Próximas tentativas a explorar:

1. **Aumentar `beforeAll` Jest timeout pra 120s+** (parâmetro 2º de beforeAll).
2. **Lazy boot do app**: criar Fastify instance MÍNIMA pra testes (só rotas aesthetic + plugins essenciais), não o app completo.
3. **Reusar app entre suites** via Jest globalSetup → carrega app uma vez, todos os tests reusam.
4. **Reduzir rotas registradas em test**: condicional `if (process.env.NODE_ENV !== 'test' || /aesthetic|patients|auth/.test(routeName))`.

Opção 2 ou 3 são as mais corretas — opção 1 é band-aid.

## Anti-patterns observados no projeto

- `jest.config.js` hardcoded env vars (sobrescreve CI silenciosamente) — **fix aplicado**.
- Migration 018 literal `GRANT CONNECT ON DATABASE genomaflow` — **WONTFIX hoje**, CI ajustado.
- Plugin Redis criado sem fallback gracioso — em test, deveria ser opcional. **TODO opcional**.
- Plugin pg cria pool com `connectionString` literal — não suporta override de pool config em test. **TODO opcional**.

## Como adicionar integration test pra NOVA feature

Quando estabilizar o setup:

1. Criar `apps/api/tests/integration/<feature>-mutations.integration.test.js`.
2. Importar `setup.js` (`runMigrations` idempotente pra dev local; CI já aplicou fora).
3. Mocks de SDKs externos (Anthropic, Stripe, S3) via `jest.mock`.
4. Cada mutation testa contra DB real + JWT signed com `signJwt(...)` do setup.
5. Adicionar caminho ao test:integration glob OU usar pattern `tests/integration/*.test.js` (já configurado).

Cobertura desejável (em ordem de criticidade):
- ✅ aesthetic mutations (em estabilização)
- 🟡 copilot (audit_log + RAG)
- 🟡 video consultations (chime)
- 🟡 master broadcasts (fan-out)
- 🟡 stripe webhooks (idempotência)
- 🟡 inter-tenant chat (PII detection)

## Decisão atual

`integration` job é gate obrigatório desde 2026-05-12. Deploy só passa se Camada 1 (unit tests + ng build prod) E Camada 2 (Postgres real + smoke aesthetic) passarem.

**Não regredir os fixes já aplicados** — eles são necessários para qualquer cenário de integration test, mesmo após a estabilização final do boot.
