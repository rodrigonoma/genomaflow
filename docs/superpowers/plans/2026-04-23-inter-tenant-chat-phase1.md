# Chat Entre Tenants V1 — Fase 1 (Schema + RLS + Helper Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a fundação do chat entre tenants — migration 047 com 10 tabelas novas (zero ALTER em existentes), RLS ENABLE+FORCE com policies, índices, trigger de sincronização do diretório, constraints de canonical pair e cross-module, e helper `withConversationAccess` no backend — tudo coberto por testes TDD.

**Architecture:** Migration aditiva única. RLS por tenant único (settings/directory/blocks) ou por par de tenants (conversations/messages/attachments/etc.). Helper `withConversationAccess` faz validação dupla (RLS + check explícito de membership) — defesa em profundidade conforme CLAUDE.md. Todos os testes rodam no DB Docker (única fonte de verdade).

**Tech Stack:** PostgreSQL 15 + extensão `pg_trgm`, Node.js + `pg`, Jest + supertest. Migration runner já existente (`apps/api/src/db/migrate.js`).

**Branch:** `feat/chat-phase1-schema-rls`

---

## Convenção de idempotência (válida para o arquivo de migration inteiro)

PostgreSQL 15 **não suporta `IF NOT EXISTS`** em `CREATE POLICY` nem `CREATE TRIGGER`. Para que a migration seja idempotente (re-execução não falha em prod nem em dev), **toda** declaração desses dois deve ser precedida por um `DROP IF EXISTS`:

```sql
DROP POLICY IF EXISTS nome_policy ON nome_tabela;
CREATE POLICY nome_policy ON nome_tabela ...;

DROP TRIGGER IF EXISTS nome_trigger ON nome_tabela;
CREATE TRIGGER nome_trigger ...;
```

Os blocos SQL inline desta plan **já seguem esta convenção** nos `for db in ... do` que aplicam manualmente. Ao editar o arquivo `apps/api/src/db/migrations/047_inter_tenant_chat.sql`, sempre aplique o mesmo padrão.

---

## File Structure

**Create:**
- `apps/api/src/db/migrations/047_inter_tenant_chat.sql` — schema completo da fase
- `apps/api/src/db/conversation.js` — helper `withConversationAccess`
- `apps/api/tests/db/migration-047.test.js` — testes de schema, índices, constraints
- `apps/api/tests/db/migration-047-rls.test.js` — testes de RLS (isolamento por tenant)
- `apps/api/tests/db/migration-047-trigger.test.js` — testes do trigger de sincronização do diretório
- `apps/api/tests/db/conversation.test.js` — testes do helper `withConversationAccess`
- `apps/api/tests/db/fixtures/chat-fixtures.js` — fixtures reutilizáveis (criar 2 tenants, par, conversa)

**Modify:**
- Nenhum arquivo existente é modificado nesta fase.

---

## Pre-flight Checks

- [ ] **Step 0.1: Verificar branch atual e criar branch da fase**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/chat-phase1-schema-rls
```

- [ ] **Step 0.2: Verificar migrations aplicadas no DB Docker**

```bash
docker compose exec -T db psql -U postgres -d genomaflow -c "SELECT name FROM _migrations ORDER BY name DESC LIMIT 5;"
```

Expected: `046_ensure_app_user_no_bypass_rls.sql` aparece como última migration aplicada (ou similar — confirmar nada após 046).

- [ ] **Step 0.3: Verificar que extensão `pg_trgm` está disponível**

```bash
docker compose exec -T db psql -U postgres -d genomaflow -c "SELECT * FROM pg_available_extensions WHERE name = 'pg_trgm';"
```

Expected: 1 linha. Se não aparecer, abortar — precisa ser instalada na imagem do Postgres antes de prosseguir.

- [ ] **Step 0.4: Verificar setup de teste do projeto**

Run: `cat apps/api/tests/setup.js`
Expected: arquivo existe, exporta `setupTestDb` e `teardownTestDb`.

Run: `grep -E "DATABASE_URL_TEST" apps/api/.env apps/api/.env.test 2>/dev/null`
Expected: variável definida apontando para um DB de teste (não o DB principal).

---

## Task 1: Skeleton da migration 047 — cria as 10 tabelas (sem RLS ainda)

Esta task cria o arquivo de migration com a estrutura completa das tabelas, índices e extensões. As policies RLS e o trigger entram nas tasks seguintes. Ao final dela, as tabelas existem mas RLS está OFF.

**Files:**
- Create: `apps/api/src/db/migrations/047_inter_tenant_chat.sql`
- Create: `apps/api/tests/db/migration-047.test.js`

- [ ] **Step 1.1: Escrever o teste das tabelas**

Create `apps/api/tests/db/migration-047.test.js`:

```javascript
const { Pool } = require('pg');

const TABLES = [
  'tenant_chat_settings',
  'tenant_directory_listing',
  'tenant_invitations',
  'tenant_blocks',
  'tenant_conversations',
  'tenant_messages',
  'tenant_message_attachments',
  'tenant_message_pii_checks',
  'tenant_message_reactions',
  'tenant_conversation_reads',
];

let pool;

beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST }); });
afterAll(async () => { await pool.end(); });

describe('Migration 047 — schema', () => {
  it.each(TABLES)('cria a tabela %s', async (table) => {
    const { rows } = await pool.query(
      `SELECT to_regclass($1) AS exists`, [table]
    );
    expect(rows[0].exists).toBe(table);
  });

  it('habilita extensão pg_trgm', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`
    );
    expect(rows.length).toBe(1);
  });

  it('cria índice GIN trigram em tenant_directory_listing.name', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'tenant_directory_listing'
         AND indexname = 'tenant_directory_name_trgm'`
    );
    expect(rows.length).toBe(1);
  });

  it('cria índice GIN tsvector em tenant_messages.body_tsv', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'tenant_messages'
         AND indexname = 'tenant_messages_search_gin'`
    );
    expect(rows.length).toBe(1);
  });
});
```

- [ ] **Step 1.2: Rodar o teste — deve falhar**

Run: `cd apps/api && DATABASE_URL_TEST=$DATABASE_URL npx jest tests/db/migration-047.test.js -t "cria a tabela tenant_chat_settings" 2>&1 | tail -20`

Expected: FAIL — `to_regclass($1)` retorna `null` para `tenant_chat_settings` (tabela ainda não existe).

- [ ] **Step 1.3: Escrever o esqueleto da migration**

Create `apps/api/src/db/migrations/047_inter_tenant_chat.sql`:

```sql
-- Migration 047: Chat entre tenants V1 — schema base
-- Cria 10 tabelas novas (zero ALTER em tabelas existentes), índices, extensão pg_trgm.
-- RLS policies e triggers entram nas migrations subsequentes do mesmo número (047a, 047b)
-- ou nesta mesma migration nos passos seguintes do plano.
--
-- Spec: docs/superpowers/specs/2026-04-23-inter-tenant-chat-design.md

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 5.1 Configurações de chat por tenant
CREATE TABLE IF NOT EXISTS tenant_chat_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  visible_in_directory BOOLEAN NOT NULL DEFAULT false,
  notify_on_invite_email BOOLEAN NOT NULL DEFAULT true,
  notify_on_message_email BOOLEAN NOT NULL DEFAULT false,
  message_email_quiet_after_minutes INT NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5.2 Diretório (tabela física derivada via trigger)
CREATE TABLE IF NOT EXISTS tenant_directory_listing (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  module TEXT NOT NULL CHECK (module IN ('human', 'veterinary')),
  region_uf CHAR(2),
  region_city TEXT,
  specialties TEXT[] NOT NULL DEFAULT '{}',
  last_active_month DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_directory_module_uf_idx
  ON tenant_directory_listing(module, region_uf);
CREATE INDEX IF NOT EXISTS tenant_directory_specialties_gin
  ON tenant_directory_listing USING GIN (specialties);
CREATE INDEX IF NOT EXISTS tenant_directory_name_trgm
  ON tenant_directory_listing USING GIN (name gin_trgm_ops);

-- 5.3 Convites tenant→tenant
CREATE TABLE IF NOT EXISTS tenant_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  to_tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('human', 'veterinary')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  message TEXT,
  sent_by_user_id UUID NOT NULL REFERENCES users(id),
  responded_by_user_id UUID REFERENCES users(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CHECK (from_tenant_id <> to_tenant_id)
);

CREATE INDEX IF NOT EXISTS tenant_invitations_to_status_idx
  ON tenant_invitations(to_tenant_id, status);
CREATE INDEX IF NOT EXISTS tenant_invitations_from_status_idx
  ON tenant_invitations(from_tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_invitations_pending_unique
  ON tenant_invitations(from_tenant_id, to_tenant_id) WHERE status = 'pending';

-- 5.4 Bloqueios bilaterais
CREATE TABLE IF NOT EXISTS tenant_blocks (
  blocker_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  blocked_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_tenant_id, blocked_tenant_id),
  CHECK (blocker_tenant_id <> blocked_tenant_id)
);

-- 5.5 Conversas (par canônico tenant_a < tenant_b)
CREATE TABLE IF NOT EXISTS tenant_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_a_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_b_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('human', 'veterinary')),
  created_from_invitation_id UUID REFERENCES tenant_invitations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  archived_by_a BOOLEAN NOT NULL DEFAULT false,
  archived_by_b BOOLEAN NOT NULL DEFAULT false,
  CHECK (tenant_a_id < tenant_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_conversations_pair_idx
  ON tenant_conversations(tenant_a_id, tenant_b_id);
CREATE INDEX IF NOT EXISTS tenant_conversations_lookup_a_idx
  ON tenant_conversations(tenant_a_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS tenant_conversations_lookup_b_idx
  ON tenant_conversations(tenant_b_id, last_message_at DESC);

-- 5.6 Mensagens (com tsvector full-text)
CREATE TABLE IF NOT EXISTS tenant_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES tenant_conversations(id) ON DELETE CASCADE,
  sender_tenant_id UUID NOT NULL REFERENCES tenants(id),
  sender_user_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL DEFAULT '',
  body_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('portuguese', body)) STORED,
  has_attachment BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_messages_conv_created_idx
  ON tenant_messages(conversation_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_messages_search_gin
  ON tenant_messages USING GIN (body_tsv);

-- 5.7 Anexos
CREATE TABLE IF NOT EXISTS tenant_message_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES tenant_messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ai_analysis_card', 'pdf', 'image')),
  s3_key TEXT,
  payload JSONB,
  original_size_bytes BIGINT,
  redacted_regions_count INT NOT NULL DEFAULT 0,
  original_hash TEXT,
  redacted_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_attachments_message_idx
  ON tenant_message_attachments(message_id);

-- 5.8 Audit do filtro PII
CREATE TABLE IF NOT EXISTS tenant_message_pii_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attachment_id UUID NOT NULL REFERENCES tenant_message_attachments(id) ON DELETE CASCADE,
  detected_kinds TEXT[] NOT NULL DEFAULT '{}',
  region_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('clean', 'auto_redacted_confirmed', 'cancelled_by_user')),
  confirmed_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5.9 Reações (curadas — whitelist no app)
CREATE TABLE IF NOT EXISTS tenant_message_reactions (
  message_id UUID NOT NULL REFERENCES tenant_messages(id) ON DELETE CASCADE,
  reactor_tenant_id UUID NOT NULL REFERENCES tenants(id),
  reactor_user_id UUID NOT NULL REFERENCES users(id),
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, reactor_user_id, emoji)
);

CREATE INDEX IF NOT EXISTS tenant_message_reactions_msg_idx
  ON tenant_message_reactions(message_id);

-- 5.10 Last-read por tenant para badge de unread
CREATE TABLE IF NOT EXISTS tenant_conversation_reads (
  conversation_id UUID NOT NULL REFERENCES tenant_conversations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  last_read_message_id UUID REFERENCES tenant_messages(id),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, tenant_id)
);
```

- [ ] **Step 1.4: Aplicar migration no DB Docker**

Run: `docker compose exec api node src/db/migrate.js 2>&1 | tail -10`

Expected: linha tipo `[migrate] Applied 047_inter_tenant_chat.sql`. Sem erros.

- [ ] **Step 1.5: Aplicar também no DB de teste**

Run: `docker compose exec -T db psql -U postgres -d genomaflow_test -f /tmp/047.sql` — primeiro copiar o arquivo:

```bash
docker cp apps/api/src/db/migrations/047_inter_tenant_chat.sql genomaflow-db-1:/tmp/047.sql
docker compose exec -T db psql -U postgres -d genomaflow_test -f /tmp/047.sql 2>&1 | tail -5
```

Expected: `CREATE EXTENSION` (ou `NOTICE: extension "pg_trgm" already exists, skipping`), 10× `CREATE TABLE`, vários `CREATE INDEX`. Sem erros.

- [ ] **Step 1.6: Rodar o teste — deve passar**

Run: `cd apps/api && npx jest tests/db/migration-047.test.js 2>&1 | tail -15`

Expected: PASS para todas as 13 expectations (10 tabelas + extensão + 2 índices GIN).

- [ ] **Step 1.7: Commit**

```bash
git add apps/api/src/db/migrations/047_inter_tenant_chat.sql apps/api/tests/db/migration-047.test.js
git commit -m "feat(chat): migration 047 — schema base do chat entre tenants

Cria as 10 tabelas novas (settings, directory, invitations, blocks,
conversations, messages, attachments, pii_checks, reactions, reads)
+ índices, sem ALTER em tabelas existentes. RLS, trigger e helper
backend entram nas tasks seguintes da fase 1."
```

---

## Task 2: Constraints — canonical pair, cross-module reject

Adiciona constraints lógicas: par canônico (`tenant_a_id < tenant_b_id`) impede duplicata, e validação de cross-module via trigger (não dá pra fazer só com CHECK porque depende de JOIN com `tenants`).

**Files:**
- Modify: `apps/api/src/db/migrations/047_inter_tenant_chat.sql` (append)
- Create: `apps/api/tests/db/fixtures/chat-fixtures.js`
- Modify: `apps/api/tests/db/migration-047.test.js` (append constraint tests)

- [ ] **Step 2.1: Criar fixtures reutilizáveis**

Create `apps/api/tests/db/fixtures/chat-fixtures.js`:

```javascript
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const PREFIX = 'chat-test-';
let pool;

function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
  return pool;
}

async function createTenant({ name, module = 'human', uf = 'SP' }) {
  const p = getPool();
  const { rows: [t] } = await p.query(
    `INSERT INTO tenants (name, type, module, active) VALUES ($1, 'clinic', $2, true) RETURNING id`,
    [PREFIX + name, module]
  );
  const hash = await bcrypt.hash('test-password', 10);
  const { rows: [u] } = await p.query(
    `INSERT INTO users (tenant_id, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin') RETURNING id`,
    [t.id, `${PREFIX}${name.toLowerCase()}@test.com`, hash]
  );
  return { tenantId: t.id, userId: u.id, module };
}

/** Retorna par canônico (a < b) já criado de tenants do mesmo módulo. */
async function createPair({ module = 'human' } = {}) {
  const t1 = await createTenant({ name: 'Pair-A-' + Date.now(), module });
  const t2 = await createTenant({ name: 'Pair-B-' + Date.now(), module });
  const [a, b] = t1.tenantId < t2.tenantId ? [t1, t2] : [t2, t1];
  return { a, b };
}

async function cleanupChatFixtures() {
  const p = getPool();
  await p.query(`DELETE FROM tenants WHERE name LIKE $1`, [PREFIX + '%']);
}

async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { createTenant, createPair, cleanupChatFixtures, closePool, getPool };
```

- [ ] **Step 2.2: Escrever testes de constraints**

Append to `apps/api/tests/db/migration-047.test.js`:

```javascript
const fixtures = require('./fixtures/chat-fixtures');

describe('Migration 047 — constraints', () => {
  afterEach(() => fixtures.cleanupChatFixtures());

  it('rejeita conversa com tenant_a_id >= tenant_b_id', async () => {
    const { a, b } = await fixtures.createPair();
    // tenta inserir invertido (b primeiro, a depois)
    await expect(
      pool.query(
        `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module)
         VALUES ($1, $2, 'human')`,
        [b.tenantId, a.tenantId]
      )
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('aceita conversa com par canônico', async () => {
    const { a, b } = await fixtures.createPair();
    const { rows } = await pool.query(
      `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module)
       VALUES ($1, $2, 'human') RETURNING id`,
      [a.tenantId, b.tenantId]
    );
    expect(rows[0].id).toBeDefined();
  });

  it('rejeita conversa cross-module via trigger', async () => {
    const human = await fixtures.createTenant({ name: 'CrossH-' + Date.now(), module: 'human' });
    const vet   = await fixtures.createTenant({ name: 'CrossV-' + Date.now(), module: 'veterinary' });
    const [a, b] = human.tenantId < vet.tenantId ? [human, vet] : [vet, human];
    await expect(
      pool.query(
        `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module)
         VALUES ($1, $2, 'human')`,
        [a.tenantId, b.tenantId]
      )
    ).rejects.toThrow(/cross-module|módulo/i);
  });

  it('rejeita convite cross-module via trigger', async () => {
    const human = await fixtures.createTenant({ name: 'InvH-' + Date.now(), module: 'human' });
    const vet   = await fixtures.createTenant({ name: 'InvV-' + Date.now(), module: 'veterinary' });
    await expect(
      pool.query(
        `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id)
         VALUES ($1, $2, 'human', 'pending', $3)`,
        [human.tenantId, vet.tenantId, human.userId]
      )
    ).rejects.toThrow(/cross-module|módulo/i);
  });

  it('rejeita 2 convites pending para o mesmo par direcionado', async () => {
    const { a, b } = await fixtures.createPair();
    await pool.query(
      `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id)
       VALUES ($1, $2, 'human', 'pending', $3)`,
      [a.tenantId, b.tenantId, a.userId]
    );
    await expect(
      pool.query(
        `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id)
         VALUES ($1, $2, 'human', 'pending', $3)`,
        [a.tenantId, b.tenantId, a.userId]
      )
    ).rejects.toThrow(/duplicate|unique|tenant_invitations_pending_unique/i);
  });

  it('aceita 2º convite pending após o primeiro virar rejected', async () => {
    const { a, b } = await fixtures.createPair();
    await pool.query(
      `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id, responded_at)
       VALUES ($1, $2, 'human', 'rejected', $3, NOW())`,
      [a.tenantId, b.tenantId, a.userId]
    );
    const { rows } = await pool.query(
      `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id)
       VALUES ($1, $2, 'human', 'pending', $3) RETURNING id`,
      [a.tenantId, b.tenantId, a.userId]
    );
    expect(rows[0].id).toBeDefined();
  });
});

afterAll(async () => { await fixtures.closePool(); });
```

- [ ] **Step 2.3: Rodar os testes — alguns devem falhar**

Run: `cd apps/api && npx jest tests/db/migration-047.test.js -t "constraints" 2>&1 | tail -20`

Expected: 
- "aceita conversa com par canônico" → PASS (CHECK já existe)
- "rejeita conversa com tenant_a_id >= tenant_b_id" → PASS
- "rejeita 2 convites pending para o mesmo par direcionado" → PASS (UNIQUE INDEX já existe)
- "aceita 2º convite pending após o primeiro virar rejected" → PASS
- **FAIL**: "rejeita conversa cross-module via trigger" — trigger ainda não existe
- **FAIL**: "rejeita convite cross-module via trigger" — trigger ainda não existe

- [ ] **Step 2.4: Adicionar triggers de cross-module à migration**

Append to `apps/api/src/db/migrations/047_inter_tenant_chat.sql`:

```sql
-- Trigger: valida que ambos os tenants têm o mesmo módulo da conversa/convite
CREATE OR REPLACE FUNCTION enforce_chat_same_module() RETURNS trigger AS $$
DECLARE
  module_a TEXT;
  module_b TEXT;
BEGIN
  IF TG_TABLE_NAME = 'tenant_conversations' THEN
    SELECT module INTO module_a FROM tenants WHERE id = NEW.tenant_a_id;
    SELECT module INTO module_b FROM tenants WHERE id = NEW.tenant_b_id;
  ELSIF TG_TABLE_NAME = 'tenant_invitations' THEN
    SELECT module INTO module_a FROM tenants WHERE id = NEW.from_tenant_id;
    SELECT module INTO module_b FROM tenants WHERE id = NEW.to_tenant_id;
  END IF;

  IF module_a IS NULL OR module_b IS NULL THEN
    RAISE EXCEPTION 'tenant não encontrado ao validar cross-module em %', TG_TABLE_NAME;
  END IF;

  IF module_a <> NEW.module OR module_b <> NEW.module THEN
    RAISE EXCEPTION 'cross-module proibido: tenants devem ser do módulo % (got % e %)',
      NEW.module, module_a, module_b;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_conversations_same_module ON tenant_conversations;
CREATE TRIGGER tenant_conversations_same_module
  BEFORE INSERT OR UPDATE ON tenant_conversations
  FOR EACH ROW EXECUTE FUNCTION enforce_chat_same_module();

DROP TRIGGER IF EXISTS tenant_invitations_same_module ON tenant_invitations;
CREATE TRIGGER tenant_invitations_same_module
  BEFORE INSERT OR UPDATE ON tenant_invitations
  FOR EACH ROW EXECUTE FUNCTION enforce_chat_same_module();
```

- [ ] **Step 2.5: Reaplicar migration nos dois bancos**

Como a migration já foi aplicada (e `migrate.js` checa `_migrations` antes de re-executar), aplicar **só os blocos novos** manualmente em **ambos** os bancos via for-loop:

```bash
for db in genomaflow genomaflow_test; do
  echo "Applying triggers to $db..."
  docker compose exec -T db psql -U postgres -d $db <<'EOF'
CREATE OR REPLACE FUNCTION enforce_chat_same_module() RETURNS trigger AS $$
DECLARE module_a TEXT; module_b TEXT;
BEGIN
  IF TG_TABLE_NAME = 'tenant_conversations' THEN
    SELECT module INTO module_a FROM tenants WHERE id = NEW.tenant_a_id;
    SELECT module INTO module_b FROM tenants WHERE id = NEW.tenant_b_id;
  ELSIF TG_TABLE_NAME = 'tenant_invitations' THEN
    SELECT module INTO module_a FROM tenants WHERE id = NEW.from_tenant_id;
    SELECT module INTO module_b FROM tenants WHERE id = NEW.to_tenant_id;
  END IF;
  IF module_a IS NULL OR module_b IS NULL THEN
    RAISE EXCEPTION 'tenant não encontrado ao validar cross-module em %', TG_TABLE_NAME;
  END IF;
  IF module_a <> NEW.module OR module_b <> NEW.module THEN
    RAISE EXCEPTION 'cross-module proibido: tenants devem ser do módulo % (got % e %)',
      NEW.module, module_a, module_b;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_conversations_same_module ON tenant_conversations;
CREATE TRIGGER tenant_conversations_same_module BEFORE INSERT OR UPDATE ON tenant_conversations
  FOR EACH ROW EXECUTE FUNCTION enforce_chat_same_module();

DROP TRIGGER IF EXISTS tenant_invitations_same_module ON tenant_invitations;
CREATE TRIGGER tenant_invitations_same_module BEFORE INSERT OR UPDATE ON tenant_invitations
  FOR EACH ROW EXECUTE FUNCTION enforce_chat_same_module();
EOF
done
```

Expected: `CREATE FUNCTION`, `DROP TRIGGER` (NOTICE: trigger not exists, skipping na primeira), `CREATE TRIGGER` × 2 — em cada banco. Sem erro.

- [ ] **Step 2.6: Rodar os testes — todos devem passar**

Run: `cd apps/api && npx jest tests/db/migration-047.test.js -t "constraints" 2>&1 | tail -15`

Expected: 6 PASS para a suite "constraints".

- [ ] **Step 2.7: Commit**

```bash
git add apps/api/src/db/migrations/047_inter_tenant_chat.sql apps/api/tests/db/migration-047.test.js apps/api/tests/db/fixtures/chat-fixtures.js
git commit -m "feat(chat): triggers de cross-module + fixtures de teste

Trigger BEFORE INSERT/UPDATE em tenant_conversations e tenant_invitations
valida que ambos os tenants têm o mesmo módulo da conversa/convite
(human só conversa com human, vet só com vet). Defesa em DB conforme
CLAUDE.md > Compatibilidade Multi-módulo."
```

---

## Task 3: Trigger de sincronização do diretório

Quando `tenant_chat_settings.visible_in_directory = true`, uma linha é mantida em `tenant_directory_listing`. Quando vira `false` (ou a row é deletada), a linha some do diretório. Esse trigger preserva a invariante "diretório só lista quem opt-in".

**Files:**
- Modify: `apps/api/src/db/migrations/047_inter_tenant_chat.sql` (append)
- Create: `apps/api/tests/db/migration-047-trigger.test.js`

- [ ] **Step 3.1: Escrever testes do trigger**

Create `apps/api/tests/db/migration-047-trigger.test.js`:

```javascript
const fixtures = require('./fixtures/chat-fixtures');
const { Pool } = require('pg');

let pool;

beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST }); });
afterAll(async () => { await fixtures.closePool(); await pool.end(); });
afterEach(() => fixtures.cleanupChatFixtures());

async function dirRowExists(tenantId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM tenant_directory_listing WHERE tenant_id = $1`, [tenantId]
  );
  return rows.length === 1;
}

describe('Trigger sync_directory', () => {
  it('NÃO insere no diretório quando visible_in_directory = false', async () => {
    const t = await fixtures.createTenant({ name: 'DirOff-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, false)`,
      [t.tenantId]
    );
    expect(await dirRowExists(t.tenantId)).toBe(false);
  });

  it('insere no diretório quando visible_in_directory = true', async () => {
    const t = await fixtures.createTenant({ name: 'DirOn-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)`,
      [t.tenantId]
    );
    expect(await dirRowExists(t.tenantId)).toBe(true);
  });

  it('deleta do diretório quando visible_in_directory muda para false', async () => {
    const t = await fixtures.createTenant({ name: 'DirToggle-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)`,
      [t.tenantId]
    );
    expect(await dirRowExists(t.tenantId)).toBe(true);

    await pool.query(
      `UPDATE tenant_chat_settings SET visible_in_directory = false WHERE tenant_id = $1`,
      [t.tenantId]
    );
    expect(await dirRowExists(t.tenantId)).toBe(false);
  });

  it('insere com nome e módulo corretos a partir de tenants', async () => {
    const t = await fixtures.createTenant({ name: 'DirNameSync-' + Date.now(), module: 'veterinary' });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)`,
      [t.tenantId]
    );
    const { rows } = await pool.query(
      `SELECT name, module FROM tenant_directory_listing WHERE tenant_id = $1`, [t.tenantId]
    );
    expect(rows[0].name).toMatch(/DirNameSync/);
    expect(rows[0].module).toBe('veterinary');
  });
});
```

- [ ] **Step 3.2: Rodar testes — deve falhar**

Run: `cd apps/api && npx jest tests/db/migration-047-trigger.test.js 2>&1 | tail -15`

Expected: 3 FAIL (todos os casos com `visible=true` falham porque sem trigger não há sync). 1 PASS ("NÃO insere quando false" passa por acaso).

- [ ] **Step 3.3: Adicionar trigger à migration**

Append to `apps/api/src/db/migrations/047_inter_tenant_chat.sql`:

```sql
-- Trigger: sincroniza tenant_directory_listing com tenant_chat_settings
CREATE OR REPLACE FUNCTION sync_tenant_directory() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') OR (NEW.visible_in_directory = false) THEN
    DELETE FROM tenant_directory_listing
    WHERE tenant_id = COALESCE(OLD.tenant_id, NEW.tenant_id);
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- INSERT ou UPDATE com visible=true
  INSERT INTO tenant_directory_listing (tenant_id, name, module, last_active_month, updated_at)
    SELECT t.id, t.name, t.module, date_trunc('month', NOW())::date, NOW()
    FROM tenants t WHERE t.id = NEW.tenant_id
  ON CONFLICT (tenant_id) DO UPDATE
    SET name = EXCLUDED.name,
        module = EXCLUDED.module,
        last_active_month = EXCLUDED.last_active_month,
        updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_chat_settings_sync_directory ON tenant_chat_settings;
CREATE TRIGGER tenant_chat_settings_sync_directory
  AFTER INSERT OR UPDATE OR DELETE ON tenant_chat_settings
  FOR EACH ROW EXECUTE FUNCTION sync_tenant_directory();
```

- [ ] **Step 3.4: Aplicar nos dois bancos manualmente**

```bash
for db in genomaflow genomaflow_test; do
  echo "Applying directory sync trigger to $db..."
  docker compose exec -T db psql -U postgres -d $db <<'EOF'
CREATE OR REPLACE FUNCTION sync_tenant_directory() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') OR (NEW.visible_in_directory = false) THEN
    DELETE FROM tenant_directory_listing
    WHERE tenant_id = COALESCE(OLD.tenant_id, NEW.tenant_id);
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO tenant_directory_listing (tenant_id, name, module, last_active_month, updated_at)
    SELECT t.id, t.name, t.module, date_trunc('month', NOW())::date, NOW()
    FROM tenants t WHERE t.id = NEW.tenant_id
  ON CONFLICT (tenant_id) DO UPDATE
    SET name = EXCLUDED.name,
        module = EXCLUDED.module,
        last_active_month = EXCLUDED.last_active_month,
        updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_chat_settings_sync_directory ON tenant_chat_settings;
CREATE TRIGGER tenant_chat_settings_sync_directory
  AFTER INSERT OR UPDATE OR DELETE ON tenant_chat_settings
  FOR EACH ROW EXECUTE FUNCTION sync_tenant_directory();
EOF
done
```

Expected: `CREATE FUNCTION`, `DROP TRIGGER` (NOTICE skipping na primeira), `CREATE TRIGGER` — em cada banco. Sem erro.

- [ ] **Step 3.5: Rodar testes — todos devem passar**

Run: `cd apps/api && npx jest tests/db/migration-047-trigger.test.js 2>&1 | tail -10`

Expected: 4 PASS.

- [ ] **Step 3.6: Commit**

```bash
git add apps/api/src/db/migrations/047_inter_tenant_chat.sql apps/api/tests/db/migration-047-trigger.test.js
git commit -m "feat(chat): trigger sync diretório ↔ chat_settings

Quando tenant ativa visible_in_directory, linha é inserida em
tenant_directory_listing com nome+módulo+last_active_month. Quando
desativa, linha é removida. Garante invariante 'diretório só lista
quem opt-in'."
```

---

## Task 4: RLS — tabelas single-tenant (settings, blocks, directory)

Habilita RLS em tabelas onde o `tenant_id` está numa coluna única. Pattern padrão `current_setting('app.tenant_id', true)::uuid`. Diretório tem caso especial: SELECT é livre (qualquer tenant pode listar diretório), mas WRITE só pelo dono.

**Files:**
- Modify: `apps/api/src/db/migrations/047_inter_tenant_chat.sql` (append)
- Create: `apps/api/tests/db/migration-047-rls.test.js`

- [ ] **Step 4.1: Escrever testes de RLS para single-tenant**

Create `apps/api/tests/db/migration-047-rls.test.js`:

```javascript
const fixtures = require('./fixtures/chat-fixtures');
const { Pool } = require('pg');
const { withTenant } = require('../../src/db/tenant');

let pool;

beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST }); });
afterAll(async () => { await fixtures.closePool(); await pool.end(); });
afterEach(() => fixtures.cleanupChatFixtures());

describe('RLS — tenant_chat_settings', () => {
  it('SELECT só vê linha do próprio tenant', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsSet1-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsSet2-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, false), ($2, false)`,
      [t1.tenantId, t2.tenantId]
    );

    const seen = await withTenant(pool, t1.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT tenant_id FROM tenant_chat_settings`);
      return rows.map(r => r.tenant_id);
    });
    expect(seen).toEqual([t1.tenantId]);
  });

  it('UPDATE não afeta tenant alheio', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsSet1u-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsSet2u-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, false), ($2, false)`,
      [t1.tenantId, t2.tenantId]
    );

    const updated = await withTenant(pool, t1.tenantId, async (c) => {
      const { rowCount } = await c.query(`UPDATE tenant_chat_settings SET visible_in_directory = true`);
      return rowCount;
    });
    expect(updated).toBe(1);  // só a linha de t1
  });
});

describe('RLS — tenant_blocks', () => {
  it('SELECT só vê bloqueios criados pelo próprio tenant', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsBlk1-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsBlk2-' + Date.now() });
    const t3 = await fixtures.createTenant({ name: 'RlsBlk3-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_blocks (blocker_tenant_id, blocked_tenant_id) VALUES ($1, $2), ($2, $3)`,
      [t1.tenantId, t2.tenantId, t3.tenantId]
    );

    const seen = await withTenant(pool, t1.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT blocked_tenant_id FROM tenant_blocks`);
      return rows.map(r => r.blocked_tenant_id);
    });
    expect(seen).toEqual([t2.tenantId]);
  });
});

describe('RLS — tenant_directory_listing', () => {
  it('SELECT é livre para qualquer tenant', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsDir1-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsDir2-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true), ($2, true)`,
      [t1.tenantId, t2.tenantId]
    );

    const seen = await withTenant(pool, t1.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT tenant_id FROM tenant_directory_listing WHERE name LIKE 'chat-test-RlsDir%'`
      );
      return rows.length;
    });
    expect(seen).toBe(2);  // tenant t1 vê t2 também
  });

  it('UPDATE só afeta a própria linha', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsDirU1-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsDirU2-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true), ($2, true)`,
      [t1.tenantId, t2.tenantId]
    );

    const updated = await withTenant(pool, t1.tenantId, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE tenant_directory_listing SET region_uf = 'RJ'`
      );
      return rowCount;
    });
    expect(updated).toBe(1);
  });
});
```

- [ ] **Step 4.2: Rodar testes — devem falhar (RLS ainda OFF)**

Run: `cd apps/api && npx jest tests/db/migration-047-rls.test.js 2>&1 | tail -25`

Expected: vários FAILs porque sem RLS, queries veem tudo.

- [ ] **Step 4.3: Adicionar RLS de single-tenant à migration**

Append ao arquivo `apps/api/src/db/migrations/047_inter_tenant_chat.sql` o **mesmo bloco SQL** que será executado no Step 4.4 (com `DROP POLICY IF EXISTS` antes de cada `CREATE POLICY` conforme a convenção de idempotência declarada no início desta plan). O bloco completo está em Step 4.4 e cobre: ENABLE+FORCE em `tenant_chat_settings`, `tenant_blocks`, `tenant_directory_listing` e suas respectivas policies (4 em settings, 3 em blocks, 3 em directory).

- [ ] **Step 4.4: Aplicar nos dois bancos**

```bash
for db in genomaflow genomaflow_test; do
  echo "Applying single-tenant RLS to $db..."
  docker compose exec -T db psql -U postgres -d $db <<'EOF'
ALTER TABLE tenant_chat_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_chat_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tcs_select ON tenant_chat_settings;
CREATE POLICY tcs_select ON tenant_chat_settings FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS tcs_insert ON tenant_chat_settings;
CREATE POLICY tcs_insert ON tenant_chat_settings FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS tcs_update ON tenant_chat_settings;
CREATE POLICY tcs_update ON tenant_chat_settings FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS tcs_delete ON tenant_chat_settings;
CREATE POLICY tcs_delete ON tenant_chat_settings FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE tenant_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_blocks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tb_select ON tenant_blocks;
CREATE POLICY tb_select ON tenant_blocks FOR SELECT
  USING (blocker_tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS tb_insert ON tenant_blocks;
CREATE POLICY tb_insert ON tenant_blocks FOR INSERT
  WITH CHECK (blocker_tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS tb_delete ON tenant_blocks;
CREATE POLICY tb_delete ON tenant_blocks FOR DELETE
  USING (blocker_tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE tenant_directory_listing ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_directory_listing FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tdl_select ON tenant_directory_listing;
CREATE POLICY tdl_select ON tenant_directory_listing FOR SELECT USING (true);
DROP POLICY IF EXISTS tdl_update ON tenant_directory_listing;
CREATE POLICY tdl_update ON tenant_directory_listing FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS tdl_delete ON tenant_directory_listing;
CREATE POLICY tdl_delete ON tenant_directory_listing FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EOF
done
```

Expected: vários `ALTER TABLE`, `DROP POLICY` (NOTICE skipping na primeira), `CREATE POLICY` em cada banco. Sem erro.

> Nota: a migration original em Step 4.3 usa `CREATE POLICY` direto. Atualizar a migration para usar `DROP POLICY IF EXISTS ... CREATE POLICY` em **todas** as policies, garantindo idempotência quando rodada em prod a primeira vez (e em dev se alguém limpar e re-aplicar). Re-edite `apps/api/src/db/migrations/047_inter_tenant_chat.sql` substituindo cada `CREATE POLICY xxx` por `DROP POLICY IF EXISTS xxx ON tabela; CREATE POLICY xxx`.

- [ ] **Step 4.5: Rodar testes — devem passar**

Run: `cd apps/api && npx jest tests/db/migration-047-rls.test.js -t "single-tenant" 2>&1 | tail -10`

Expected: 5 PASS (settings × 2, blocks × 1, directory × 2).

- [ ] **Step 4.6: Commit**

```bash
git add apps/api/src/db/migrations/047_inter_tenant_chat.sql apps/api/tests/db/migration-047-rls.test.js
git commit -m "feat(chat): RLS em tabelas single-tenant (settings, blocks, directory)

ENABLE+FORCE em tenant_chat_settings, tenant_blocks e
tenant_directory_listing. Diretório tem SELECT livre (todos podem
listar) mas WRITE só pelo dono. Padrão NULLIF não é necessário
porque essas tabelas só são acessadas com contexto de tenant ativo."
```

---

## Task 5: RLS — tabelas par-based (conversations, messages, attachments, pii_checks, reactions, reads, invitations)

Tabelas em que a permissão se baseia em pertencer ao par `(tenant_a, tenant_b)`. A policy usa OR entre os dois lados.

**Files:**
- Modify: `apps/api/src/db/migrations/047_inter_tenant_chat.sql` (append)
- Modify: `apps/api/tests/db/migration-047-rls.test.js` (append testes par-based)

- [ ] **Step 5.1: Escrever testes de RLS par-based**

Append to `apps/api/tests/db/migration-047-rls.test.js`:

```javascript
async function createConversation(a, b) {
  const { rows: [conv] } = await pool.query(
    `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module)
     VALUES ($1, $2, 'human') RETURNING id`,
    [a.tenantId, b.tenantId]
  );
  return conv.id;
}

describe('RLS — tenant_conversations (par-based)', () => {
  it('membro vê a conversa', async () => {
    const { a, b } = await fixtures.createPair();
    const convId = await createConversation(a, b);

    const seen = await withTenant(pool, a.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_conversations WHERE id = $1`, [convId]);
      return rows.length;
    });
    expect(seen).toBe(1);
  });

  it('não-membro NÃO vê a conversa', async () => {
    const { a, b } = await fixtures.createPair();
    const c3 = await fixtures.createTenant({ name: 'NonMember-' + Date.now() });
    const convId = await createConversation(a, b);

    const seen = await withTenant(pool, c3.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_conversations WHERE id = $1`, [convId]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });
});

describe('RLS — tenant_messages (par-based via conversation_id)', () => {
  it('membro vê mensagens da própria conversa', async () => {
    const { a, b } = await fixtures.createPair();
    const convId = await createConversation(a, b);
    await pool.query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
       VALUES ($1, $2, $3, 'olá')`,
      [convId, a.tenantId, a.userId]
    );

    const seen = await withTenant(pool, b.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_messages WHERE conversation_id = $1`, [convId]);
      return rows.length;
    });
    expect(seen).toBe(1);
  });

  it('não-membro NÃO vê mensagens da conversa alheia', async () => {
    const { a, b } = await fixtures.createPair();
    const c3 = await fixtures.createTenant({ name: 'NonMemberMsg-' + Date.now() });
    const convId = await createConversation(a, b);
    await pool.query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
       VALUES ($1, $2, $3, 'segredo')`,
      [convId, a.tenantId, a.userId]
    );

    const seen = await withTenant(pool, c3.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_messages WHERE conversation_id = $1`, [convId]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });
});

describe('RLS — tenant_invitations', () => {
  it('remetente vê seu convite enviado', async () => {
    const { a, b } = await fixtures.createPair();
    const { rows: [inv] } = await pool.query(
      `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id)
       VALUES ($1, $2, 'human', 'pending', $3) RETURNING id`,
      [a.tenantId, b.tenantId, a.userId]
    );

    const seen = await withTenant(pool, a.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_invitations WHERE id = $1`, [inv.id]);
      return rows.length;
    });
    expect(seen).toBe(1);
  });

  it('destinatário vê o convite recebido', async () => {
    const { a, b } = await fixtures.createPair();
    const { rows: [inv] } = await pool.query(
      `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id)
       VALUES ($1, $2, 'human', 'pending', $3) RETURNING id`,
      [a.tenantId, b.tenantId, a.userId]
    );

    const seen = await withTenant(pool, b.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_invitations WHERE id = $1`, [inv.id]);
      return rows.length;
    });
    expect(seen).toBe(1);
  });

  it('terceiro NÃO vê o convite alheio', async () => {
    const { a, b } = await fixtures.createPair();
    const c3 = await fixtures.createTenant({ name: 'NonMemberInv-' + Date.now() });
    const { rows: [inv] } = await pool.query(
      `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id)
       VALUES ($1, $2, 'human', 'pending', $3) RETURNING id`,
      [a.tenantId, b.tenantId, a.userId]
    );

    const seen = await withTenant(pool, c3.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_invitations WHERE id = $1`, [inv.id]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });
});
```

- [ ] **Step 5.2: Rodar testes — devem falhar**

Run: `cd apps/api && npx jest tests/db/migration-047-rls.test.js -t "par-based|invitations" 2>&1 | tail -25`

Expected: alguns PASS por acaso (SELECT vê tudo ainda), mas os "NÃO vê" falham porque RLS está OFF.

- [ ] **Step 5.3: Adicionar RLS par-based à migration**

Append ao arquivo `apps/api/src/db/migrations/047_inter_tenant_chat.sql` o **mesmo bloco SQL** que será executado no Step 5.4 (com `DROP POLICY IF EXISTS` antes de cada `CREATE POLICY` conforme convenção de idempotência). O bloco completo está em Step 5.4 e cobre: função SQL helper `app_is_conversation_member()` + ENABLE+FORCE e policies par-based em 7 tabelas (`tenant_invitations`, `tenant_conversations`, `tenant_messages`, `tenant_message_attachments`, `tenant_message_pii_checks`, `tenant_message_reactions`, `tenant_conversation_reads`).

- [ ] **Step 5.4: Aplicar nos dois bancos**

```bash
for db in genomaflow genomaflow_test; do
  echo "Applying par-based RLS to $db..."
  docker compose exec -T db psql -U postgres -d $db <<'EOF'
CREATE OR REPLACE FUNCTION app_is_conversation_member(conv_id UUID) RETURNS boolean AS $$
DECLARE
  ctx_tenant UUID := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF ctx_tenant IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM tenant_conversations
    WHERE id = conv_id AND (tenant_a_id = ctx_tenant OR tenant_b_id = ctx_tenant)
  );
END;
$$ LANGUAGE plpgsql STABLE;

ALTER TABLE tenant_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invitations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ti_select ON tenant_invitations;
CREATE POLICY ti_select ON tenant_invitations FOR SELECT
  USING (
    from_tenant_id = current_setting('app.tenant_id', true)::uuid OR
    to_tenant_id   = current_setting('app.tenant_id', true)::uuid
  );
DROP POLICY IF EXISTS ti_insert ON tenant_invitations;
CREATE POLICY ti_insert ON tenant_invitations FOR INSERT
  WITH CHECK (from_tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS ti_update ON tenant_invitations;
CREATE POLICY ti_update ON tenant_invitations FOR UPDATE
  USING (
    from_tenant_id = current_setting('app.tenant_id', true)::uuid OR
    to_tenant_id   = current_setting('app.tenant_id', true)::uuid
  );

ALTER TABLE tenant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_conversations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tc_select ON tenant_conversations;
CREATE POLICY tc_select ON tenant_conversations FOR SELECT
  USING (
    tenant_a_id = current_setting('app.tenant_id', true)::uuid OR
    tenant_b_id = current_setting('app.tenant_id', true)::uuid
  );
DROP POLICY IF EXISTS tc_insert ON tenant_conversations;
CREATE POLICY tc_insert ON tenant_conversations FOR INSERT
  WITH CHECK (
    tenant_a_id = current_setting('app.tenant_id', true)::uuid OR
    tenant_b_id = current_setting('app.tenant_id', true)::uuid
  );
DROP POLICY IF EXISTS tc_update ON tenant_conversations;
CREATE POLICY tc_update ON tenant_conversations FOR UPDATE
  USING (
    tenant_a_id = current_setting('app.tenant_id', true)::uuid OR
    tenant_b_id = current_setting('app.tenant_id', true)::uuid
  );

ALTER TABLE tenant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tm_select ON tenant_messages;
CREATE POLICY tm_select ON tenant_messages FOR SELECT
  USING (app_is_conversation_member(conversation_id));
DROP POLICY IF EXISTS tm_insert ON tenant_messages;
CREATE POLICY tm_insert ON tenant_messages FOR INSERT
  WITH CHECK (
    app_is_conversation_member(conversation_id) AND
    sender_tenant_id = current_setting('app.tenant_id', true)::uuid
  );
DROP POLICY IF EXISTS tm_update ON tenant_messages;
CREATE POLICY tm_update ON tenant_messages FOR UPDATE
  USING (app_is_conversation_member(conversation_id));

ALTER TABLE tenant_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_message_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tma_select ON tenant_message_attachments;
CREATE POLICY tma_select ON tenant_message_attachments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM tenant_messages m
    WHERE m.id = message_id AND app_is_conversation_member(m.conversation_id)
  ));
DROP POLICY IF EXISTS tma_insert ON tenant_message_attachments;
CREATE POLICY tma_insert ON tenant_message_attachments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM tenant_messages m
    WHERE m.id = message_id AND m.sender_tenant_id = current_setting('app.tenant_id', true)::uuid
  ));

ALTER TABLE tenant_message_pii_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_message_pii_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tmpc_select ON tenant_message_pii_checks;
CREATE POLICY tmpc_select ON tenant_message_pii_checks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM tenant_message_attachments a
    JOIN tenant_messages m ON m.id = a.message_id
    WHERE a.id = attachment_id AND app_is_conversation_member(m.conversation_id)
  ));
DROP POLICY IF EXISTS tmpc_insert ON tenant_message_pii_checks;
CREATE POLICY tmpc_insert ON tenant_message_pii_checks FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM tenant_message_attachments a
    JOIN tenant_messages m ON m.id = a.message_id
    WHERE a.id = attachment_id AND m.sender_tenant_id = current_setting('app.tenant_id', true)::uuid
  ));

ALTER TABLE tenant_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_message_reactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tmr_select ON tenant_message_reactions;
CREATE POLICY tmr_select ON tenant_message_reactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM tenant_messages m
    WHERE m.id = message_id AND app_is_conversation_member(m.conversation_id)
  ));
DROP POLICY IF EXISTS tmr_insert ON tenant_message_reactions;
CREATE POLICY tmr_insert ON tenant_message_reactions FOR INSERT
  WITH CHECK (
    reactor_tenant_id = current_setting('app.tenant_id', true)::uuid AND
    EXISTS (
      SELECT 1 FROM tenant_messages m
      WHERE m.id = message_id AND app_is_conversation_member(m.conversation_id)
    )
  );
DROP POLICY IF EXISTS tmr_delete ON tenant_message_reactions;
CREATE POLICY tmr_delete ON tenant_message_reactions FOR DELETE
  USING (reactor_tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE tenant_conversation_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_conversation_reads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tcr_select ON tenant_conversation_reads;
CREATE POLICY tcr_select ON tenant_conversation_reads FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS tcr_upsert ON tenant_conversation_reads;
CREATE POLICY tcr_upsert ON tenant_conversation_reads FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid AND
    app_is_conversation_member(conversation_id)
  );
DROP POLICY IF EXISTS tcr_update ON tenant_conversation_reads;
CREATE POLICY tcr_update ON tenant_conversation_reads FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EOF
done
```

Expected: `CREATE FUNCTION`, vários `ALTER TABLE`, `DROP POLICY` (NOTICE skipping na primeira), `CREATE POLICY` em cada banco. Sem erro.

> **Importante:** atualize também o arquivo `apps/api/src/db/migrations/047_inter_tenant_chat.sql` com este mesmo bloco (incluindo `DROP POLICY IF EXISTS` antes de cada `CREATE POLICY`) — a primeira execução em produção precisa ser idempotente. A versão de Step 5.3 (sem `DROP POLICY IF EXISTS`) deve ser substituída por essa.

- [ ] **Step 5.5: Rodar testes par-based — devem passar**

Run: `cd apps/api && npx jest tests/db/migration-047-rls.test.js 2>&1 | tail -15`

Expected: todas as descrições passam — single-tenant + par-based + invitations.

- [ ] **Step 5.6: Commit**

```bash
git add apps/api/src/db/migrations/047_inter_tenant_chat.sql apps/api/tests/db/migration-047-rls.test.js
git commit -m "feat(chat): RLS par-based (conversations, messages, attachments, etc.)

Helper SQL app_is_conversation_member(conv_id) centraliza a lógica
'tenant atual é tenant_a OU tenant_b da conversa'. Policies em 7
tabelas usam o helper ou OR direto. Defesa em profundidade conforme
CLAUDE.md > Arquitetura Multi-tenant: queries da API ainda devem
filtrar tenant_id explicitamente."
```

---

## Task 6: Helper backend `withConversationAccess`

Helper para a API: estende `withTenant` validando que o tenant atual é membro da conversa, retornando 403 caso contrário.

**Files:**
- Create: `apps/api/src/db/conversation.js`
- Create: `apps/api/tests/db/conversation.test.js`

- [ ] **Step 6.1: Escrever os testes do helper**

Create `apps/api/tests/db/conversation.test.js`:

```javascript
const { Pool } = require('pg');
const fixtures = require('./fixtures/chat-fixtures');
const { withConversationAccess, ConversationAccessDeniedError } = require('../../src/db/conversation');

let pool;

beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST }); });
afterAll(async () => { await fixtures.closePool(); await pool.end(); });
afterEach(() => fixtures.cleanupChatFixtures());

async function createConversation(a, b) {
  const { rows: [conv] } = await pool.query(
    `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module)
     VALUES ($1, $2, 'human') RETURNING id`,
    [a.tenantId, b.tenantId]
  );
  return conv.id;
}

describe('withConversationAccess', () => {
  it('executa fn quando tenant é tenant_a', async () => {
    const { a, b } = await fixtures.createPair();
    const convId = await createConversation(a, b);

    const result = await withConversationAccess(pool, convId, a.tenantId, async (client, conv) => {
      expect(conv.id).toBe(convId);
      return 42;
    });
    expect(result).toBe(42);
  });

  it('executa fn quando tenant é tenant_b', async () => {
    const { a, b } = await fixtures.createPair();
    const convId = await createConversation(a, b);

    const result = await withConversationAccess(pool, convId, b.tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM tenant_messages WHERE conversation_id = $1`,
        [convId]
      );
      return rows[0].n;
    });
    expect(result).toBe(0);
  });

  it('rejeita com ConversationAccessDeniedError quando tenant não é membro', async () => {
    const { a, b } = await fixtures.createPair();
    const c3 = await fixtures.createTenant({ name: 'NonMemberHelper-' + Date.now() });
    const convId = await createConversation(a, b);

    await expect(
      withConversationAccess(pool, convId, c3.tenantId, async () => 'should not reach')
    ).rejects.toThrow(ConversationAccessDeniedError);
  });

  it('rejeita com ConversationAccessDeniedError para conversation_id inexistente', async () => {
    const t = await fixtures.createTenant({ name: 'Helper404-' + Date.now() });
    const fakeId = '00000000-0000-0000-0000-000000000999';

    await expect(
      withConversationAccess(pool, fakeId, t.tenantId, async () => 'unreached')
    ).rejects.toThrow(ConversationAccessDeniedError);
  });

  it('faz rollback se fn lança erro (não persiste mudanças)', async () => {
    const { a, b } = await fixtures.createPair();
    const convId = await createConversation(a, b);

    await expect(
      withConversationAccess(pool, convId, a.tenantId, async (client) => {
        await client.query(
          `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
           VALUES ($1, $2, $3, 'rollback me')`,
          [convId, a.tenantId, a.userId]
        );
        throw new Error('intencional');
      })
    ).rejects.toThrow('intencional');

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM tenant_messages WHERE conversation_id = $1`, [convId]
    );
    expect(rows[0].n).toBe(0);
  });
});
```

- [ ] **Step 6.2: Rodar testes — devem falhar (módulo não existe)**

Run: `cd apps/api && npx jest tests/db/conversation.test.js 2>&1 | tail -10`

Expected: FAIL com "Cannot find module '../../src/db/conversation'".

- [ ] **Step 6.3: Implementar o helper**

Create `apps/api/src/db/conversation.js`:

```javascript
const { withTenant } = require('./tenant');

class ConversationAccessDeniedError extends Error {
  constructor(conversationId, tenantId) {
    super(`Tenant ${tenantId} não é membro da conversa ${conversationId}`);
    this.code = 'CONVERSATION_ACCESS_DENIED';
    this.conversationId = conversationId;
    this.tenantId = tenantId;
  }
}

/**
 * Estende withTenant: valida que o tenant é membro da conversa antes de chamar fn.
 * Defesa em profundidade — RLS já bloqueia, mas o helper retorna erro semântico
 * para a API mapear em 403.
 *
 * @param {import('pg').Pool} pg
 * @param {string} conversationId
 * @param {string} tenantId
 * @param {(client, conversation) => Promise<any>} fn
 */
async function withConversationAccess(pg, conversationId, tenantId, fn) {
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, tenant_a_id, tenant_b_id, module
       FROM tenant_conversations
       WHERE id = $1
         AND (tenant_a_id = $2 OR tenant_b_id = $2)`,
      [conversationId, tenantId]
    );
    if (!rows[0]) throw new ConversationAccessDeniedError(conversationId, tenantId);
    return fn(client, rows[0]);
  });
}

module.exports = { withConversationAccess, ConversationAccessDeniedError };
```

- [ ] **Step 6.4: Rodar testes — devem passar**

Run: `cd apps/api && npx jest tests/db/conversation.test.js 2>&1 | tail -10`

Expected: 5 PASS.

- [ ] **Step 6.5: Commit**

```bash
git add apps/api/src/db/conversation.js apps/api/tests/db/conversation.test.js
git commit -m "feat(chat): helper withConversationAccess + ConversationAccessDeniedError

Estende withTenant validando explicitamente que o tenant é membro
do par (tenant_a OR tenant_b). Retorna erro semântico para API
mapear em 403. Defesa em profundidade: RLS é última camada,
filtro explícito é a primeira."
```

---

## Task 7: Smoke test integrado — ciclo completo

Cria fluxo end-to-end via SQL direto + helper, validando que tudo funciona em conjunto.

**Files:**
- Create: `apps/api/tests/db/chat-e2e-smoke.test.js`

- [ ] **Step 7.1: Escrever smoke test**

Create `apps/api/tests/db/chat-e2e-smoke.test.js`:

```javascript
const { Pool } = require('pg');
const fixtures = require('./fixtures/chat-fixtures');
const { withTenant } = require('../../src/db/tenant');
const { withConversationAccess } = require('../../src/db/conversation');

let pool;

beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST }); });
afterAll(async () => { await fixtures.closePool(); await pool.end(); });
afterEach(() => fixtures.cleanupChatFixtures());

describe('Chat E2E smoke (DB layer)', () => {
  it('ciclo completo: settings → diretório → convite → conversa → mensagem → reação → read', async () => {
    const { a, b } = await fixtures.createPair();

    // 1. Ambos opt-in no diretório
    await withTenant(pool, a.tenantId, (c) =>
      c.query(`INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)`, [a.tenantId])
    );
    await withTenant(pool, b.tenantId, (c) =>
      c.query(`INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)`, [b.tenantId])
    );

    // 2. A vê B no diretório
    const dirCount = await withTenant(pool, a.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM tenant_directory_listing WHERE tenant_id = $1`, [b.tenantId]
      );
      return rows[0].n;
    });
    expect(dirCount).toBe(1);

    // 3. A convida B
    const inviteId = await withTenant(pool, a.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id)
         VALUES ($1, $2, 'human', 'pending', $3) RETURNING id`,
        [a.tenantId, b.tenantId, a.userId]
      );
      return rows[0].id;
    });

    // 4. B aceita o convite e conversa é criada
    const convId = await withTenant(pool, b.tenantId, async (c) => {
      await c.query(
        `UPDATE tenant_invitations SET status='accepted', responded_by_user_id=$1, responded_at=NOW() WHERE id=$2`,
        [b.userId, inviteId]
      );
      const { rows } = await c.query(
        `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module, created_from_invitation_id)
         VALUES ($1, $2, 'human', $3) RETURNING id`,
        [a.tenantId, b.tenantId, inviteId]
      );
      return rows[0].id;
    });

    // 5. A envia mensagem
    const msgId = await withConversationAccess(pool, convId, a.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
         VALUES ($1, $2, $3, 'olá vizinho') RETURNING id`,
        [convId, a.tenantId, a.userId]
      );
      return rows[0].id;
    });

    // 6. B lê mensagens e reage com 👍
    const msgRead = await withConversationAccess(pool, convId, b.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT body FROM tenant_messages WHERE id = $1`, [msgId]);
      await c.query(
        `INSERT INTO tenant_message_reactions (message_id, reactor_tenant_id, reactor_user_id, emoji)
         VALUES ($1, $2, $3, '👍')`,
        [msgId, b.tenantId, b.userId]
      );
      await c.query(
        `INSERT INTO tenant_conversation_reads (conversation_id, tenant_id, last_read_message_id)
         VALUES ($1, $2, $3)`,
        [convId, b.tenantId, msgId]
      );
      return rows[0].body;
    });
    expect(msgRead).toBe('olá vizinho');

    // 7. A vê reação de B
    const reactionEmoji = await withConversationAccess(pool, convId, a.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT emoji FROM tenant_message_reactions WHERE message_id = $1`, [msgId]
      );
      return rows[0].emoji;
    });
    expect(reactionEmoji).toBe('👍');

    // 8. Full-text search funciona
    const searchHits = await withConversationAccess(pool, convId, a.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id FROM tenant_messages
         WHERE conversation_id = $1
           AND body_tsv @@ plainto_tsquery('portuguese', 'vizinho')`,
        [convId]
      );
      return rows.length;
    });
    expect(searchHits).toBe(1);
  });

  it('terceiro tenant não consegue acessar nada do par', async () => {
    const { a, b } = await fixtures.createPair();
    const c3 = await fixtures.createTenant({ name: 'E2EThird-' + Date.now() });

    // A e B trocam mensagens
    const { rows: [conv] } = await pool.query(
      `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module) VALUES ($1, $2, 'human') RETURNING id`,
      [a.tenantId, b.tenantId]
    );
    await pool.query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
       VALUES ($1, $2, $3, 'segredo')`,
      [conv.id, a.tenantId, a.userId]
    );

    // C3 tenta acessar
    const { withConversationAccess, ConversationAccessDeniedError } = require('../../src/db/conversation');
    await expect(
      withConversationAccess(pool, conv.id, c3.tenantId, async () => 'unreached')
    ).rejects.toThrow(ConversationAccessDeniedError);

    // C3 também não vê via SELECT direto (RLS)
    const seenMsgs = await withTenant(pool, c3.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT body FROM tenant_messages WHERE conversation_id = $1`, [conv.id]);
      return rows.length;
    });
    expect(seenMsgs).toBe(0);
  });
});
```

- [ ] **Step 7.2: Rodar smoke test**

Run: `cd apps/api && npx jest tests/db/chat-e2e-smoke.test.js 2>&1 | tail -15`

Expected: 2 PASS.

- [ ] **Step 7.3: Rodar a suíte completa de DB do chat — sanity final**

Run: `cd apps/api && npx jest tests/db/ 2>&1 | tail -15`

Expected: 0 FAIL. Aproximadamente:
- migration-047.test.js: 13 + 6 = 19 tests
- migration-047-trigger.test.js: 4 tests
- migration-047-rls.test.js: 5 + 6 = 11 tests
- conversation.test.js: 5 tests
- chat-e2e-smoke.test.js: 2 tests
- **Total**: ~41 tests

- [ ] **Step 7.4: Commit**

```bash
git add apps/api/tests/db/chat-e2e-smoke.test.js
git commit -m "test(chat): smoke E2E do DB layer — ciclo completo + isolamento

Valida em integração: settings → diretório (via trigger) → convite →
conversa → mensagem → reação → read → busca full-text. Garante que
um terceiro tenant não acessa nada via helper nem via SELECT direto."
```

---

## Task 8: Verificar idempotência da migration + entrega

A migration precisa ser idempotente (re-rodar sem erro) e atualizar a doc de schema.

**Files:**
- Verify: `apps/api/src/db/migrations/047_inter_tenant_chat.sql`
- Modify: `CLAUDE.md` (lista de tabelas com RLS)

- [ ] **Step 8.1: Re-rodar a migration deve ser no-op (validar idempotência)**

```bash
docker cp apps/api/src/db/migrations/047_inter_tenant_chat.sql genomaflow-db-1:/tmp/047b.sql
docker compose exec -T db psql -U postgres -d genomaflow -f /tmp/047b.sql 2>&1 | tail -20
```

Expected: vários `NOTICE: ... already exists, skipping` (em `IF NOT EXISTS`), `NOTICE: trigger does not exist, skipping` (em `DROP TRIGGER IF EXISTS`), `NOTICE: policy does not exist, skipping` (idem). **Nenhum ERROR**. Se aparecer `ERROR: policy "xxx" for table "yyy" already exists`, voltar e aplicar a convenção de idempotência (`DROP POLICY IF EXISTS` antes de `CREATE POLICY`) declarada no início desta plan.

- [ ] **Step 8.2: Atualizar CLAUDE.md com as 10 novas tabelas RLS**

Edit `CLAUDE.md` na seção `### Tabelas com RLS ativo (ENABLE + FORCE)`:

Adicionar à lista existente (após `treatment_items`):
```
, `tenant_chat_settings`, `tenant_blocks`, `tenant_directory_listing`, `tenant_invitations`, `tenant_conversations`, `tenant_messages`, `tenant_message_attachments`, `tenant_message_pii_checks`, `tenant_message_reactions`, `tenant_conversation_reads`
```

- [ ] **Step 8.3: Rodar suíte completa de testes do projeto pra garantir zero regressão**

Run: `cd apps/api && npx jest 2>&1 | tail -10`

Expected: nenhum teste pré-existente quebrou. Os testes novos do chat passam. Total geral PASS.

- [ ] **Step 8.4: Commit final da fase**

```bash
git add CLAUDE.md
git commit -m "docs(chat): registra 10 novas tabelas RLS do chat em CLAUDE.md

Mantém o inventário de tabelas com ENABLE+FORCE atualizado conforme
regra de 'Tabelas com RLS ativo' do CLAUDE.md."
```

- [ ] **Step 8.5: Push da branch**

```bash
git push -u origin feat/chat-phase1-schema-rls 2>&1 | tail -3
```

- [ ] **Step 8.6: Criar PR ou merge direto (decisão do humano)**

Se o usuário aprovar review, fazer:
```bash
git checkout main && git pull --ff-only origin main
git merge --no-ff feat/chat-phase1-schema-rls -m "merge: feat/chat-phase1-schema-rls → main"
git push origin main
```

CI/CD do GitHub Actions vai aplicar a migration em produção via task ECS `genomaflow-prod-migrate`. Monitorar `gh run watch` + ECS rollout (mesmo padrão das fases anteriores).

---

## Critérios de "pronto" da Fase 1

- [ ] Migration 047 cria 10 tabelas + extensão pg_trgm + índices + triggers + policies sem erro
- [ ] 41 testes do chat passam no DB de teste (`npx jest tests/db/`)
- [ ] Suíte completa do projeto passa sem regressão (`npx jest`)
- [ ] Helper `withConversationAccess` exportado e coberto por testes
- [ ] CLAUDE.md atualizado com as 10 novas tabelas RLS
- [ ] Branch `feat/chat-phase1-schema-rls` mergeada na main
- [ ] Migration aplicada em produção via CI/CD (verificada via `aws ecs describe-services`)

## Roadmap das próximas fases (planos serão escritos após Fase 1 fechar)

| Fase | Escopo | Branch | Plano |
|---|---|---|---|
| 2 | API endpoints (settings, directory, invitations, blocks, conversations, messages, reads) | `feat/chat-phase2-api` | a escrever |
| 3 | WebSocket events + frontend Chat shell + lista + thread + envio texto | `feat/chat-phase3-frontend` | a escrever |
| 4 | Anexo análise IA (cards anonimizados) | `feat/chat-phase4-ai-attach` | a escrever |
| 5 | Pipeline PII + anexo PDF + anexo imagem | `feat/chat-phase5-pii-attach` | a escrever |
| 6 | Reações + busca full-text + badge unread | `feat/chat-phase6-search-react-badge` | a escrever |
| 7 | Anti-abuso (rate limit, cooldown, denúncia) + email | `feat/chat-phase7-antiabuse` | a escrever |
| 8 | Smoke test E2E + audit log + ajuste UX | `feat/chat-phase8-polish` | a escrever |

Cada plano será escrito fresh quando a fase anterior fechar, com o estado real do código no momento.
