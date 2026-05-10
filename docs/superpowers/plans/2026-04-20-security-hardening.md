# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir todos os problemas de segurança, isolamento multi-tenant e qualidade identificados na auditoria completa do GenomaFlow.

**Architecture:** Todos os fixes são independentes por task — DB via migration numerada, API via patch cirúrgico em routes existentes, infra via configuração. Nenhuma task quebra outra. Aplicar em ordem sequencial pois tasks 1–2 afetam o comportamento de routes corrigidas nas tasks 3–4.

**Tech Stack:** Node.js/Fastify 4.x, PostgreSQL 15 + pgvector + RLS, Angular 18 standalone, nginx, Docker Compose

---

## Nota de Correção: Memory Leaks

O relatório inicial apontou "memory leaks em 17 componentes". Após verificação linha a linha:
- Subscriptions a `examUpdates$`, `billingAlert$`, etc. (WS, longos) → **já têm `ngOnDestroy` com `unsubscribe()`** em todos os componentes que as usam
- Subscriptions HTTP (`.subscribe()` em `http.get/post`) → **completam automaticamente**, não vazam
- Conclusão: não há memory leaks reais. Issue removido do plano.

---

## Files Modified

### Backend
- `apps/api/src/db/migrations/032_security_hardening.sql` — **CRIAR**
- `apps/api/src/routes/auth.js` — Remover `/activate` público + fix JOIN em `/me` + fix register
- `apps/api/src/routes/master.js` — Parametrizar query de feedback
- `apps/api/src/server.js` — Registrar rate limiting
- `apps/api/package.json` — Adicionar `@fastify/rate-limit`
- `apps/api/src/constants.js` — **CRIAR**: constantes centralizadas
- `apps/api/src/routes/billing.js` — Importar constantes centralizadas

### Infrastructure
- `apps/web/nginx.conf` — Adicionar redirect HTTP → HTTPS
- `apps/worker/src/rag/embedder.js` — Embedding model via env var
- `apps/api/src/plugins/pubsub.js` — WebSocket heartbeat ping/pong

---

## Task 1: Migration 032 — RLS Completo no Banco

**Arquivos:**
- Criar: `apps/api/src/db/migrations/032_security_hardening.sql`

### Contexto
- `users`: sem RLS. Login precisa de SELECT cross-tenant (busca por email). A política SELECT permite acesso sem tenant_id para login/master, restringe quando contexto está setado.
- `treatment_items`: sem RLS e sem `tenant_id`. RLS via subquery a `treatment_plans` (que tem RLS+tenant_id).
- `owners`, `treatment_plans`: têm `ENABLE RLS` mas faltam `FORCE` (owner da tabela = postgres superuser pode bypassar).

- [ ] **Step 1: Criar a migration**

```sql
-- apps/api/src/db/migrations/032_security_hardening.sql

-- ============================================================
-- 1. RLS na tabela users
-- ============================================================
-- SELECT: aberto quando sem contexto (login, master), restrito com contexto (tenant routes)
-- INSERT/UPDATE/DELETE: aberto sem contexto (registro, criação master), restrito com contexto

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_select ON users
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY users_insert ON users
  FOR INSERT WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY users_update ON users
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ) WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY users_delete ON users
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- ============================================================
-- 2. RLS na tabela treatment_items (sem tenant_id — via JOIN)
-- ============================================================

ALTER TABLE treatment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_items FORCE ROW LEVEL SECURITY;

CREATE POLICY ti_select ON treatment_items
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM treatment_plans tp
      WHERE tp.id = treatment_items.plan_id
        AND tp.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );

CREATE POLICY ti_insert ON treatment_items
  FOR INSERT WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM treatment_plans tp
      WHERE tp.id = treatment_items.plan_id
        AND tp.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );

CREATE POLICY ti_update ON treatment_items
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM treatment_plans tp
      WHERE tp.id = treatment_items.plan_id
        AND tp.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );

CREATE POLICY ti_delete ON treatment_items
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM treatment_plans tp
      WHERE tp.id = treatment_items.plan_id
        AND tp.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );

-- ============================================================
-- 3. FORCE RLS em owners e treatment_plans (já têm ENABLE)
-- ============================================================

ALTER TABLE owners FORCE ROW LEVEL SECURITY;
ALTER TABLE treatment_plans FORCE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Aplicar a migration no Docker DB**

```bash
docker compose exec api node src/db/migrate.js
```

Saída esperada:
```
Applied migration: 032_security_hardening.sql
```

- [ ] **Step 3: Verificar no banco que RLS está ativo**

```bash
docker compose exec db psql -U postgres -d genomaflow -c "
SELECT tablename, rowsecurity, forcerls
FROM pg_tables
WHERE tablename IN ('users', 'treatment_items', 'owners', 'treatment_plans')
ORDER BY tablename;"
```

Saída esperada (rowsecurity=t, forcerls=t para todos):
```
    tablename     | rowsecurity | forcerls
------------------+-------------+----------
 owners           | t           | t
 treatment_items  | t           | t
 treatment_plans  | t           | t
 users            | t           | t
```

- [ ] **Step 4: Verificar políticas criadas**

```bash
docker compose exec db psql -U postgres -d genomaflow -c "
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('users', 'treatment_items')
ORDER BY tablename, policyname;"
```

- [ ] **Step 5: Smoke test — login ainda funciona**

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"rodrigonoma@genomaflow.com.br","password":"SUA_SENHA"}' | jq .
```

Esperado: `{ "token": "..." }` (não 401 ou 500)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/migrations/032_security_hardening.sql
git commit -m "feat(db): enable RLS on users and treatment_items, FORCE on owners/treatment_plans"
```

---

## Task 2: Remover /auth/activate Público + Corrigir /auth/register + Fix /me JOIN

**Arquivos:**
- Modificar: `apps/api/src/routes/auth.js`

### Contexto
- `/auth/activate` (linha 96-111): endpoint sem autenticação. Qualquer um pode ativar qualquer tenant sabendo o UUID. O endpoint correto de ativação por master já existe em `master.js:36` com autenticação. Este deve ser removido.
- `/auth/register` (linha 87-91): INSERT em `users` sem `withTenant`. Com o novo RLS, o INSERT ainda funciona (política permite sem contexto), mas adicionar `withTenant` deixa o código correto e consistente.
- `/auth/me` (linha 115-123): JOIN incorreto — usa `t.id = $2` (tenant do token) em vez de `t.id = u.tenant_id`. Se o tenant do token não existir, o JOIN pode falhar silenciosamente.

- [ ] **Step 1: Remover /auth/activate**

Em `apps/api/src/routes/auth.js`, remover completamente o bloco:

```javascript
  fastify.post('/activate', async (request, reply) => {
    const { tenant_id } = request.body || {};

    if (!tenant_id) {
      return reply.status(400).send({ error: 'tenant_id é obrigatório' });
    }

    const res = await fastify.pg.query(
      'UPDATE tenants SET active = true WHERE id = $1 RETURNING id',
      [tenant_id]
    );
    if (res.rowCount === 0) {
      return reply.status(404).send({ error: 'Tenant não encontrado' });
    }
    return reply.status(200).send({ ok: true });
  });
```

- [ ] **Step 2: Corrigir /auth/register — usar withTenant para INSERT em users**

No topo do arquivo, adicionar o import de `withTenant`:

```javascript
const bcrypt = require('bcrypt');
const { withTenant } = require('../db/tenant');
```

Substituir o bloco de INSERT de usuário no `/register` (linhas 87-91):

```javascript
    // ANTES:
    const userRes = await fastify.pg.query(
      "INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id",
      [tenant_id, email, password_hash]
    );
    const user_id = userRes.rows[0].id;
```

Por:

```javascript
    // DEPOIS:
    const { rows: userRows } = await withTenant(fastify.pg, tenant_id, async (client) => {
      return client.query(
        "INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id",
        [tenant_id, email, password_hash]
      );
    });
    const user_id = userRows[0].id;
```

- [ ] **Step 3: Corrigir /auth/me — fix JOIN**

Substituir a query do `/me` (linhas 115-123):

```javascript
    // ANTES:
    const { rows } = await fastify.pg.query(
      `SELECT u.id, u.email, u.role, u.specialty, u.created_at, t.module
       FROM users u
       JOIN tenants t ON t.id = $2
       WHERE u.id = $1`,
      [user_id, tenant_id]
    );
```

Por:

```javascript
    // DEPOIS:
    const { rows } = await fastify.pg.query(
      `SELECT u.id, u.email, u.role, u.specialty, u.created_at, t.module
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 AND u.tenant_id = $2`,
      [user_id, tenant_id]
    );
```

- [ ] **Step 4: Verificar que registro ainda funciona**

```bash
curl -s -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"clinic_name":"Teste RLS","email":"rls_test@test.com","password":"senha12345","module":"human"}' | jq .
```

Esperado: `{ "tenant_id": "...", "user_id": "...", "email": "rls_test@test.com" }`

- [ ] **Step 5: Verificar que /auth/activate retorna 404**

```bash
curl -s -X POST http://localhost:3000/auth/activate \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"00000000-0000-0000-0000-000000000001"}' | jq .
```

Esperado: `{"message":"Route POST:/auth/activate not found","error":"Not Found","statusCode":404}`

- [ ] **Step 6: Verificar que /auth/me retorna dados corretos**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"rodrigonoma@genomaflow.com.br","password":"SUA_SENHA"}' | jq -r .token)

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/auth/me | jq .
```

Esperado: objeto com `id`, `email`, `role`, `specialty`, `module`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/auth.js
git commit -m "fix(auth): remove unauthenticated /activate, fix /register withTenant, fix /me JOIN"
```

---

## Task 3: Parametrizar Query de Feedback no master.js

**Arquivos:**
- Modificar: `apps/api/src/routes/master.js`

### Contexto
Linhas 111 e 125 usam string interpolation para o filtro de tipo. Embora o ternário seja seguro (só aceita 'bug' ou 'feature'), o padrão correto é sempre usar parâmetros posicionais (`$3`, `$4`).

- [ ] **Step 1: Substituir query de feedback por versão parametrizada**

Substituir o bloco GET `/feedback` (linhas 105-129):

```javascript
  fastify.get('/feedback', auth(), async (request, reply) => {
    const type  = request.query.type || null;
    const page  = Math.max(1, parseInt(request.query.page)  || 1);
    const limit = Math.min(200, parseInt(request.query.limit) || 50);
    const offset = (page - 1) * limit;

    const where = type ? `AND f.type = '${type === 'bug' ? 'bug' : 'feature'}'` : '';

    const [rows, countRes] = await Promise.all([
      fastify.pg.query(
        `SELECT f.id, f.type, f.message, f.screenshot_url, f.created_at,
                t.name AS tenant_name, u.email AS user_email
         FROM feedback f
         LEFT JOIN tenants t ON t.id = f.tenant_id
         LEFT JOIN users u ON u.id = f.user_id
         WHERE 1=1 ${where}
         ORDER BY f.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      fastify.pg.query(`SELECT COUNT(*) FROM feedback WHERE 1=1 ${where}`)
    ]);

    return { items: rows.rows, total: parseInt(countRes.rows[0].count), page, limit };
  });
```

Por:

```javascript
  fastify.get('/feedback', auth(), async (request, reply) => {
    const rawType = request.query.type;
    const type    = rawType === 'bug' || rawType === 'feature' ? rawType : null;
    const page    = Math.max(1, parseInt(request.query.page)  || 1);
    const limit   = Math.min(200, parseInt(request.query.limit) || 50);
    const offset  = (page - 1) * limit;

    const [rows, countRes] = await Promise.all([
      fastify.pg.query(
        `SELECT f.id, f.type, f.message, f.screenshot_url, f.created_at,
                t.name AS tenant_name, u.email AS user_email
         FROM feedback f
         LEFT JOIN tenants t ON t.id = f.tenant_id
         LEFT JOIN users u ON u.id = f.user_id
         WHERE ($3::text IS NULL OR f.type = $3)
         ORDER BY f.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset, type]
      ),
      fastify.pg.query(
        `SELECT COUNT(*) FROM feedback WHERE ($1::text IS NULL OR type = $1)`,
        [type]
      )
    ]);

    return { items: rows.rows, total: parseInt(countRes.rows[0].count), page, limit };
  });
```

- [ ] **Step 2: Verificar que o endpoint ainda funciona**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"rodrigonoma@genomaflow.com.br","password":"SUA_SENHA"}' | jq -r .token)

curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/master/feedback?type=bug&page=1&limit=10" | jq .total
```

Esperado: número inteiro (sem erro 500).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/master.js
git commit -m "fix(master): parametrize feedback query — remove string interpolation"
```

---

## Task 4: Rate Limiting nos Endpoints Críticos

**Arquivos:**
- Modificar: `apps/api/package.json`
- Modificar: `apps/api/src/server.js`

### Contexto
Nenhum rate limiting existe. `@fastify/rate-limit` é compatível com Fastify 4.x. Limites distintos por rota: login/register mais restritivos (brute force), chat moderado (custo LLM).

- [ ] **Step 1: Instalar o plugin**

```bash
cd apps/api && npm install @fastify/rate-limit@^9
```

- [ ] **Step 2: Registrar o plugin no server.js**

Em `apps/api/src/server.js`, adicionar logo após `require('dotenv').config()`:

```javascript
require('dotenv').config();
const Fastify = require('fastify');

const app = Fastify({ logger: true });

app.register(require('@fastify/rate-limit'), {
  global: false,
  keyGenerator: (request) => request.ip
});
```

O `global: false` evita limitar rotas que não precisam. Limites são definidos por rota.

- [ ] **Step 3: Adicionar limites nas rotas de auth**

Em `apps/api/src/routes/auth.js`, adicionar `config` de rate limit nas rotas de login e register:

```javascript
  fastify.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
```

```javascript
  fastify.post('/register', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } }
  }, async (request, reply) => {
```

- [ ] **Step 4: Adicionar limite no endpoint de chat**

Em `apps/api/src/routes/chat.js`, adicionar `config` no POST `/message`:

```javascript
  fastify.post('/message', {
    preHandler: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
```

- [ ] **Step 5: Testar que rate limit funciona**

```bash
for i in {1..12}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"x@x.com","password":"wrong"}')
  echo "Request $i: $STATUS"
done
```

Esperado: primeiras 10 retornam 401, a partir da 11ª retornam 429.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json \
        apps/api/src/server.js apps/api/src/routes/auth.js apps/api/src/routes/chat.js
git commit -m "feat(api): add rate limiting on login (10/min), register (5/10min), chat (30/min)"
```

---

## Task 5: Rotação da Senha Master (Hash Hardcoded no Git)

**Arquivos:**
- Criar: `apps/api/src/db/migrations/033_rotate_master_password.sql`

### Contexto
Migration 031 contém o hash bcrypt da senha master em texto claro no repositório git. Não é possível remover do histórico git sem reescrever a história (operação destrutiva). A correção prática é: (1) gerar nova senha forte, (2) gerar novo hash, (3) aplicar migration que atualiza o hash, (4) armazenar a senha no vault/env da operação.

- [ ] **Step 1: Gerar nova senha forte**

```bash
openssl rand -base64 24
```

Salvar a senha gerada em um lugar seguro (1Password, AWS Secrets Manager, etc.). Não colocar em nenhum arquivo do repositório.

- [ ] **Step 2: Gerar novo hash bcrypt**

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('SENHA_GERADA_ACIMA', 12).then(console.log)"
```

Copiar o hash gerado (começa com `$2b$12$...`).

- [ ] **Step 3: Criar a migration com o novo hash**

```sql
-- apps/api/src/db/migrations/033_rotate_master_password.sql
-- Rotaciona o hash da senha master. O hash anterior (em 031) foi exposto no git.
-- A nova senha deve ser armazenada em vault seguro, nunca no repositório.

UPDATE users
SET password_hash = 'COLE_O_HASH_GERADO_NO_STEP_2_AQUI'
WHERE email = 'rodrigonoma@genomaflow.com.br'
  AND role = 'master';
```

- [ ] **Step 4: Aplicar a migration**

```bash
docker compose exec api node src/db/migrate.js
```

Saída esperada:
```
Applied migration: 033_rotate_master_password.sql
```

- [ ] **Step 5: Verificar que login funciona com nova senha**

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"rodrigonoma@genomaflow.com.br","password":"NOVA_SENHA"}' | jq .token
```

Esperado: string JWT (não null).

- [ ] **Step 6: Verificar que senha antiga não funciona**

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"rodrigonoma@genomaflow.com.br","password":"SENHA_ANTIGA"}' | jq .
```

Esperado: `{ "statusCode": 401, "error": "...", "message": "Invalid credentials" }`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/migrations/033_rotate_master_password.sql
git commit -m "fix(security): rotate master user password hash — old hash exposed in migration 031"
```

---

## Task 6: Centralizar Constantes (Especialidades e Pacotes)

**Arquivos:**
- Criar: `apps/api/src/constants.js`
- Modificar: `apps/api/src/routes/auth.js`
- Modificar: `apps/api/src/routes/billing.js`

### Contexto
`VALID_SPECIALTIES` está em `auth.js`. `billing.js` usa lista de especialidades diferente (`metabolic`, `cardiovascular`...) que são `agent_types`, não doctor specialties — são conceitos distintos mas o código mistura. `validPackages` em `billing.js:133` também está hardcoded.

- [ ] **Step 1: Criar apps/api/src/constants.js**

```javascript
'use strict';

const VALID_DOCTOR_SPECIALTIES = [
  'endocrinologia', 'cardiologia', 'hematologia', 'clínica_geral', 'nutrição',
  'nefrologia', 'hepatologia', 'gastroenterologia', 'ginecologia', 'urologia',
  'pediatria', 'neurologia', 'ortopedia', 'pneumologia', 'reumatologia',
  'oncologia', 'infectologia', 'dermatologia', 'psiquiatria', 'geriatria',
  'medicina_esporte'
];

const VALID_AGENT_TYPES = [
  'metabolic', 'cardiovascular', 'hematology', 'renal', 'hepatic',
  'hormonal', 'nutritional', 'inflammatory', 'cancer_markers',
  'veterinary_general', 'veterinary_hormonal'
];

const VALID_CREDIT_PACKAGES = [100, 250, 500];

const VALID_MODULES = ['human', 'veterinary'];

module.exports = { VALID_DOCTOR_SPECIALTIES, VALID_AGENT_TYPES, VALID_CREDIT_PACKAGES, VALID_MODULES };
```

- [ ] **Step 2: Atualizar auth.js para usar a constante central**

No topo de `apps/api/src/routes/auth.js`, substituir:

```javascript
// ANTES:
const bcrypt = require('bcrypt');
const { withTenant } = require('../db/tenant');

const VALID_SPECIALTIES = [
  'endocrinologia','cardiologia','hematologia','clínica_geral','nutrição',
  'nefrologia','hepatologia','gastroenterologia','ginecologia','urologia',
  'pediatria','neurologia','ortopedia','pneumologia','reumatologia',
  'oncologia','infectologia','dermatologia','psiquiatria','geriatria',
  'medicina_esporte'
];
```

Por:

```javascript
// DEPOIS:
const bcrypt = require('bcrypt');
const { withTenant } = require('../db/tenant');
const { VALID_DOCTOR_SPECIALTIES, VALID_MODULES } = require('../constants');
```

Na rota `PUT /me/specialty`, substituir:

```javascript
    if (!specialty || !VALID_SPECIALTIES.includes(specialty)) {
      return reply.status(400).send({ error: 'Especialidade inválida', valid: VALID_SPECIALTIES });
    }
```

Por:

```javascript
    if (!specialty || !VALID_DOCTOR_SPECIALTIES.includes(specialty)) {
      return reply.status(400).send({ error: 'Especialidade inválida', valid: VALID_DOCTOR_SPECIALTIES });
    }
```

Na rota `POST /register`, substituir:

```javascript
    if (!['human', 'veterinary'].includes(mod)) {
      return reply.status(400).send({ error: 'Módulo inválido. Use: human ou veterinary' });
    }
```

Por:

```javascript
    if (!VALID_MODULES.includes(mod)) {
      return reply.status(400).send({ error: 'Módulo inválido. Use: human ou veterinary' });
    }
```

- [ ] **Step 3: Atualizar billing.js para usar constantes centrais**

No topo de `apps/api/src/routes/billing.js`, adicionar import:

```javascript
const { withTenant } = require('../db/tenant');
const { VALID_AGENT_TYPES, VALID_CREDIT_PACKAGES } = require('../constants');
```

Localizar a validação de agent_types no `PUT /billing/specialties` e substituir a lista local por `VALID_AGENT_TYPES`:

```javascript
    // ANTES (procurar lista inline):
    const valid = ['metabolic','cardiovascular', ...];
    const invalid = specialties.filter(s => !valid.includes(s));
```

Por:

```javascript
    // DEPOIS:
    const invalid = specialties.filter(s => !VALID_AGENT_TYPES.includes(s));
```

Localizar e substituir em `POST /billing/checkout`:

```javascript
    // ANTES:
    const validPackages = [100, 250, 500];
    if (!validPackages.includes(Number(credits))) {
```

Por:

```javascript
    // DEPOIS:
    if (!VALID_CREDIT_PACKAGES.includes(Number(credits))) {
```

- [ ] **Step 4: Verificar que o servidor sobe sem erro**

```bash
docker compose restart api && docker compose logs api --tail 20
```

Esperado: `Fastify is listening on port 3000` (sem `Cannot find module` ou erros de referência).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/constants.js apps/api/src/routes/auth.js apps/api/src/routes/billing.js
git commit -m "refactor(api): centralize VALID_DOCTOR_SPECIALTIES, VALID_AGENT_TYPES, VALID_CREDIT_PACKAGES in constants.js"
```

---

## Task 7: Embedding Model via Variável de Ambiente

**Arquivos:**
- Modificar: `apps/api/src/routes/chat.js`
- Modificar: `apps/worker/src/rag/embedder.js`
- Modificar: `.env` (adicionar variável, não commitar se sensível)

- [ ] **Step 1: Verificar o embedder.js do worker**

```bash
cat /home/rodrigonoma/GenomaFlow/apps/worker/src/rag/embedder.js
```

Localizar onde o modelo é hardcoded (`'text-embedding-3-small'` ou similar).

- [ ] **Step 2: Atualizar chat.js**

Em `apps/api/src/routes/chat.js`, linha 90, substituir:

```javascript
      const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: question.trim().slice(0, 8000)
      });
```

Por:

```javascript
      const res = await openai.embeddings.create({
        model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
        input: question.trim().slice(0, 8000)
      });
```

- [ ] **Step 3: Atualizar embedder.js do worker com o mesmo padrão**

Localizar o `model:` hardcoded no embedder.js do worker e substituir por `process.env.EMBEDDING_MODEL || 'text-embedding-3-small'`.

- [ ] **Step 4: Adicionar variável ao .env (documentação)**

Adicionar ao `.env` a linha (valor padrão, pode ser sobrescrito em prod):

```
EMBEDDING_MODEL=text-embedding-3-small
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/chat.js apps/worker/src/rag/embedder.js .env
git commit -m "fix(rag): use EMBEDDING_MODEL env var instead of hardcoded model name"
```

---

## Task 8: WebSocket Heartbeat (Ping/Pong)

**Arquivos:**
- Modificar: `apps/api/src/plugins/pubsub.js`
- Modificar: `apps/web/src/app/core/ws/ws.service.ts`

### Contexto
Sem ping/pong, conexões WebSocket "fantasma" (cliente morreu, servidor não sabe) acumulam na memória do servidor. O servidor deve enviar `ping` periodicamente; cliente que não responde com `pong` é desconectado.

- [ ] **Step 1: Ler pubsub.js para entender estrutura atual**

```bash
cat apps/api/src/plugins/pubsub.js
```

- [ ] **Step 2: Adicionar heartbeat no pubsub.js do servidor**

Localizar onde o cliente WS é registrado e adicionar lógica de ping. Adicionar logo após o registro do cliente WebSocket:

```javascript
// Logo após: fastify.registerWsClient(tenantId, connection.socket)
// Adicionar heartbeat
connection.socket.isAlive = true;
connection.socket.on('pong', () => { connection.socket.isAlive = true; });
```

No registro do plugin, adicionar o intervalo de ping global (fora do handler de conexão mas dentro do `fastify.register`):

```javascript
const heartbeat = setInterval(() => {
  fastify.wsClients?.forEach((sockets, tenantId) => {
    sockets.forEach((socket, i) => {
      if (!socket.isAlive) {
        socket.terminate();
        sockets.splice(i, 1);
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
    if (sockets.length === 0) fastify.wsClients.delete(tenantId);
  });
}, 30_000);

fastify.addHook('onClose', () => clearInterval(heartbeat));
```

**Nota:** Adaptar ao padrão exato do `pubsub.js` atual — `wsClients` pode ser um Map ou outro tipo. Verificar a estrutura antes de aplicar.

- [ ] **Step 3: Adicionar handler de ping no WsService do Angular**

Em `apps/web/src/app/core/ws/ws.service.ts`, dentro de `openConnection()`, adicionar após `this.ws.onopen`:

```typescript
    this.ws.onmessage = (event) => {
      // Se for ping do servidor (string literal 'ping'), responder com pong
      if (event.data === 'ping') {
        this.ws?.send('pong');
        return;
      }
      // ... código existente de parse de mensagens
    };
```

**Nota:** O protocolo WebSocket nativo do browser suporta frames de ping/pong automaticamente no nível de protocolo. O servidor pode usar `socket.ping()` e o browser responde com `pong` automaticamente. O handler acima é apenas para pings enviados como mensagem de texto, se o servidor usar esse padrão.

- [ ] **Step 4: Verificar que WebSocket ainda conecta após a mudança**

```bash
docker compose restart api
```

Abrir o app no browser, verificar no Network inspector que conexão WS está estabelecida e que não há erros no console.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/plugins/pubsub.js apps/web/src/app/core/ws/ws.service.ts
git commit -m "feat(ws): add ping/pong heartbeat to detect and close phantom WebSocket connections"
```

---

## Task 9: HTTPS Redirect no nginx

**Arquivos:**
- Modificar: `apps/web/nginx.conf`

### Contexto
O nginx atual serve apenas na porta 80 (HTTP). Em produção (AWS), o TLS é terminado no ALB (Application Load Balancer), então o redirect HTTP→HTTPS deve ser feito no ALB, não no nginx. **Verificar com o usuário se o ALB já faz o redirect antes de alterar o nginx.**

- [ ] **Step 1: Verificar a configuração atual**

```bash
cat apps/web/nginx.conf
```

- [ ] **Step 2: Se TLS é terminado no ALB (cenário AWS típico)**

O ALB já redireciona HTTP→HTTPS. O nginx recebe apenas HTTPS (forwarded). Adicionar redirecionamento baseado no header `X-Forwarded-Proto`:

```nginx
# Adicionar dentro do bloco server { } existente, antes dos location blocks:
if ($http_x_forwarded_proto = "http") {
    return 301 https://$host$request_uri;
}
```

- [ ] **Step 3: Se nginx é o ponto de entrada diretamente (sem ALB)**

Adicionar um bloco server separado para a porta 80:

```nginx
server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}
```

E garantir que o bloco principal serve na porta 443 com SSL configurado.

- [ ] **Step 4: Verificar que a config é válida**

```bash
docker compose exec web nginx -t
```

Esperado: `nginx: configuration file /etc/nginx/nginx.conf test is successful`

- [ ] **Step 5: Commit**

```bash
git add apps/web/nginx.conf
git commit -m "fix(nginx): add HTTP to HTTPS redirect"
```

---

## Checklist Final — Antes do PR

- [ ] Todos os 9 commits da feature branch foram criados
- [ ] `docker compose up` sobe sem erros
- [ ] Login master funciona com nova senha (Task 5)
- [ ] `POST /auth/activate` retorna 404 (Task 2)
- [ ] Rate limit retorna 429 após 10 tentativas de login (Task 4)
- [ ] Banco tem RLS ativo em `users`, `treatment_items`, `owners`, `treatment_plans` (Task 1)
- [ ] Nenhum erro 500 em qualquer endpoint testado

---

## Sequência de Execução Recomendada

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9
```

Tasks 1 e 2 devem vir antes das demais por criarem a base (RLS + rotas seguras) que as tasks seguintes assumem como correta.
