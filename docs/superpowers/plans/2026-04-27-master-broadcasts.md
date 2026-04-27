# Master Broadcasts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canal oficial "Administrador do GenomaFlow" — master envia mensagens com anexos (img/PDF) pra tenants segmentados (all/module/tenant); tenants veem na sidebar do chat e podem responder.

**Architecture:** Reaproveita `tenant_conversations`/`tenant_messages` com novo `kind='master_broadcast'`. Migration 058 adiciona coluna + tabelas canônicas. Fan-out síncrono master→N tenants via UPSERT de conversação. Markdown sanitizado client-side com DOMPurify. Read receipts via `tenant_conversation_reads` existente.

**Tech Stack:** PostgreSQL 15 (migrations + RLS), Fastify (rotas master + tenant), Angular 18 standalone (UI), Redis pub/sub (WS), S3 (anexos), DOMPurify (markdown sanitization).

---

## Fase 1 — Schema + helpers backend

### Task 1: Migration 058 — schema novo + ajuste trigger

**Files:**
- Create: `apps/api/src/db/migrations/058_master_broadcasts.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 058_master_broadcasts.sql
-- Master Broadcasts: canal "Administrador do GenomaFlow" → tenants.
-- Reaproveita tenant_conversations/tenant_messages com kind='master_broadcast'.
-- Idempotente.

-- 1. Coluna kind (default preserva comportamento atual)
ALTER TABLE tenant_conversations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'tenant_to_tenant';

DO $$ BEGIN
  ALTER TABLE tenant_conversations
    ADD CONSTRAINT tenant_conversations_kind_check
    CHECK (kind IN ('tenant_to_tenant', 'master_broadcast'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS tenant_conversations_kind_master_idx
  ON tenant_conversations(kind, last_message_at DESC) WHERE kind = 'master_broadcast';

-- 2. Skip cross-module check em master broadcasts (master tenant é human, mas
-- envia pra vet também)
CREATE OR REPLACE FUNCTION enforce_chat_same_module() RETURNS trigger AS $$
DECLARE
  module_a TEXT; module_b TEXT;
BEGIN
  -- Master broadcasts são cross-module by design — skip
  IF TG_TABLE_NAME = 'tenant_conversations' AND NEW.kind = 'master_broadcast' THEN
    RETURN NEW;
  END IF;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger já está registrado (047), só atualizamos a função; não precisa DROP/CREATE TRIGGER.

-- 3. Tabela canônica de broadcasts
CREATE TABLE IF NOT EXISTS master_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  segment_kind TEXT NOT NULL CHECK (segment_kind IN ('all', 'module', 'tenant')),
  segment_value TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS master_broadcasts_created_at_idx
  ON master_broadcasts(created_at DESC);

ALTER TABLE master_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_broadcasts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mb_master_only ON master_broadcasts;
CREATE POLICY mb_master_only ON master_broadcasts USING (
  NULLIF(current_setting('app.tenant_id', true), '') IS NULL
);

-- 4. Anexos do broadcast (compartilhados entre tenants — 1 S3 obj p/ N delivery)
CREATE TABLE IF NOT EXISTS master_broadcast_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES master_broadcasts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'pdf')),
  filename TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS master_broadcast_attachments_broadcast_idx
  ON master_broadcast_attachments(broadcast_id);

ALTER TABLE master_broadcast_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_broadcast_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mba_master_only ON master_broadcast_attachments;
CREATE POLICY mba_master_only ON master_broadcast_attachments USING (
  NULLIF(current_setting('app.tenant_id', true), '') IS NULL
);

-- 5. Delivery tracking
CREATE TABLE IF NOT EXISTS master_broadcast_deliveries (
  broadcast_id UUID NOT NULL REFERENCES master_broadcasts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES tenant_conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES tenant_messages(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (broadcast_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS mbd_tenant_delivered_idx
  ON master_broadcast_deliveries(tenant_id, delivered_at DESC);

ALTER TABLE master_broadcast_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_broadcast_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mbd_master_only ON master_broadcast_deliveries;
CREATE POLICY mbd_master_only ON master_broadcast_deliveries USING (
  NULLIF(current_setting('app.tenant_id', true), '') IS NULL
);

-- 6. GRANTs
GRANT SELECT, INSERT, UPDATE ON master_broadcasts TO genomaflow_app;
GRANT SELECT, INSERT, DELETE ON master_broadcast_attachments TO genomaflow_app;
GRANT SELECT, INSERT, DELETE ON master_broadcast_deliveries TO genomaflow_app;
```

- [ ] **Step 2: Aplicar local + verificar shape**

```bash
docker compose exec api node src/db/migrate.js
docker compose exec db psql -U genomaflow -c "\d master_broadcasts"
docker compose exec db psql -U genomaflow -c "\d tenant_conversations" | grep kind
```

- [ ] **Step 3: Smoke test — INSERT manual de broadcast**

```bash
docker compose exec db psql -U genomaflow -c "
  -- Conversação master→tenant existente cross-module deve funcionar agora
  INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module, kind)
  VALUES ('00000000-0000-0000-0000-000000000001',
          (SELECT id FROM tenants WHERE module='veterinary' AND active=true LIMIT 1),
          'veterinary', 'master_broadcast')
  RETURNING id, kind;"
```

Esperado: INSERT bem-sucedido (não dispara cross-module error).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/058_master_broadcasts.sql
git commit -m "feat(master-broadcasts): migration 058 — schema + cross-module skip (Fase 1)"
```

### Task 2: Helper de fan-out

**Files:**
- Create: `apps/api/src/services/master-broadcasts.js`
- Test: `apps/api/tests/services/master-broadcasts.test.js`

- [ ] **Step 1: Escrever teste failing**

```js
// tests/services/master-broadcasts.test.js
const { resolveTargetTenants } = require('../../src/services/master-broadcasts');

describe('resolveTargetTenants', () => {
  test('all → SELECT id FROM tenants WHERE active AND id != master', async () => {
    const pg = { query: jest.fn(async () => ({ rows: [{ id: 't1', module: 'human' }, { id: 't2', module: 'veterinary' }] })) };
    const result = await resolveTargetTenants(pg, { kind: 'all' });
    expect(result).toEqual([{ id: 't1', module: 'human' }, { id: 't2', module: 'veterinary' }]);
    expect(pg.query.mock.calls[0][0]).toMatch(/active = true/);
    expect(pg.query.mock.calls[0][0]).toMatch(/id <> /);
  });

  test('module=human → AND module=$1', async () => {
    const pg = { query: jest.fn(async () => ({ rows: [{ id: 't1', module: 'human' }] })) };
    await resolveTargetTenants(pg, { kind: 'module', value: 'human' });
    expect(pg.query.mock.calls[0][1]).toContain('human');
  });

  test('tenant → SELECT WHERE id=$1 AND active', async () => {
    const pg = { query: jest.fn(async () => ({ rows: [{ id: 'specific', module: 'human' }] })) };
    const result = await resolveTargetTenants(pg, { kind: 'tenant', value: 'specific' });
    expect(result).toEqual([{ id: 'specific', module: 'human' }]);
  });

  test('tenant inativo → array vazio', async () => {
    const pg = { query: jest.fn(async () => ({ rows: [] })) };
    const result = await resolveTargetTenants(pg, { kind: 'tenant', value: 'gone' });
    expect(result).toEqual([]);
  });

  test('module inválido → throw', async () => {
    const pg = { query: jest.fn() };
    await expect(resolveTargetTenants(pg, { kind: 'module', value: 'invalid' }))
      .rejects.toThrow(/module inválido/);
  });
});
```

- [ ] **Step 2: Implementar mínimo pra passar**

```js
// services/master-broadcasts.js
'use strict';
const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const VALID_MODULES = ['human', 'veterinary'];

async function resolveTargetTenants(pg, segment) {
  const { kind, value } = segment;
  if (kind === 'all') {
    const { rows } = await pg.query(
      'SELECT id, module FROM tenants WHERE active = true AND id <> $1 ORDER BY name',
      [MASTER_TENANT_ID]
    );
    return rows;
  }
  if (kind === 'module') {
    if (!VALID_MODULES.includes(value)) throw new Error('module inválido');
    const { rows } = await pg.query(
      'SELECT id, module FROM tenants WHERE active = true AND id <> $1 AND module = $2 ORDER BY name',
      [MASTER_TENANT_ID, value]
    );
    return rows;
  }
  if (kind === 'tenant') {
    const { rows } = await pg.query(
      'SELECT id, module FROM tenants WHERE id = $1 AND active = true AND id <> $2',
      [value, MASTER_TENANT_ID]
    );
    return rows;
  }
  throw new Error('segment kind inválido');
}

module.exports = { resolveTargetTenants, MASTER_TENANT_ID };
```

- [ ] **Step 3: Run tests + commit**

```bash
cd apps/api && npx jest tests/services/master-broadcasts.test.js
git add apps/api/src/services/master-broadcasts.js apps/api/tests/services/master-broadcasts.test.js
git commit -m "feat(master-broadcasts): helper resolveTargetTenants + tests"
```

### Task 3: Fan-out helper (cria conversation + message + delivery por tenant)

- [ ] **Step 1: Estender services/master-broadcasts.js**

```js
async function deliverToTenant(client, { broadcastId, masterUserId, recipientTenant, body }) {
  // UPSERT conversação master ↔ tenant (par canônico master é sempre tenant_a)
  const convRes = await client.query(`
    INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module, kind)
    VALUES ($1, $2, $3, 'master_broadcast')
    ON CONFLICT (tenant_a_id, tenant_b_id) DO UPDATE
      SET last_message_at = NOW()
    RETURNING id`,
    [MASTER_TENANT_ID, recipientTenant.id, recipientTenant.module]
  );
  const conversationId = convRes.rows[0].id;

  // INSERT message
  const msgRes = await client.query(`
    INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
    VALUES ($1, $2, $3, $4)
    RETURNING id`,
    [conversationId, MASTER_TENANT_ID, masterUserId, body]
  );
  const messageId = msgRes.rows[0].id;

  // UPDATE last_message_at na conversation
  await client.query('UPDATE tenant_conversations SET last_message_at = NOW() WHERE id = $1', [conversationId]);

  // INSERT delivery tracking
  await client.query(`
    INSERT INTO master_broadcast_deliveries (broadcast_id, tenant_id, conversation_id, message_id)
    VALUES ($1, $2, $3, $4)`,
    [broadcastId, recipientTenant.id, conversationId, messageId]
  );

  return { conversationId, messageId };
}
```

- [ ] **Step 2: Test deliverToTenant**

(Mock client, valida sequência de queries: INSERT conv → INSERT msg → UPDATE conv → INSERT delivery)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(master-broadcasts): deliverToTenant helper + tests"
```

### Task 4: Mergear Fase 1 → main após aprovação

---

## Fase 2 — POST /master/broadcasts (texto-only)

### Task 5: Endpoint POST /master/broadcasts

**Files:**
- Modify: `apps/api/src/routes/master.js`
- Test: `apps/api/tests/routes/master-broadcasts.test.js`

- [ ] **Step 1: Escrever teste de validation gate (sem DB)**

Padrão Fastify isolado igual `master-audit-log.test.js`. Cobre:
- ACL master-only (admin/doctor → 403; sem auth → 401)
- Body vazio → 400
- Body > 2000 chars → 400
- segment.kind inválido → 400
- segment.kind=module mas value inválido → 400
- segment.kind=tenant sem value → 400
- Rate limit 20/dia (mock contador)

- [ ] **Step 2: Implementar endpoint**

```js
fastify.post('/broadcasts', {
  ...auth(),
  config: { rateLimit: { max: 20, timeWindow: '1 day' } },
}, async (request, reply) => {
  const { body, segment } = request.body || {};
  // validações ...
  const targets = await resolveTargetTenants(fastify.pg, segment);
  if (targets.length === 0) return reply.status(400).send({ error: 'Nenhum tenant elegível pra esse segmento' });

  // INSERT broadcast canonical
  const { rows: [bc] } = await fastify.pg.query(
    `INSERT INTO master_broadcasts (sender_user_id, body, segment_kind, segment_value, recipient_count)
     VALUES ($1, $2, $3, $4, 0) RETURNING id`,
    [request.user.user_id, body.trim(), segment.kind, segment.value || null]
  );

  // Fan-out síncrono (até ~500 tenants)
  for (const t of targets) {
    await withTenant(fastify.pg, t.id, async (client) => {
      const { conversationId, messageId } = await deliverToTenant(client, {
        broadcastId: bc.id,
        masterUserId: request.user.user_id,
        recipientTenant: t,
        body: body.trim(),
      });
      // WS notify via Redis pub/sub (padrão existente)
      await fastify.redis.publish(`chat:event:${t.id}`, JSON.stringify({
        event: 'master_broadcast_received',
        conversation_id: conversationId,
        message_id: messageId,
      }));
    }, { userId: request.user.user_id, channel: 'system' });
  }

  await fastify.pg.query('UPDATE master_broadcasts SET recipient_count = $1 WHERE id = $2', [targets.length, bc.id]);
  return { broadcast_id: bc.id, recipient_count: targets.length };
});
```

- [ ] **Step 3: ACL test em master-acl.test.js**

Adicionar `{ method: 'POST', url: '/master/broadcasts' }` ao routes array.

- [ ] **Step 4: Smoke test E2E**

```bash
curl -X POST http://localhost:3000/master/broadcasts \
  -H "Authorization: Bearer $MASTER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body":"Teste de broadcast","segment":{"kind":"all"}}'

# Verificar:
# - master_broadcasts row criada
# - tenant_conversations rows com kind='master_broadcast'
# - tenant_messages rows entregues
# - master_broadcast_deliveries populadas
docker compose exec db psql -U genomaflow -c "SELECT id, recipient_count FROM master_broadcasts ORDER BY created_at DESC LIMIT 1"
```

- [ ] **Step 5: Commit + push + aguardar OK pra mergear**

---

## Fase 3 — Tenant UI: sidebar pinned + thread + reply

### Task 6: Backend — incluir kind no GET conversations + skip blocks em messages

**Files:**
- Modify: `apps/api/src/routes/inter-tenant-chat/conversations.js` (já retorna kind via `tc.*`)
- Modify: `apps/api/src/routes/inter-tenant-chat/messages.js` (skip tenant_blocks check quando conversa.kind='master_broadcast')

- [ ] **Step 1: Test — tenant respondendo em master_broadcast NÃO consulta tenant_blocks**

(Usa Fastify isolated com mock; valida que pg.query não foi chamado com query de tenant_blocks quando kind='master_broadcast')

- [ ] **Step 2: Adicionar guard no messages.js**

```js
// Antes de checar block:
const convRes = await client.query('SELECT kind FROM tenant_conversations WHERE id = $1', [conversationId]);
const isMasterBroadcast = convRes.rows[0]?.kind === 'master_broadcast';
if (!isMasterBroadcast) {
  // checagem tenant_blocks existente
}
```

- [ ] **Step 3: Test — fluxo tenant↔tenant existente NÃO regrediu**

(Roda tests/routes/inter-tenant-chat/messages-validation.test.js completo — todos verdes)

- [ ] **Step 4: Commit**

### Task 7: Frontend — sidebar pinned + thread render + branding

**Files:**
- Modify: `apps/web/src/app/features/chat/chat-panel.component.ts`
- Modify: `apps/web/src/app/features/chat/chat.service.ts`

- [ ] **Step 1: ChatService — adicionar Conversation.kind ao type**

- [ ] **Step 2: Sidebar — sortar master_broadcast no topo**

```ts
sortedConversations = computed(() => {
  const list = [...this.conversations()];
  list.sort((a, b) => {
    if (a.kind === 'master_broadcast' && b.kind !== 'master_broadcast') return -1;
    if (b.kind === 'master_broadcast' && a.kind !== 'master_broadcast') return 1;
    return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
  });
  return list;
});
```

- [ ] **Step 3: Render conversation card — branding diferente pra master**

```html
@if (conv.kind === 'master_broadcast') {
  <div class="conv-card pinned">
    <mat-icon>admin_panel_settings</mat-icon>
    <strong>Administrador GenomaFlow</strong>
  </div>
} @else {
  <!-- card normal existente -->
}
```

- [ ] **Step 4: Thread — render markdown sanitizado pra mensagens master**

```ts
import DOMPurify from 'dompurify';
import { marked } from 'marked';

renderMaster(body: string): SafeHtml {
  const html = marked.parse(body, { breaks: true, async: false });
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p','strong','em','a','ul','ol','li','code','pre','h2','h3','br'],
    ALLOWED_ATTR: ['href','rel','target'],
  });
  return this.sanitizer.bypassSecurityTrustHtml(clean);
}
```

- [ ] **Step 5: Disable bloquear/sair pra master conversations**

- [ ] **Step 6: Smoke test no browser**

Login como tenant admin → ver conversa pinned no topo se houver broadcast. Click → thread renderiza. Reply funciona.

- [ ] **Step 7: Commit**

---

## Fase 4 — Anexos (imagem + PDF)

### Task 8: Backend — aceitar attachments[] no POST /master/broadcasts

- [ ] **Step 1: Validation — kind whitelist (image/pdf), MIME, size <= 10MB**
- [ ] **Step 2: Upload S3 — prefix `master-broadcasts/{broadcast_id}/{filename}`. Parametrizar `BUCKET_S3` env var**
- [ ] **Step 3: IAM update** — task ECS `genomaflow-ecs-TaskRole*` precisa de PutObject/GetObject em `master-broadcasts/*`. Atualizar `infra/lib/ecs-stack.ts` (ou onde estiver a policy) e `cdk deploy` na PR
- [ ] **Step 4: INSERT em master_broadcast_attachments + tenant_message_attachments por entrega**
- [ ] **Step 5: Skip PII checks (master sabe o que envia)**
- [ ] **Step 6: Test — happy path com imagem JPEG; rejeição de MIME inválido; rejeição de tamanho > 10MB**

### Task 9: Frontend master composer — attachment upload

- [ ] **Step 1: File input com preview**
- [ ] **Step 2: Convert pra base64**
- [ ] **Step 3: Tests — validação client-side de tamanho e MIME**

### Task 10: Frontend tenant — render anexos

- [ ] **Step 1: Render <img> pra anexo image (signed URL via GET /attachments/:id/url existente)**
- [ ] **Step 2: Render link "Baixar PDF" pra anexo pdf**
- [ ] **Step 3: Smoke test E2E com imagem + PDF**

### Task 11: Commit + merge Fase 4

---

## Fase 5 — UI master: tab "Comunicados"

### Task 12: GET /master/broadcasts (histórico + métricas)

- [ ] **Step 1: SQL com JOIN deliveries + reads pra computar read_count**

```sql
SELECT mb.id, mb.body, mb.segment_kind, mb.segment_value, mb.recipient_count, mb.created_at,
       COUNT(DISTINCT tcr.tenant_id) FILTER (WHERE tcr.last_read_at >= mbd.delivered_at) AS read_count
FROM master_broadcasts mb
LEFT JOIN master_broadcast_deliveries mbd ON mbd.broadcast_id = mb.id
LEFT JOIN tenant_conversation_reads tcr ON tcr.conversation_id = mbd.conversation_id AND tcr.tenant_id = mbd.tenant_id
WHERE mb.created_at > NOW() - INTERVAL '$1 days'
GROUP BY mb.id
ORDER BY mb.created_at DESC
LIMIT $2
```

- [ ] **Step 2: ACL test + handler test**

### Task 13: GET /master/broadcasts/:id (drill-down)

- [ ] **Step 1: Detalhe com lista de tenants e flag lido**

### Task 14: GET /master/conversations + /master/conversations/:id/messages

- [ ] **Step 1: Inbox de master_broadcast conversations com unread count**
- [ ] **Step 2: Thread completa**

### Task 15: POST /master/conversations/:id/reply

- [ ] **Step 1: Validation: conversation.kind='master_broadcast', master role**
- [ ] **Step 2: INSERT em tenant_messages + Redis publish**
- [ ] **Step 3: Rate limit 100/dia**
- [ ] **Step 4: Tests**

### Task 16: UI master — tab "Comunicados"

**Files:**
- Modify: `apps/web/src/app/features/master/master.component.ts`

- [ ] **Step 1: Adicionar tab `{ id: 'comunicados', label: 'Comunicados', icon: 'campaign' }`**
- [ ] **Step 2: Composer signal + segment selector + attachment upload**
- [ ] **Step 3: Histórico com métricas inline (X de Y leram)**
- [ ] **Step 4: Inbox de respostas com unread badge**
- [ ] **Step 5: Conversation viewer + reply box**
- [ ] **Step 6: Smoke test E2E full flow**

### Task 17: Commit + merge Fase 5

---

## Fase 6 — Tests + docs/memória

### Task 18: Cobertura de testes adicional

- [ ] **Step 1: tests/routes/master-broadcasts.test.js completo (todos os endpoints)**
- [ ] **Step 2: Adicionar ao test:unit (CI gate)**
- [ ] **Step 3: Test E2E manual com checklist explícito (segmento all/module/tenant; attachments; reply tenant→master; reply master→tenant; read receipts atualizando)**

### Task 19: Atualizar docs

- [ ] **Step 1: CLAUDE.md — nova seção "Comunicados (Master Broadcasts)" com regras**
- [ ] **Step 2: docs/claude-memory/project_context.md — descrever feature**
- [ ] **Step 3: docs/claude-memory/project_master_broadcasts.md — memória dedicada**
- [ ] **Step 4: docs/claude-memory/MEMORY.md — entry**
- [ ] **Step 5: ~/.claude/projects/.../memory/ — replicar**

### Task 20: Higienização final + smoke test produção

- [ ] **Step 1: git stash list (esperar vazio)**
- [ ] **Step 2: branch cleanup das 6 fases**
- [ ] **Step 3: Smoke test em prod após deploy do CI/CD: master envia broadcast → tenant logado vê em ~5s**

## Self-Review checklist

- [ ] Toda mudança em policies/triggers existentes preservou comportamento atual (cross-module só skipa em master_broadcast)
- [ ] tenant_blocks/cooldown só skipam quando kind='master_broadcast' — fluxo tenant↔tenant intocado
- [ ] PII checks: master skipa origem (broadcast); tenants em reply mantêm regra normal
- [ ] Rate limits: master 20/dia broadcasts + 100/dia replies; tenants mantêm seus limites
- [ ] CI gate (test:unit) ganhou cobertura nova sem quebrar nada
- [ ] Audit log captura via trigger genérico do 055 (master_broadcasts não tem trigger explícito; é tabela de fluxo, não entidade clínica)
- [ ] IAM S3 atualizado pra `master-broadcasts/*` antes do deploy de Fase 4
- [ ] Markdown render: DOMPurify whitelist explícita; só aplicado em mensagens onde sender_tenant_id = master_tenant_id
