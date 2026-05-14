---
name: SQL schema sync — referência a coluna inexistente
description: Tests mockados de pg.query não pegam quando a query referencia coluna que não existe no schema real. Incidente 2026-05-12 (PUT /aesthetic/profile 500 — UPDATE referenciava updated_at em subjects, que não tem essa coluna).
type: feedback
---

# SQL schema sync — coluna inexistente vs tests mockados

## Regra obrigatória

Antes de escrever query nova com `UPDATE`, `INSERT` ou `SELECT` em coluna específica:

1. **Verificar o schema real** lendo as migrations da tabela (em ordem). NÃO confiar em memória/intuição.
2. **Listar as colunas existentes** com:
   ```bash
   grep -rE "(CREATE TABLE|ALTER TABLE) .* <table>" apps/api/src/db/migrations/
   ```
3. **Tests com pg.query mockado NÃO PEGAM esse bug** — eles retornam o que o mock diz, não validam SQL contra schema real.

## Incidente 2026-05-12 — referência forense

**Bug:** PUT `/aesthetic/profile/:subject_id` retornava 500 Internal Server Error.

**Causa raiz:**

```js
// apps/api/src/services/aesthetic-profile.js
const { rows } = await client.query(
  `UPDATE subjects SET aesthetic_profile = $1, updated_at = NOW()  -- ❌
   WHERE id = $2 AND tenant_id = $3
   RETURNING id, aesthetic_profile`,
  [JSON.stringify(enriched), subjectId, tenantId]
);
```

Tabela `subjects` (migration 003) tem apenas `created_at` — **não tem `updated_at`**.

Postgres → `column "updated_at" of relation "subjects" does not exist` → Fastify 500.

15 unit tests da rota com `pg.query` mockado **passaram** porque mock retorna o que o test diz, não valida SQL.

## Fix aplicado (commit `73de090`)

```js
// updated_at vai dentro do JSONB (aesthetic_profile.updated_at)
const enriched = { ...profile, updated_at: new Date().toISOString() };
const { rows } = await client.query(
  `UPDATE subjects SET aesthetic_profile = $1::jsonb  -- sem updated_at na coluna
   WHERE id = $2 AND tenant_id = $3
   RETURNING id, aesthetic_profile`,
  [JSON.stringify(enriched), subjectId, tenantId]
);
```

+ 3 testes source-inspection que garantem regression-proof:
- UPDATE NÃO referencia coluna `updated_at` em subjects
- `updated_at` é gravado dentro do JSONB
- Cast explícito `$1::jsonb`

## Padrões obrigatórios

### Antes de escrever query nova:

```bash
# Listar colunas reais da tabela
grep -E "^\s*(CREATE TABLE|ALTER TABLE.*ADD)" apps/api/src/db/migrations/*.sql | grep -i <table>

# Ou verificar via DB local
wsl docker compose exec db psql -U postgres -d genomaflow -c "\d <table>"
```

### Test source-inspection para queries críticas

```js
// apps/api/tests/services/<feature>-sql-regression.test.js
const fs = require('fs');
const SOURCE = fs.readFileSync(/* service.js */);

describe('<feature> SQL — regression guard', () => {
  test('UPDATE NÃO referencia coluna fantasma', () => {
    expect(SOURCE).not.toMatch(/UPDATE <table>[\s\S]*?<coluna_inexistente>\s*=/);
  });
});
```

Modelo vivo: `apps/api/tests/routes/aesthetic-profile.test.js:230` (describe "regression guard").

### Camada 2 (integration tests) seria a defesa real

Quando estabilizar (atualmente WIP — `feedback_ci_integration_setup.md`), o test integration pega esse bug em <1s:

```js
// apps/api/tests/integration/aesthetic-mutations.integration.test.js
test('persiste perfil válido sem 500 (regression updated_at)', async () => {
  const res = await supertest(app.server)
    .put(`/api/aesthetic/profile/${subjectId}`)
    .set(auth())
    .send({ height_cm: 165, weight_kg: 65, ... });
  expect(res.status).toBe(200);  // 500 seria o bug
});
```

## Tabelas com discrepância updated_at vs created_at no GenomaFlow

Tabelas que **NÃO TÊM `updated_at`** (apenas `created_at`):

- `subjects` (migration 003)
- `exams` — verificar
- `aesthetic_consent` — verificar

Tabelas que **TÊM `updated_at`**:

- `tenants`
- `aesthetic_treatments` (migration 091)
- `aesthetic_treatment_suggestions` (migration 092 — via `reviewed_at`)
- Maioria das tabelas novas (F1+)

Quando em dúvida, ler a migration de CREATE da tabela.

## Anti-pattern

❌ Copiar query de outra tabela assumindo que tem as mesmas colunas.

❌ Assumir que toda tabela tem `updated_at`. Algumas só têm `created_at` (legacy, design escolhido na época).

❌ Confiar 100% em tests com pg.query mockado para validar SQL.

✅ Antes de UPDATE/INSERT/SELECT em campo específico: verificar migration.

✅ Para queries críticas (rotas de mutação produção): source-inspection test + integration test (quando Camada 2 estabilizar).
