# Chat Entre Tenants V1 — Fase 2 (API endpoints) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a camada HTTP do chat entre tenants — ~22 endpoints REST sob `/inter-tenant-chat`, todos autenticados, sob rate limiting apropriado, usando os helpers `withTenant` e `withConversationAccess` da Fase 1, com defesa em profundidade (filtro tenant_id explícito) e cobertura de testes via supertest contra o servidor Fastify.

**Architecture:** Um arquivo por sub-recurso (`apps/api/src/routes/inter-tenant-chat/{settings,directory,invitations,blocks,conversations,messages,reads}.js`). Um plugin Fastify topo (`apps/api/src/routes/inter-tenant-chat/index.js`) registra os sub-arquivos. Body validation manual no padrão do projeto (não usa schema declarativo). Erros mapeados para 400/401/403/404/409/429 conforme o caso. Rate limit por endpoint via `config.rateLimit`. Toda query inclui `AND tenant_id = $X` explícito ainda que RLS faça o backstop.

**Tech Stack:** Node.js + Fastify (já no projeto), `pg` (já), `@fastify/rate-limit` (já), Jest + supertest (já). Zero dependências novas.

**Branch:** `feat/chat-phase2-api`

**Spec:** `docs/superpowers/specs/2026-04-23-inter-tenant-chat-design.md` §7 + §12 (anti-abuso)

**Estado de partida:** Phase 1 mergeada na main. Migração 047 viva em prod com 10 tabelas + RLS + helpers. `withTenant` e `withConversationAccess` disponíveis no backend.

---

## Convenções

- **Prefixo:** `/inter-tenant-chat` (registrado em `apps/api/src/server.js`)
- **Auth:** `preHandler: [fastify.authenticate]` em TODA rota; após auth, validar `request.user.role === 'admin'` (master cai pra 403 — chat entre clínicas é admin-only por enquanto)
- **Defesa em profundidade:** toda query SELECT/UPDATE/DELETE em tabela tenant-scoped deve incluir `AND tenant_id = $X` explícito mesmo dentro de `withTenant` ou `withConversationAccess`
- **Erros:** retornar `{ error: 'mensagem em pt-br' }`; status code semântico (400 validação, 401 auth, 403 ACL, 404 not found, 409 conflito, 429 rate limit)
- **Status codes para POST que cria recurso:** 201
- **Status codes para mutação sem retorno semântico:** 204
- **Validação de body:** rejeitar campos faltantes/tipo errado com 400 antes de tocar no DB
- **Logs:** usar `request.log.info/warn/error` quando relevante (já vem do fastify pino)
- **Não fazer:** breaking change em rotas existentes; novos plugins; novas dependências

---

## File Structure

**Create:**
- `apps/api/src/db/migrations/048_chat_invitation_with_check.sql` (Task 0 — fix do NOTE-1 da revisão final da Phase 1)
- `apps/api/src/routes/inter-tenant-chat/index.js` — plugin que registra os sub-arquivos
- `apps/api/src/routes/inter-tenant-chat/settings.js`
- `apps/api/src/routes/inter-tenant-chat/directory.js`
- `apps/api/src/routes/inter-tenant-chat/invitations.js`
- `apps/api/src/routes/inter-tenant-chat/blocks.js`
- `apps/api/src/routes/inter-tenant-chat/conversations.js`
- `apps/api/src/routes/inter-tenant-chat/messages.js`
- `apps/api/src/routes/inter-tenant-chat/reads.js`
- `apps/api/tests/routes/inter-tenant-chat/settings.test.js`
- `apps/api/tests/routes/inter-tenant-chat/directory.test.js`
- `apps/api/tests/routes/inter-tenant-chat/invitations.test.js`
- `apps/api/tests/routes/inter-tenant-chat/blocks.test.js`
- `apps/api/tests/routes/inter-tenant-chat/conversations.test.js`
- `apps/api/tests/routes/inter-tenant-chat/messages.test.js`
- `apps/api/tests/routes/inter-tenant-chat/reads.test.js`
- `apps/api/tests/routes/inter-tenant-chat/fixtures.js` — helpers para criar tenant+token JWT, par convidado-aceito, etc.

**Modify:**
- `apps/api/src/server.js` (linha ~50 — adicionar `fastify.register(require('./routes/inter-tenant-chat'), { prefix: '/inter-tenant-chat' });`)

---

## Pre-flight Checks

- [ ] **Step 0.1: Branch from latest main**
  ```bash
  git checkout main
  git pull --ff-only origin main
  git checkout -b feat/chat-phase2-api
  ```

- [ ] **Step 0.2: Verify Phase 1 schema is in dev DB**
  ```bash
  docker compose exec -T db psql -U postgres -d genomaflow -c "\dt tenant_chat*" 2>&1 | tail -10
  ```
  Expected: 10 tables (tenant_chat_settings, tenant_invitations, etc.)

- [ ] **Step 0.3: Verify last applied migration**
  ```bash
  docker compose exec -T db psql -U postgres -d genomaflow -c "SELECT filename FROM _migrations ORDER BY filename DESC LIMIT 3;"
  ```
  Expected: `047_inter_tenant_chat.sql` is most recent.

- [ ] **Step 0.4: Run Phase 1 tests pra confirmar nada quebrado:**
  ```bash
  cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/db/ 2>&1 | tail -10
  ```
  Expected: 49/49 PASS.

---

## Task 0: Migration 048 — fix `ti_update` WITH CHECK (NOTE-1 da Phase 1)

Pequena migration aditiva consertando uma inconsistência apontada no review final da Phase 1: a policy `ti_update` (UPDATE em `tenant_invitations`) tinha apenas `USING` sem `WITH CHECK`. Funcionalmente segura hoje porque PostgreSQL aplica USING ao novo row, mas inconsistente com as demais UPDATE policies da fase.

**Files:** `apps/api/src/db/migrations/048_chat_invitation_with_check.sql`

- [ ] **Step 0.5: Criar a migration**

Create `apps/api/src/db/migrations/048_chat_invitation_with_check.sql`:

```sql
-- Migration 048: completa WITH CHECK na policy ti_update
-- (NOTE-1 do review final da Phase 1 do chat entre tenants)
--
-- A policy original tinha apenas USING, o que é funcionalmente seguro hoje
-- porque o Postgres aplica USING ao row pós-UPDATE, mas inconsistente com
-- as outras UPDATE policies da fase (tc_update, tm_update, tcs_update, etc.)
-- que têm USING + WITH CHECK explícitos.

DROP POLICY IF EXISTS ti_update ON tenant_invitations;
CREATE POLICY ti_update ON tenant_invitations FOR UPDATE
  USING (
    from_tenant_id = current_setting('app.tenant_id', true)::uuid OR
    to_tenant_id   = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    from_tenant_id = current_setting('app.tenant_id', true)::uuid OR
    to_tenant_id   = current_setting('app.tenant_id', true)::uuid
  );
```

- [ ] **Step 0.6: Aplicar nos dois bancos**

```bash
docker compose exec api node src/db/migrate.js 2>&1 | tail -5
docker cp apps/api/src/db/migrations/048_chat_invitation_with_check.sql genomaflow-db-1:/tmp/048.sql
docker compose exec -T db psql -U postgres -d genomaflow_test -f /tmp/048.sql 2>&1 | tail -5
```

Expected: `[migrate] Applied 048_chat_invitation_with_check.sql` no Docker; `DROP POLICY` + `CREATE POLICY` no test DB. Sem erros.

- [ ] **Step 0.7: Confirmar via DB que `ti_update` agora tem polwithcheck não-nulo**

```bash
docker compose exec -T db psql -U postgres -d genomaflow -c "SELECT polname, polcmd, polwithcheck IS NOT NULL AS has_check FROM pg_policy WHERE polname = 'ti_update';"
```

Expected: `has_check = t`.

- [ ] **Step 0.8: Commit**

```bash
git add apps/api/src/db/migrations/048_chat_invitation_with_check.sql
git commit -m "fix(chat): WITH CHECK na policy ti_update (NOTE-1 review Phase 1)

Consistência com as demais UPDATE policies da fase 1 que já têm
USING + WITH CHECK explícitos. Funcionalmente seguro antes (Postgres
aplica USING ao row pós-UPDATE), mas vulnerável a refactors futuros
que mudem USING e esqueçam de propagar a invariante."
```

---

## Task 1: Plugin esqueleto + integração no server

Cria o ponto de entrada `inter-tenant-chat/index.js` que registra os sub-recursos, e plumba ele no `server.js`. Sem nenhuma rota real ainda.

**Files:**
- Create: `apps/api/src/routes/inter-tenant-chat/index.js`
- Create: `apps/api/tests/routes/inter-tenant-chat/fixtures.js`
- Modify: `apps/api/src/server.js`

- [ ] **Step 1.1: Criar `apps/api/src/routes/inter-tenant-chat/index.js`**

```javascript
/**
 * Plugin raiz do chat entre tenants. Registra os sub-recursos sob /inter-tenant-chat.
 *
 * Spec: docs/superpowers/specs/2026-04-23-inter-tenant-chat-design.md
 * Plano Phase 2: docs/superpowers/plans/2026-04-23-inter-tenant-chat-phase2.md
 */
module.exports = async function (fastify) {
  fastify.register(require('./settings'),      { prefix: '/settings' });
  fastify.register(require('./directory'),     { prefix: '/directory' });
  fastify.register(require('./invitations'),   { prefix: '/invitations' });
  fastify.register(require('./blocks'),        { prefix: '/blocks' });
  fastify.register(require('./conversations'), { prefix: '/conversations' });
  fastify.register(require('./messages'),      { prefix: '' });  // /messages/* embaixo de /conversations
  fastify.register(require('./reads'),         { prefix: '' });  // POST /conversations/:id/read
};
```

(messages e reads compartilham prefixos com `/conversations/:id/...` — registramos sem prefix adicional e cada arquivo declara o path completo.)

- [ ] **Step 1.2: Criar stubs vazios dos sub-arquivos**

Para cada sub-recurso, criar arquivo vazio com export válido:

```javascript
// settings.js, directory.js, invitations.js, blocks.js,
// conversations.js, messages.js, reads.js — todos:
module.exports = async function (fastify) {
  // routes registradas nas tasks seguintes
};
```

(Sem isso o `register` em index.js falha por modulo não existir.)

- [ ] **Step 1.3: Registrar no server.js**

**Edit** `apps/api/src/server.js`. Encontre o bloco `app.register((fastify, _opts, done) => { ... })` (~linha 27-44) e adicione no final dos `fastify.register` de rotas (antes do `done()`):

```javascript
fastify.register(require('./routes/inter-tenant-chat'), { prefix: '/inter-tenant-chat' });
```

- [ ] **Step 1.4: Criar fixtures de teste**

Create `apps/api/tests/routes/inter-tenant-chat/fixtures.js`:

```javascript
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');

const PREFIX = 'chat-api-test-';
let pool;

function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
  return pool;
}

/**
 * Cria tenant + admin user + assina JWT válido pra esse user.
 * Retorna { tenantId, userId, email, token, module }.
 */
async function createTenantWithAdmin(app, { name, module = 'human' } = {}) {
  const p = getPool();
  const fullName = PREFIX + (name || 'T-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  const { rows: [t] } = await p.query(
    `INSERT INTO tenants (name, type, module, active) VALUES ($1, 'clinic', $2, true) RETURNING id`,
    [fullName, module]
  );
  const hash = await bcrypt.hash('test-pwd', 10);
  const email = `${PREFIX}${randomUUID().slice(0, 8)}@test.com`;
  const { rows: [u] } = await p.query(
    `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id`,
    [t.id, email, hash]
  );
  // Sign JWT identical ao /auth/login
  const jti = randomUUID();
  const token = app.jwt.sign({
    user_id: u.id,
    tenant_id: t.id,
    role: 'admin',
    module,
    jti,
  });
  // Single-session: salvar jti no redis
  if (app.redis) await app.redis.set(`session:${u.id}`, jti, 'EX', 3600);
  return { tenantId: t.id, userId: u.id, email, token, module };
}

/**
 * Cria 2 tenants do mesmo módulo já com convite aceito + conversation criada.
 * Retorna { a, b, conversationId }.
 */
async function createConversedPair(app, { module = 'human' } = {}) {
  const p = getPool();
  const a = await createTenantWithAdmin(app, { module });
  const b = await createTenantWithAdmin(app, { module });
  // canonical pair
  const [low, high] = a.tenantId < b.tenantId ? [a, b] : [b, a];
  const { rows: [conv] } = await p.query(
    `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module) VALUES ($1, $2, $3) RETURNING id`,
    [low.tenantId, high.tenantId, module]
  );
  return { a, b, conversationId: conv.id };
}

async function cleanup() {
  const p = getPool();
  // FK-safe order
  await p.query(`DELETE FROM tenant_message_reactions WHERE reactor_tenant_id IN (SELECT id FROM tenants WHERE name LIKE $1)`, [PREFIX + '%']);
  await p.query(`DELETE FROM tenant_messages WHERE sender_tenant_id IN (SELECT id FROM tenants WHERE name LIKE $1)`, [PREFIX + '%']);
  await p.query(`DELETE FROM tenant_conversation_reads WHERE tenant_id IN (SELECT id FROM tenants WHERE name LIKE $1)`, [PREFIX + '%']);
  await p.query(`DELETE FROM tenants WHERE name LIKE $1`, [PREFIX + '%']);
}

async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { PREFIX, getPool, createTenantWithAdmin, createConversedPair, cleanup, closePool };
```

- [ ] **Step 1.5: Criar smoke test do plugin**

Create `apps/api/tests/routes/inter-tenant-chat/settings.test.js` (vai ser populado de verdade na Task 2; por agora só prova que o plugin carrega):

```javascript
const supertest = require('supertest');
const app = require('../../../src/server');

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });

describe('Inter-tenant chat plugin smoke', () => {
  it('rota /inter-tenant-chat/settings existe (responde 401 sem auth)', async () => {
    const res = await supertest(app.server).get('/inter-tenant-chat/settings');
    expect([401, 404]).toContain(res.status);
    // 404 aceito enquanto o GET /settings ainda não foi implementado;
    // 401 quando estiver implementado e sem auth.
  });
});
```

- [ ] **Step 1.6: Rodar smoke test**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/inter-tenant-chat/settings.test.js 2>&1 | tail -10
```

Expected: PASS. Se der `Cannot find module './settings'`, faltou criar os stubs em Step 1.2.

- [ ] **Step 1.7: Commit**

```bash
git add apps/api/src/routes/inter-tenant-chat/ apps/api/src/server.js apps/api/tests/routes/inter-tenant-chat/fixtures.js apps/api/tests/routes/inter-tenant-chat/settings.test.js
git commit -m "feat(chat): plugin esqueleto + fixtures de teste para Phase 2

Cria apps/api/src/routes/inter-tenant-chat/ com index.js que registra
os 7 sub-recursos (settings, directory, invitations, blocks,
conversations, messages, reads). Sub-arquivos como stubs vazios
— rotas reais entram nas tasks seguintes. Registrado em server.js
sob prefix /inter-tenant-chat."
```

---

## Task 2: Settings — `GET /settings`, `PUT /settings`

3 endpoints (incluindo um `POST` para criar settings se não existir, ou tratar PUT como upsert).

**Endpoints:**
| Método | Path | Descrição |
|---|---|---|
| GET | `/inter-tenant-chat/settings` | Retorna settings do tenant atual; cria com defaults se não existir |
| PUT | `/inter-tenant-chat/settings` | Atualiza settings (upsert) |

**Body do PUT:**
```json
{
  "visible_in_directory": true,
  "notify_on_invite_email": true,
  "notify_on_message_email": false,
  "message_email_quiet_after_minutes": 30
}
```

Todos os campos opcionais — o handler aplica somente os que vêm.

**Files:**
- Modify: `apps/api/src/routes/inter-tenant-chat/settings.js`
- Modify: `apps/api/tests/routes/inter-tenant-chat/settings.test.js`

- [ ] **Step 2.1: Escrever testes**

Substituir o conteúdo de `apps/api/tests/routes/inter-tenant-chat/settings.test.js` por uma suíte completa (~6 testes):

```javascript
const supertest = require('supertest');
const app = require('../../../src/server');
const fixtures = require('./fixtures');
const { withTenant } = require('../../../src/db/tenant');

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await fixtures.closePool(); await app.close(); });
afterEach(() => fixtures.cleanup());

describe('GET /inter-tenant-chat/settings', () => {
  it('401 sem token', async () => {
    const res = await supertest(app.server).get('/inter-tenant-chat/settings');
    expect(res.status).toBe(401);
  });

  it('403 para role master (chat é admin-only V1)', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    const masterToken = app.jwt.sign({ user_id: t.userId, tenant_id: t.tenantId, role: 'master', module: 'human', jti: 'fake-master-jti' });
    if (app.redis) await app.redis.set(`session:${t.userId}`, 'fake-master-jti', 'EX', 60);
    const res = await supertest(app.server).get('/inter-tenant-chat/settings').set('Authorization', `Bearer ${masterToken}`);
    expect(res.status).toBe(403);
  });

  it('cria settings com defaults se não existir', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server).get('/inter-tenant-chat/settings').set('Authorization', `Bearer ${t.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      visible_in_directory: false,
      notify_on_invite_email: true,
      notify_on_message_email: false,
      message_email_quiet_after_minutes: 30,
    });
  });

  it('retorna settings existentes', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    await withTenant(fixtures.getPool(), t.tenantId, c => c.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)`,
      [t.tenantId]
    ));
    const res = await supertest(app.server).get('/inter-tenant-chat/settings').set('Authorization', `Bearer ${t.token}`);
    expect(res.status).toBe(200);
    expect(res.body.visible_in_directory).toBe(true);
  });
});

describe('PUT /inter-tenant-chat/settings', () => {
  it('atualiza visible_in_directory e dispara trigger de diretório', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .put('/inter-tenant-chat/settings')
      .set('Authorization', `Bearer ${t.token}`)
      .send({ visible_in_directory: true });
    expect(res.status).toBe(200);
    expect(res.body.visible_in_directory).toBe(true);

    // Trigger sync_tenant_directory deve ter inserido linha em directory_listing
    const { rows } = await fixtures.getPool().query(
      `SELECT 1 FROM tenant_directory_listing WHERE tenant_id = $1`, [t.tenantId]
    );
    expect(rows.length).toBe(1);
  });

  it('400 com payload inválido (tipo errado)', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .put('/inter-tenant-chat/settings')
      .set('Authorization', `Bearer ${t.token}`)
      .send({ visible_in_directory: 'sim' });  // string não bool
    expect(res.status).toBe(400);
  });

  it('400 para message_email_quiet_after_minutes negativo', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .put('/inter-tenant-chat/settings')
      .set('Authorization', `Bearer ${t.token}`)
      .send({ message_email_quiet_after_minutes: -5 });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2.2: Rodar testes — devem falhar (rotas ainda stubs)**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/inter-tenant-chat/settings.test.js 2>&1 | tail -15
```

Expected: vários FAIL — 401 onde esperamos 200/400, etc.

- [ ] **Step 2.3: Implementar `apps/api/src/routes/inter-tenant-chat/settings.js`**

```javascript
const { withTenant } = require('../../db/tenant');

const ADMIN_ONLY = async function (request, reply) {
  if (request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Chat entre tenants é restrito a admins.' });
  }
};

module.exports = async function (fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const row = await withTenant(fastify.pg, tenant_id, async (client) => {
      let { rows } = await client.query(
        `SELECT tenant_id, visible_in_directory, notify_on_invite_email,
                notify_on_message_email, message_email_quiet_after_minutes,
                created_at, updated_at
         FROM tenant_chat_settings
         WHERE tenant_id = $1`,
        [tenant_id]
      );
      if (rows.length === 0) {
        const ins = await client.query(
          `INSERT INTO tenant_chat_settings (tenant_id) VALUES ($1)
           RETURNING tenant_id, visible_in_directory, notify_on_invite_email,
                     notify_on_message_email, message_email_quiet_after_minutes,
                     created_at, updated_at`,
          [tenant_id]
        );
        rows = ins.rows;
      }
      return rows[0];
    });
    return row;
  });

  fastify.put('/', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const body = request.body || {};

    // Validação de tipos
    const fields = {};
    for (const k of ['visible_in_directory', 'notify_on_invite_email', 'notify_on_message_email']) {
      if (k in body) {
        if (typeof body[k] !== 'boolean') return reply.status(400).send({ error: `${k} deve ser boolean` });
        fields[k] = body[k];
      }
    }
    if ('message_email_quiet_after_minutes' in body) {
      const n = body.message_email_quiet_after_minutes;
      if (!Number.isInteger(n) || n < 0 || n > 1440) {
        return reply.status(400).send({ error: 'message_email_quiet_after_minutes deve ser inteiro 0..1440' });
      }
      fields.message_email_quiet_after_minutes = n;
    }

    if (Object.keys(fields).length === 0) {
      return reply.status(400).send({ error: 'Nenhum campo válido enviado.' });
    }

    const cols = ['tenant_id', ...Object.keys(fields)];
    const vals = [tenant_id, ...Object.values(fields)];
    const params = vals.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = Object.keys(fields).map((k, i) => `${k} = $${i + 2}`).join(', ');

    const row = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO tenant_chat_settings (${cols.join(', ')})
         VALUES (${params})
         ON CONFLICT (tenant_id) DO UPDATE SET ${updateSet}, updated_at = NOW()
         WHERE tenant_chat_settings.tenant_id = $1
         RETURNING tenant_id, visible_in_directory, notify_on_invite_email,
                   notify_on_message_email, message_email_quiet_after_minutes,
                   updated_at`,
        vals
      );
      return rows[0];
    });
    return row;
  });
};
```

- [ ] **Step 2.4: Rodar testes — devem passar**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/inter-tenant-chat/settings.test.js 2>&1 | tail -10
```

Expected: ~7 PASS.

- [ ] **Step 2.5: Commit**

```bash
git add apps/api/src/routes/inter-tenant-chat/settings.js apps/api/tests/routes/inter-tenant-chat/settings.test.js
git commit -m "feat(chat): GET/PUT /inter-tenant-chat/settings

GET cria com defaults se não existir. PUT é upsert com validação
de tipos. Acionar visible_in_directory=true dispara o trigger de
sincronização do diretório (Phase 1). Admin-only (role=admin);
master cai em 403."
```

---

## Task 3: Directory — `GET /directory` com filtros + busca

1 endpoint com query params `module` (forçado pro do user), `uf`, `specialty`, `q` (search por nome via trigram), paginação `page` + `page_size`.

**Files:**
- Modify: `apps/api/src/routes/inter-tenant-chat/directory.js`
- Create: `apps/api/tests/routes/inter-tenant-chat/directory.test.js`

- [ ] **Step 3.1: Escrever testes**

Create `apps/api/tests/routes/inter-tenant-chat/directory.test.js`:

```javascript
const supertest = require('supertest');
const app = require('../../../src/server');
const fixtures = require('./fixtures');
const { withTenant } = require('../../../src/db/tenant');

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await fixtures.closePool(); await app.close(); });
afterEach(() => fixtures.cleanup());

async function makeVisible(tenantId) {
  await withTenant(fixtures.getPool(), tenantId, c => c.query(
    `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)
     ON CONFLICT (tenant_id) DO UPDATE SET visible_in_directory = true`, [tenantId]
  ));
}

describe('GET /inter-tenant-chat/directory', () => {
  it('401 sem token', async () => {
    const res = await supertest(app.server).get('/inter-tenant-chat/directory');
    expect(res.status).toBe(401);
  });

  it('lista clínicas opt-in do mesmo módulo do user', async () => {
    const me = await fixtures.createTenantWithAdmin(app, { module: 'human' });
    const other = await fixtures.createTenantWithAdmin(app, { module: 'human' });
    const otherModule = await fixtures.createTenantWithAdmin(app, { module: 'veterinary' });
    await makeVisible(other.tenantId);
    await makeVisible(otherModule.tenantId);

    const res = await supertest(app.server).get('/inter-tenant-chat/directory').set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toBeInstanceOf(Array);
    const ids = res.body.results.map(r => r.tenant_id);
    expect(ids).toContain(other.tenantId);
    expect(ids).not.toContain(otherModule.tenantId);  // cross-module bloqueado
  });

  it('respeita filtro por uf (NOT IMPLEMENTED yet — settings region not in V1 settings PUT)', async () => {
    // Para V1 region_uf é setado via outra rota futura. Aqui só validamos que filtro não quebra.
    const me = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server).get('/inter-tenant-chat/directory?uf=SP').set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toBeInstanceOf(Array);
  });

  it('busca por nome (q) usa trigram', async () => {
    const me = await fixtures.createTenantWithAdmin(app);
    const t1 = await fixtures.createTenantWithAdmin(app, { name: 'Cardiologia-' + Date.now() });
    const t2 = await fixtures.createTenantWithAdmin(app, { name: 'Pediatria-' + Date.now() });
    await makeVisible(t1.tenantId);
    await makeVisible(t2.tenantId);

    const res = await supertest(app.server).get('/inter-tenant-chat/directory?q=cardio').set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.results.map(r => r.tenant_id);
    expect(ids).toContain(t1.tenantId);
    expect(ids).not.toContain(t2.tenantId);
  });

  it('paginação respeita page e page_size', async () => {
    const me = await fixtures.createTenantWithAdmin(app);
    for (let i = 0; i < 5; i++) {
      const x = await fixtures.createTenantWithAdmin(app);
      await makeVisible(x.tenantId);
    }
    const res = await supertest(app.server).get('/inter-tenant-chat/directory?page=1&page_size=2').set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(2);
    expect(res.body.page).toBe(1);
    expect(res.body.page_size).toBe(2);
  });
});
```

- [ ] **Step 3.2: Rodar tests — fail**
- [ ] **Step 3.3: Implementar `apps/api/src/routes/inter-tenant-chat/directory.js`**

```javascript
const { withTenant } = require('../../db/tenant');

const ADMIN_ONLY = async function (request, reply) {
  if (request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Chat entre tenants é restrito a admins.' });
  }
};

module.exports = async function (fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id, module: userModule } = request.user;
    const { uf, specialty, q } = request.query || {};
    const page = Math.max(1, parseInt(request.query?.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(request.query?.page_size) || 20));
    const offset = (page - 1) * pageSize;

    const wheres = [`module = $1`];
    const params = [userModule];
    let idx = 2;

    if (uf && /^[A-Z]{2}$/i.test(uf)) {
      wheres.push(`region_uf = $${idx++}`);
      params.push(uf.toUpperCase());
    }
    if (specialty && typeof specialty === 'string') {
      wheres.push(`$${idx++} = ANY(specialties)`);
      params.push(specialty);
    }
    if (q && typeof q === 'string' && q.trim().length > 0) {
      // pg_trgm similarity > 0.1 (low threshold) OR ILIKE
      wheres.push(`(name ILIKE $${idx} OR similarity(name, $${idx}) > 0.1)`);
      params.push('%' + q.trim() + '%');
      idx++;
    }

    // Self-exclude (não mostrar própria clínica)
    wheres.push(`tenant_id <> $${idx++}`);
    params.push(tenant_id);

    const whereSql = wheres.join(' AND ');
    const sql = `
      SELECT tenant_id, name, module, region_uf, region_city, specialties, last_active_month
      FROM tenant_directory_listing
      WHERE ${whereSql}
      ORDER BY name ASC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    params.push(pageSize, offset);

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(sql, params);
      return rows;
    });

    return { results: result, page, page_size: pageSize };
  });
};
```

- [ ] **Step 3.4: Rodar tests — pass**
- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/routes/inter-tenant-chat/directory.js apps/api/tests/routes/inter-tenant-chat/directory.test.js
git commit -m "feat(chat): GET /inter-tenant-chat/directory com filtros + paginação

Filtros: module (forçado para o do user via JWT), uf, specialty,
q (trigram + ILIKE). Paginação por page + page_size (max 50).
Self-exclude do próprio tenant. Admin-only."
```

---

## Task 4: Invitations — 5 endpoints com rate limit

**Endpoints:**
| Método | Path | Descrição |
|---|---|---|
| GET | `/invitations?direction=incoming\|outgoing` | Lista convites do tenant atual |
| POST | `/invitations` | Cria convite. Rate limit 20/dia. Auto-cooldown se 3 rejeições do mesmo destinatário |
| POST | `/invitations/:id/accept` | Destinatário aceita. Cria conversation no mesmo passo |
| POST | `/invitations/:id/reject` | Destinatário rejeita |
| DELETE | `/invitations/:id` | Sender cancela (só status pending) |

**Rate limit POST /invitations:** 20 por dia por tenant. Implementar via `@fastify/rate-limit`'s `keyGenerator` retornando o `tenant_id` quando autenticado.

**Auto-cooldown:** se o mesmo `to_tenant_id` já tem 3+ convites do mesmo `from_tenant_id` com status `rejected` nos últimos 30 dias, retornar 429 com mensagem "Cooldown ativo: ..." sem criar novo convite.

**Files:**
- Modify: `apps/api/src/routes/inter-tenant-chat/invitations.js`
- Create: `apps/api/tests/routes/inter-tenant-chat/invitations.test.js`

- [ ] **Step 4.1: Escrever testes** (~10 testes cobrindo: list incoming/outgoing, post (sucesso + cross-module + duplicate pending + bloqueado + cooldown), accept (sucesso + cria conv + recipient correto), reject, cancel (só sender + só pending))

Create `apps/api/tests/routes/inter-tenant-chat/invitations.test.js`. Estrutura:

```javascript
const supertest = require('supertest');
const app = require('../../../src/server');
const fixtures = require('./fixtures');

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await fixtures.closePool(); await app.close(); });
afterEach(() => fixtures.cleanup());

describe('POST /inter-tenant-chat/invitations', () => {
  it('201 cria convite pending', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId, message: 'Olá!' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('pending');
  });

  it('400 sem to_tenant_id', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('400 para tenant cross-module', async () => {
    const a = await fixtures.createTenantWithAdmin(app, { module: 'human' });
    const b = await fixtures.createTenantWithAdmin(app, { module: 'veterinary' });
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    expect(res.status).toBe(400);
  });

  it('409 se já tem convite pending para o mesmo destinatário', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    await supertest(app.server).post('/inter-tenant-chat/invitations').set('Authorization', `Bearer ${a.token}`).send({ to_tenant_id: b.tenantId });
    const res = await supertest(app.server).post('/inter-tenant-chat/invitations').set('Authorization', `Bearer ${a.token}`).send({ to_tenant_id: b.tenantId });
    expect(res.status).toBe(409);
  });

  it('429 se destinatário bloqueou o sender', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    await fixtures.getPool().query(
      `INSERT INTO tenant_blocks (blocker_tenant_id, blocked_tenant_id) VALUES ($1, $2)`,
      [b.tenantId, a.tenantId]
    );
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    // 429 pra não revelar que o destinatário bloqueou (anti-enumeração)
    expect([403, 429]).toContain(res.status);
  });

  // ... (continua com os demais cenários)
});

describe('GET /inter-tenant-chat/invitations', () => {
  it('lista incoming', async () => { /* ... */ });
  it('lista outgoing', async () => { /* ... */ });
});

describe('POST /inter-tenant-chat/invitations/:id/accept', () => {
  it('cria conversation e marca convite como accepted', async () => { /* ... */ });
  it('403 se não é o destinatário', async () => { /* ... */ });
  it('400 se já não está pending', async () => { /* ... */ });
});

describe('POST /inter-tenant-chat/invitations/:id/reject', () => {
  it('marca como rejected', async () => { /* ... */ });
});

describe('DELETE /inter-tenant-chat/invitations/:id', () => {
  it('204 cancela se sender e pending', async () => { /* ... */ });
  it('403 se não sender', async () => { /* ... */ });
});
```

(Implementador: complete os "..." seguindo o padrão dos outros testes. Mínimo 10 testes total.)

- [ ] **Step 4.2: Implementar `apps/api/src/routes/inter-tenant-chat/invitations.js`**

```javascript
const { withTenant } = require('../../db/tenant');

const ADMIN_ONLY = async function (request, reply) {
  if (request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Chat entre tenants é restrito a admins.' });
  }
};

const COOLDOWN_REJECTIONS = 3;
const COOLDOWN_DAYS = 30;

module.exports = async function (fastify) {
  // GET /invitations?direction=incoming|outgoing
  fastify.get('/', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const direction = request.query?.direction === 'outgoing' ? 'outgoing' : 'incoming';
    const colFilter = direction === 'incoming' ? 'to_tenant_id' : 'from_tenant_id';

    const rows = await withTenant(fastify.pg, tenant_id, async (client) => {
      const r = await client.query(
        `SELECT i.id, i.from_tenant_id, i.to_tenant_id, i.module, i.status, i.message,
                i.sent_at, i.responded_at,
                ft.name AS from_tenant_name, tt.name AS to_tenant_name
         FROM tenant_invitations i
         JOIN tenants ft ON ft.id = i.from_tenant_id
         JOIN tenants tt ON tt.id = i.to_tenant_id
         WHERE i.${colFilter} = $1
         ORDER BY i.sent_at DESC
         LIMIT 100`,
        [tenant_id]
      );
      return r.rows;
    });
    return { results: rows };
  });

  // POST /invitations  — rate limit 20/dia por tenant
  fastify.post('/', {
    preHandler: [fastify.authenticate, ADMIN_ONLY],
    config: { rateLimit: {
      max: 20, timeWindow: '24 hours',
      keyGenerator: (req) => req.user?.tenant_id || req.ip,
    } }
  }, async (request, reply) => {
    const { tenant_id, user_id, module: senderModule } = request.user;
    const { to_tenant_id, message } = request.body || {};

    if (!to_tenant_id || typeof to_tenant_id !== 'string') {
      return reply.status(400).send({ error: 'to_tenant_id obrigatório' });
    }
    if (to_tenant_id === tenant_id) {
      return reply.status(400).send({ error: 'Não é possível convidar a própria clínica.' });
    }
    if (message != null && (typeof message !== 'string' || message.length > 500)) {
      return reply.status(400).send({ error: 'message deve ser string com até 500 chars' });
    }

    // 1. valida módulo do destinatário
    const { rows: targetRows } = await fastify.pg.query(
      `SELECT id, module, active FROM tenants WHERE id = $1`, [to_tenant_id]
    );
    if (targetRows.length === 0 || !targetRows[0].active) {
      return reply.status(404).send({ error: 'Clínica não encontrada.' });
    }
    if (targetRows[0].module !== senderModule) {
      return reply.status(400).send({ error: 'Cross-module proibido.' });
    }

    // 2. verifica bloqueio bilateral (qualquer direção)
    const { rows: blockRows } = await fastify.pg.query(
      `SELECT 1 FROM tenant_blocks
       WHERE (blocker_tenant_id = $1 AND blocked_tenant_id = $2)
          OR (blocker_tenant_id = $2 AND blocked_tenant_id = $1)`,
      [tenant_id, to_tenant_id]
    );
    if (blockRows.length > 0) {
      return reply.status(429).send({ error: 'Não foi possível enviar convite.' });
    }

    // 3. cooldown: 3+ rejeições do mesmo destinatário em 30 dias
    const { rows: cooldownRows } = await fastify.pg.query(
      `SELECT count(*)::int AS n FROM tenant_invitations
       WHERE from_tenant_id = $1 AND to_tenant_id = $2
         AND status = 'rejected'
         AND responded_at >= NOW() - INTERVAL '${COOLDOWN_DAYS} days'`,
      [tenant_id, to_tenant_id]
    );
    if (cooldownRows[0].n >= COOLDOWN_REJECTIONS) {
      return reply.status(429).send({ error: `Aguarde antes de convidar essa clínica novamente (${COOLDOWN_REJECTIONS} rejeições recentes).` });
    }

    // 4. insert (UNIQUE INDEX impede 2 pendings simultâneos)
    try {
      const inv = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO tenant_invitations
            (from_tenant_id, to_tenant_id, module, status, message, sent_by_user_id)
           VALUES ($1, $2, $3, 'pending', $4, $5)
           RETURNING id, from_tenant_id, to_tenant_id, module, status, message, sent_at`,
          [tenant_id, to_tenant_id, senderModule, message?.trim() || null, user_id]
        );
        return rows[0];
      });
      return reply.status(201).send(inv);
    } catch (err) {
      if (err.code === '23505') {  // unique violation
        return reply.status(409).send({ error: 'Já existe convite pendente para essa clínica.' });
      }
      throw err;
    }
  });

  // POST /:id/accept
  fastify.post('/:id/accept', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      // marca como accepted SE for o destinatário e ainda pending
      const { rows } = await client.query(
        `UPDATE tenant_invitations
         SET status = 'accepted', responded_at = NOW(), responded_by_user_id = $1
         WHERE id = $2 AND to_tenant_id = $3 AND status = 'pending'
         RETURNING id, from_tenant_id, to_tenant_id, module`,
        [user_id, id, tenant_id]
      );
      if (rows.length === 0) {
        return { code: 404 };
      }
      const inv = rows[0];

      // cria conversation no par canônico
      const [a, b] = inv.from_tenant_id < inv.to_tenant_id
        ? [inv.from_tenant_id, inv.to_tenant_id]
        : [inv.to_tenant_id, inv.from_tenant_id];
      const { rows: convRows } = await client.query(
        `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module, created_from_invitation_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_a_id, tenant_b_id) DO UPDATE SET created_from_invitation_id = EXCLUDED.created_from_invitation_id
         RETURNING id`,
        [a, b, inv.module, inv.id]
      );
      return { code: 201, body: { invitation_id: inv.id, conversation_id: convRows[0].id } };
    });

    if (result.code === 404) {
      return reply.status(404).send({ error: 'Convite não encontrado, não é seu, ou já não está pending.' });
    }
    return reply.status(result.code).send(result.body);
  });

  // POST /:id/reject
  fastify.post('/:id/reject', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;

    const updated = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE tenant_invitations
         SET status = 'rejected', responded_at = NOW(), responded_by_user_id = $1
         WHERE id = $2 AND to_tenant_id = $3 AND status = 'pending'
         RETURNING id`,
        [user_id, id, tenant_id]
      );
      return rows[0];
    });
    if (!updated) return reply.status(404).send({ error: 'Convite não encontrado.' });
    return reply.status(204).send();
  });

  // DELETE /:id (cancel — sender only, pending only)
  fastify.delete('/:id', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const updated = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE tenant_invitations
         SET status = 'cancelled', responded_at = NOW()
         WHERE id = $1 AND from_tenant_id = $2 AND status = 'pending'
         RETURNING id`,
        [id, tenant_id]
      );
      return rows[0];
    });
    if (!updated) return reply.status(404).send({ error: 'Convite não encontrado ou não cancelável.' });
    return reply.status(204).send();
  });
};
```

- [ ] **Step 4.3: Rodar tests — pass**
- [ ] **Step 4.4: Commit**

```bash
git add apps/api/src/routes/inter-tenant-chat/invitations.js apps/api/tests/routes/inter-tenant-chat/invitations.test.js
git commit -m "feat(chat): rotas /invitations com rate limit + cooldown + bloqueio

5 endpoints (GET, POST, POST :id/accept, POST :id/reject, DELETE :id).
Rate limit 20 convites/dia por tenant. Cooldown automático após 3
rejeições do mesmo destinatário em 30 dias. Bloqueio bilateral
checado em ambos os lados. Aceitar cria conversation no par canônico
(tenant_a < tenant_b) numa única transação."
```

---

## Task 5: Blocks — 3 endpoints

**Endpoints:**
| Método | Path | Descrição |
|---|---|---|
| GET | `/blocks` | Lista bloqueios criados pelo tenant atual |
| POST | `/blocks` | `{ blocked_tenant_id, reason? }` — cria bloqueio |
| DELETE | `/blocks/:tenant_id` | Remove bloqueio |

**Files:**
- Modify: `apps/api/src/routes/inter-tenant-chat/blocks.js`
- Create: `apps/api/tests/routes/inter-tenant-chat/blocks.test.js`

- [ ] **Step 5.1: Escrever testes** (5+ testes: list, post 201, post 400 self-block, post 409 já bloqueado, delete 204, delete 404 não existe)

- [ ] **Step 5.2: Implementar `apps/api/src/routes/inter-tenant-chat/blocks.js`**

Padrão idêntico ao settings/invitations: `ADMIN_ONLY` middleware + `withTenant` para os queries. Usa `INSERT ... ON CONFLICT DO NOTHING` para idempotência. Validação: `blocked_tenant_id !== tenant_id`.

- [ ] **Step 5.3: Run tests — pass**
- [ ] **Step 5.4: Commit**

```bash
git add apps/api/src/routes/inter-tenant-chat/blocks.js apps/api/tests/routes/inter-tenant-chat/blocks.test.js
git commit -m "feat(chat): rotas /blocks (GET, POST, DELETE)"
```

---

## Task 6: Conversations — 5 endpoints

**Endpoints:**
| Método | Path | Descrição |
|---|---|---|
| GET | `/conversations` | Lista conversas do tenant + counterpart info + unread count |
| GET | `/conversations/:id` | Detalhes de uma conversa |
| POST | `/conversations/:id/archive` | Marca como arquivada (lado do tenant) |
| POST | `/conversations/:id/unarchive` | Desarquiva |
| DELETE | `/conversations/:id` | Soft-delete (anonimiza body, mantém metadata) |

Usa `withConversationAccess` para validar membership.

**Files:**
- Modify: `apps/api/src/routes/inter-tenant-chat/conversations.js`
- Create: `apps/api/tests/routes/inter-tenant-chat/conversations.test.js`

- [ ] **Step 6.1: Escrever testes** (~8 testes: GET list com unread, GET :id sucesso, GET :id 403 não-membro, archive/unarchive, delete soft)

- [ ] **Step 6.2: Implementar `apps/api/src/routes/inter-tenant-chat/conversations.js`**

GET / retorna shape:
```json
{
  "results": [{
    "id": "uuid",
    "counterpart_tenant_id": "uuid",
    "counterpart_name": "Clínica X",
    "module": "human",
    "last_message_at": "2026-04-23T...",
    "last_message_preview": "Olá pessoal...",
    "unread_count": 3,
    "archived": false
  }]
}
```

GET / SQL pattern:
```sql
SELECT c.id,
       CASE WHEN c.tenant_a_id = $1 THEN c.tenant_b_id ELSE c.tenant_a_id END AS counterpart_tenant_id,
       CASE WHEN c.tenant_a_id = $1 THEN tb.name ELSE ta.name END AS counterpart_name,
       c.module,
       c.last_message_at,
       (SELECT body FROM tenant_messages
        WHERE conversation_id = c.id AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1) AS last_message_preview,
       (SELECT count(*) FROM tenant_messages
        WHERE conversation_id = c.id AND sender_tenant_id <> $1
          AND created_at > COALESCE(
            (SELECT last_read_at FROM tenant_conversation_reads WHERE conversation_id = c.id AND tenant_id = $1),
            '1970-01-01'::timestamptz
          )
       )::int AS unread_count,
       (CASE WHEN c.tenant_a_id = $1 THEN c.archived_by_a ELSE c.archived_by_b END) AS archived
FROM tenant_conversations c
JOIN tenants ta ON ta.id = c.tenant_a_id
JOIN tenants tb ON tb.id = c.tenant_b_id
WHERE (c.tenant_a_id = $1 OR c.tenant_b_id = $1)
ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
```

archive/unarchive UPDATEs `archived_by_a` ou `archived_by_b` baseado em qual lado o tenant está.

DELETE faz UPDATE `tenant_messages SET body='', deleted_at=NOW() WHERE conversation_id = $1` + DELETE da própria conversation row (CASCADEs cuidam de attachments/reactions/reads). Documentar que isso é destrutivo.

- [ ] **Step 6.3: Run + commit**

```bash
git add ...
git commit -m "feat(chat): rotas /conversations (list, detail, archive, delete)"
```

---

## Task 7: Messages — 4 endpoints + reads

**Endpoints:**
| Método | Path | Descrição |
|---|---|---|
| GET | `/conversations/:id/messages?before=&limit=` | Lista paginada por cursor (before = ISO timestamp) |
| POST | `/conversations/:id/messages` | `{ body }` — envia mensagem texto (anexos = Phase 5) |
| GET | `/conversations/:id/search?q=` | Full-text search via tsvector |
| POST | `/conversations/:id/read` | Atualiza last_read_at do tenant atual |

Rate limit em POST messages: 200/dia por conversa.

**Files:**
- Modify: `apps/api/src/routes/inter-tenant-chat/messages.js` e `reads.js`
- Create: `apps/api/tests/routes/inter-tenant-chat/messages.test.js` e `reads.test.js`

- [ ] **Step 7.1: Escrever testes** (~8 testes: list pagination, post 201 + atualiza last_message_at, post 403 não-membro, post 400 body vazio sem anexo, search retorna match, read atualiza last_read_at + zera unread)

- [ ] **Step 7.2: Implementar `messages.js`**

Use `withConversationAccess` em todas as queries. Para `last_message_at`, atualizar a `tenant_conversations` no mesmo client após inserir a mensagem (na mesma transação do withConversationAccess, que já é uma transação BEGIN..COMMIT do withTenant).

Para search:
```sql
SELECT id, sender_tenant_id, body, created_at,
       ts_headline('portuguese', body, plainto_tsquery('portuguese', $2)) AS snippet
FROM tenant_messages
WHERE conversation_id = $1 AND deleted_at IS NULL
  AND body_tsv @@ plainto_tsquery('portuguese', $2)
ORDER BY created_at DESC
LIMIT 50
```

Para list paginado:
```sql
SELECT id, sender_tenant_id, sender_user_id, body, has_attachment, created_at
FROM tenant_messages
WHERE conversation_id = $1 AND deleted_at IS NULL
  AND ($2::timestamptz IS NULL OR created_at < $2)
ORDER BY created_at DESC
LIMIT $3
```

`limit` clamp em 100, default 50.

- [ ] **Step 7.3: Implementar `reads.js`**

```javascript
fastify.post('/conversations/:id/read', { preHandler: [...] }, async (request, reply) => {
  const { tenant_id } = request.user;
  const { id: conversationId } = request.params;

  await withConversationAccess(fastify.pg, conversationId, tenant_id, async (client) => {
    // pega o id da última mensagem
    const { rows: lastMsgRows } = await client.query(
      `SELECT id FROM tenant_messages
       WHERE conversation_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [conversationId]
    );
    const lastMessageId = lastMsgRows[0]?.id || null;
    await client.query(
      `INSERT INTO tenant_conversation_reads (conversation_id, tenant_id, last_read_message_id, last_read_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (conversation_id, tenant_id)
       DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id, last_read_at = NOW()`,
      [conversationId, tenant_id, lastMessageId]
    );
  });
  return reply.status(204).send();
});
```

- [ ] **Step 7.4: Run + commit**

```bash
git add ...
git commit -m "feat(chat): rotas /messages (list, post, search) + /reads"
```

---

## Task 8: Smoke E2E + cleanup + push

- [ ] **Step 8.1: Escrever smoke test E2E HTTP**

Create `apps/api/tests/routes/inter-tenant-chat/e2e-http.test.js` que faça TODO o fluxo via HTTP:
1. Tenant A faz PUT /settings { visible_in_directory: true }
2. Tenant B faz GET /directory → vê A
3. B faz POST /invitations { to: A }
4. A faz GET /invitations?direction=incoming → vê convite
5. A faz POST /invitations/:id/accept → recebe conversation_id
6. B faz GET /conversations → vê 1 conversa com counterpart=A
7. B faz POST /conversations/:id/messages { body: "olá" } → 201
8. A faz GET /conversations/:id/messages → vê a mensagem
9. A faz POST /conversations/:id/read → 204
10. B faz GET /conversations → unread_count=0 (depois de A ler... hmm, na verdade A leu, então o B continua sendo o sender — verificar lógica)
11. A faz GET /conversations/:id/search?q=olá → 1 match

- [ ] **Step 8.2: Rodar TUDO**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/inter-tenant-chat/ 2>&1 | tail -10
```

Expected: 40+ tests passing (todas as suítes).

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/db/ 2>&1 | tail -10
```

Expected: 49/49 (Phase 1) ainda passando, sem regressão.

- [ ] **Step 8.3: Atualizar CLAUDE.md**

Em `## Comportamentos Esperados`, adicionar:
- `Convite cross-module retorna 400`
- `Rate limit /invitations excedido retorna 429`

- [ ] **Step 8.4: Commit final + push**

```bash
git add CLAUDE.md apps/api/tests/routes/inter-tenant-chat/e2e-http.test.js
git commit -m "test(chat): smoke E2E HTTP da Phase 2 + atualiza CLAUDE.md"
git push -u origin feat/chat-phase2-api 2>&1 | tail -3
```

---

## Critérios de "pronto" da Fase 2

- [ ] Migration 048 aplicada (ti_update WITH CHECK)
- [ ] Plugin `/inter-tenant-chat` registrado e responde 401/403/200 conforme auth
- [ ] 7 sub-recursos funcionais com ~22 endpoints
- [ ] Rate limits aplicados (POST /invitations 20/dia, POST /messages 200/dia por conv)
- [ ] Anti-abuso: cooldown 3 rejeições, bloqueio bilateral, cross-module rejeitado
- [ ] Defesa em profundidade: toda query tenant-scoped tem `AND tenant_id = $X` explícito
- [ ] Suíte de testes do chat: ~40 tests passando, zero regressão na Phase 1 (49 tests)
- [ ] Smoke E2E HTTP cobre o fluxo settings → directory → invite → accept → message → read → search
- [ ] CLAUDE.md atualizado
- [ ] Branch `feat/chat-phase2-api` pushada

## Roadmap das próximas fases

| Fase | Escopo | Branch |
|---|---|---|
| 3 | WebSocket events + frontend Chat shell + thread + envio texto | `feat/chat-phase3-frontend` |
| 4 | Anexo análise IA (cards anonimizados) | `feat/chat-phase4-ai-attach` |
| 5 | Pipeline PII + anexo PDF + imagem | `feat/chat-phase5-pii-attach` |
| 6 | Reações + busca destacada + badge unread integrado | `feat/chat-phase6-search-react-badge` |
| 7 | Anti-abuso refinado + email | `feat/chat-phase7-antiabuse` |
| 8 | Smoke E2E full + audit log + ajustes UX | `feat/chat-phase8-polish` |
