# GenomaFlow — Premissas do Projeto

## Fonte da Verdade: Docker DB

**O banco de dados Docker é a única fonte de verdade do projeto.**

- Todos os dados (tenants, usuários, pacientes, exames, embeddings) vivem no container `db` (PostgreSQL em `db:5432`)
- O banco local `localhost:5432` não deve ser usado como referência para dados
- A API (`apps/api`) conecta exclusivamente ao banco Docker via `DATABASE_URL=postgres://...@db:5432/genomaflow`
- O worker (`apps/worker`) deve igualmente apontar para o banco Docker em desenvolvimento
- Scripts de backfill, seed e migração devem ser executados dentro do contexto Docker (ou apontar para o Docker DB)

### Como rodar o backfill de RAG

```bash
# Indexar todos os exames done no banco Docker:
docker compose exec worker node src/rag/backfill.js
```

### Como rodar migrations

```bash
docker compose exec api node src/db/migrate.js
```

---

## Stack

- **API**: Node.js + Fastify (`apps/api`, porta 3000)
- **Worker**: Node.js standalone (`apps/worker`)
- **Web**: Angular 17 standalone (`apps/web`, porta 4200)
- **Landing**: HTML estático (`apps/landing`)
- **DB**: PostgreSQL 15 + pgvector (`db`, porta 5432)
- **Cache**: Redis 7.2 (`redis`, porta 6379)

## Arquitetura Multi-tenant

- Isolamento via RLS (Row Level Security) em todas as tabelas de dados clínicos
- `set_config('app.tenant_id', tenant_id, true)` deve ser chamado dentro de uma transação antes de qualquer query em tabela com RLS
- Usar o helper `withTenant(pool, tenant_id, async (client) => {...})` em `apps/api/src/db/tenant.js`

## Chatbot RAG

- Indexação automática via evento `exam:done` no worker
- Backfill manual necessário para exames históricos (ver comando acima)
- Sessões de chat vivem no Redis (TTL 2h), sem persistência em banco
