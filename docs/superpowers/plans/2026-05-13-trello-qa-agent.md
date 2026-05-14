# Trello QA Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Webhook Trello → worker BullMQ → Claude Agent que enriquece cards na coluna QA (triagem automática) e, sob `/fix aprovado` por dev/PO, edita codebase + roda testes + abre PR no GitHub.

**Architecture:** API recebe webhook Trello, valida HMAC, parse evento, enfileira BullMQ. Worker dispara agente Claude com Tool Use loop (read/list/grep/edit/test). Triagem só comenta análise no card; fix roda testes locais e SE passam abre PR via Octokit. Auditoria completa em `trello_fix_attempts`.

**Tech Stack:** Fastify (API existente), BullMQ (queue existente), `@anthropic-ai/sdk` (já instalado), `@octokit/rest` (a instalar), Trello REST via `fetch` nativo, Postgres (audit), SSM (secrets).

**Spec:** `docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md`.

---

## File structure

### Backend (apps/api)
| Arquivo | Responsabilidade |
|---|---|
| `src/db/migrations/105_trello_fix_attempts.sql` | NOVO — audit table |
| `src/services/trello-client.js` | NOVO — REST wrap Trello (getCard, addComment, addLabel, listLabels) |
| `src/services/trello-fix-attempts.js` | NOVO — CRUD audit (createAttempt, markRunning, markCompleted, markFailed, getLastAttempt, countCompletedAttempts) |
| `src/queues/trello-qa-queue.js` | NOVO — BullMQ producer |
| `src/routes/webhooks/trello.js` | NOVO — webhook receiver (HMAC verify, parse, slash command dispatch, enqueue) |
| `src/server.js` | MODIFY — register route |

### Worker (apps/worker)
| Arquivo | Responsabilidade |
|---|---|
| `src/lib/codebase-tools.js` | NOVO — tool definitions (read/list/grep + edit/create + run_tests + run_lint) com allowlist |
| `src/lib/github-pr.js` | NOVO — Octokit wrapper (createBranch, commitFiles, openPR) |
| `src/agents/trello-triage.js` | NOVO — Claude loop read-only + format markdown comment |
| `src/agents/trello-fix.js` | NOVO — Claude loop full + run_tests gate + PR creation |
| `src/processors/trello-qa.js` | NOVO — dispatch triage/fix conforme job.event |
| `src/index.js` | MODIFY — register worker `trello-qa` |

### Infra
| Arquivo | Responsabilidade |
|---|---|
| `infra/lib/ecs-stack.ts` | MODIFY — adiciona 7 SSM secrets em containerDefinitions[].secrets |

### Tests
| Arquivo | Cobre |
|---|---|
| `apps/api/tests/services/trello-fix-attempts.test.js` | createAttempt + transições + count |
| `apps/api/tests/services/trello-client.test.js` | REST wrap (mock fetch) |
| `apps/api/tests/routes/webhooks/trello.test.js` | HMAC valid/invalid, parse, slash command dispatch |
| `apps/worker/tests/lib/codebase-tools.test.js` | Allowlist, file ops, grep |
| `apps/worker/tests/lib/github-pr.test.js` | Octokit wrap (mock) |
| `apps/worker/tests/agents/trello-triage.test.js` | Claude loop mock, comment format |
| `apps/worker/tests/agents/trello-fix.test.js` | Loop + run_tests gate + PR/no-PR |

---

## Pre-requisites

1. Branch `feat/trello-qa-agent` já criada.
2. Spec já commitado.
3. Time interno tem board Trello configurado (não vamos configurar nesse plano — é manual).
4. PAT do GitHub bot a obter quando aplicar SSM (não bloqueia desenvolvimento — mock em dev).

---

## Sub-fase T-A: Migration + audit service

### Task 1: Migration 105 `trello_fix_attempts`

**Files:**
- Create: `apps/api/src/db/migrations/105_trello_fix_attempts.sql`

- [ ] **Step 1: Escrever migration**

```sql
-- 105_trello_fix_attempts.sql
-- Audit trail do Trello QA Agent. 1 row por triagem ou tentativa de fix.
-- attempt=0 é triagem; attempt=1,2,... são tentativas de fix.
-- Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §5

CREATE TABLE IF NOT EXISTS trello_fix_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id         TEXT NOT NULL,
  card_short_id   TEXT NOT NULL,
  attempt         INT NOT NULL,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN
                    ('triage','fix','retry','detalhe','cancel')),
  triggered_by    TEXT NOT NULL,
  hint            TEXT,
  status          TEXT NOT NULL CHECK (status IN
                    ('queued','running','pr_opened','tests_failed','llm_failed',
                     'cancelled','limit_reached','completed')),
  pr_url          TEXT,
  branch_name     TEXT,
  test_summary    JSONB,
  llm_tokens_input   INT,
  llm_tokens_output  INT,
  llm_cost_usd    NUMERIC(10, 4),
  processing_ms   INT,
  error_code      TEXT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trello_attempts_card
  ON trello_fix_attempts (card_id, attempt DESC);

CREATE INDEX IF NOT EXISTS idx_trello_attempts_status
  ON trello_fix_attempts (status, created_at)
  WHERE status IN ('queued', 'running');
```

- [ ] **Step 2: Aplicar local (quando Docker disponível)**

```bash
docker compose exec api node src/db/migrate.js
```

Expected: `Applied 105_trello_fix_attempts.sql`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/db/migrations/105_trello_fix_attempts.sql
git commit -m "feat(trello-qa): migration 105 trello_fix_attempts audit table"
```

### Task 2: Service `trello-fix-attempts.js` + tests

**Files:**
- Create: `apps/api/src/services/trello-fix-attempts.js`
- Test: `apps/api/tests/services/trello-fix-attempts.test.js`

- [ ] **Step 1: Escrever o test (falha)**

```javascript
// apps/api/tests/services/trello-fix-attempts.test.js
'use strict';
const { describe, test, expect } = require('@jest/globals');

const {
  createAttempt, markRunning, markCompleted, markFailed,
  getLastAttempt, countCompletedAttempts,
  VALID_TRIGGER_TYPES, VALID_STATUSES, MAX_ATTEMPTS,
} = require('../../src/services/trello-fix-attempts');

function makePg(rows) {
  return { query: jest.fn().mockResolvedValueOnce({ rows: rows || [], rowCount: rows?.length || 0 }) };
}

describe('VALID enums e MAX_ATTEMPTS', () => {
  test('trigger_types whitelist 5 valores', () => {
    expect([...VALID_TRIGGER_TYPES].sort()).toEqual(
      ['cancel', 'detalhe', 'fix', 'retry', 'triage'],
    );
  });
  test('status whitelist 8 valores', () => {
    expect(VALID_STATUSES.size).toBe(8);
  });
  test('MAX_ATTEMPTS = 5 por card (sem contar triage)', () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });
});

describe('createAttempt', () => {
  test('INSERT triage attempt=0 status queued', async () => {
    const pg = makePg([{ id: 'a1', card_id: 'c1', attempt: 0, status: 'queued' }]);
    const r = await createAttempt(pg, {
      cardId: 'c1', cardShortId: 'short1', attempt: 0,
      triggerType: 'triage', triggeredBy: 'system',
    });
    expect(r.id).toBe('a1');
    expect(pg.query.mock.calls[0][1][2]).toBe(0); // attempt
    expect(pg.query.mock.calls[0][1][3]).toBe('triage');
  });

  test('INSERT fix attempt com hint', async () => {
    const pg = makePg([{ id: 'a2', attempt: 1 }]);
    await createAttempt(pg, {
      cardId: 'c1', cardShortId: 's1', attempt: 1,
      triggerType: 'retry', triggeredBy: '@dev',
      hint: 'use getById',
    });
    expect(pg.query.mock.calls[0][1][5]).toBe('use getById');
  });

  test('rejeita triggerType inválido com status 400', async () => {
    await expect(createAttempt({}, {
      cardId: 'c1', cardShortId: 's1', attempt: 0,
      triggerType: 'invalid', triggeredBy: 'x',
    })).rejects.toMatchObject({ message: 'INVALID_TRIGGER_TYPE', status: 400 });
  });
});

describe('markRunning / markCompleted / markFailed', () => {
  test('markRunning UPDATE status=running', async () => {
    const pg = makePg([]);
    await markRunning(pg, 'a1');
    expect(pg.query.mock.calls[0][0]).toMatch(/SET status = 'running'/);
    expect(pg.query.mock.calls[0][1]).toEqual(['a1']);
  });

  test('markCompleted grava pr_url + branch + tokens + custo', async () => {
    const pg = makePg([]);
    await markCompleted(pg, 'a1', {
      status: 'pr_opened',
      prUrl: 'https://github.com/owner/repo/pull/42',
      branchName: 'trello/abc/fix-1',
      testSummary: { passed: 50, failed: 0, skipped: 1 },
      llmTokensInput: 10000,
      llmTokensOutput: 2500,
      llmCostUsd: 0.105,
      processingMs: 45000,
    });
    const params = pg.query.mock.calls[0][1];
    expect(params[1]).toBe('pr_opened');
    expect(params[2]).toBe('https://github.com/owner/repo/pull/42');
    expect(params[3]).toBe('trello/abc/fix-1');
  });

  test('markFailed grava error_code + truncate message 500 chars', async () => {
    const pg = makePg([]);
    await markFailed(pg, 'a1', {
      status: 'tests_failed',
      errorCode: 'TESTS_FAILED',
      errorMessage: 'x'.repeat(800),
    });
    expect(pg.query.mock.calls[0][1][3].length).toBe(500);
  });
});

describe('getLastAttempt', () => {
  test('retorna mais recente por card_id ORDER BY attempt DESC', async () => {
    const pg = makePg([{ id: 'a3', attempt: 2, status: 'tests_failed' }]);
    const r = await getLastAttempt(pg, { cardId: 'c1' });
    expect(r.attempt).toBe(2);
    expect(pg.query.mock.calls[0][0]).toMatch(/ORDER BY attempt DESC/);
    expect(pg.query.mock.calls[0][0]).toMatch(/LIMIT 1/);
  });

  test('retorna null quando vazio', async () => {
    const pg = makePg([]);
    expect(await getLastAttempt(pg, { cardId: 'nope' })).toBeNull();
  });
});

describe('countCompletedAttempts', () => {
  test('conta só fix/retry (não triage, cancel, detalhe)', async () => {
    const pg = { query: jest.fn().mockResolvedValueOnce({ rows: [{ count: '3' }] }) };
    const n = await countCompletedAttempts(pg, { cardId: 'c1' });
    expect(n).toBe(3);
    expect(pg.query.mock.calls[0][0]).toMatch(/IN \('fix', 'retry'\)/);
  });
});
```

- [ ] **Step 2: Rodar o test (FAIL — module not found)**

```bash
cd apps/api && npx jest tests/services/trello-fix-attempts.test.js
```

Expected: `Cannot find module '../../src/services/trello-fix-attempts'`.

- [ ] **Step 3: Implementar service**

```javascript
// apps/api/src/services/trello-fix-attempts.js
'use strict';

/**
 * trello-fix-attempts service — audit trail Trello QA Agent.
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §5
 */

const VALID_TRIGGER_TYPES = new Set(['triage', 'fix', 'retry', 'detalhe', 'cancel']);
const VALID_STATUSES = new Set([
  'queued', 'running', 'pr_opened', 'tests_failed',
  'llm_failed', 'cancelled', 'limit_reached', 'completed',
]);
const MAX_ATTEMPTS = 5;

function _validateTrigger(t) {
  if (!VALID_TRIGGER_TYPES.has(t)) {
    const err = new Error('INVALID_TRIGGER_TYPE');
    err.status = 400;
    throw err;
  }
}

async function createAttempt(pg, {
  cardId, cardShortId, attempt, triggerType, triggeredBy, hint,
}) {
  _validateTrigger(triggerType);
  const { rows } = await pg.query(
    `INSERT INTO trello_fix_attempts
       (card_id, card_short_id, attempt, trigger_type, triggered_by, hint, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued')
     RETURNING id, card_id, attempt, status, created_at`,
    [cardId, cardShortId, attempt, triggerType, triggeredBy, hint || null]
  );
  return rows[0];
}

async function markRunning(pg, attemptId) {
  await pg.query(
    `UPDATE trello_fix_attempts SET status = 'running' WHERE id = $1`,
    [attemptId]
  );
}

async function markCompleted(pg, attemptId, fields) {
  await pg.query(
    `UPDATE trello_fix_attempts
        SET status = $2,
            pr_url = $3,
            branch_name = $4,
            test_summary = $5::jsonb,
            llm_tokens_input = $6,
            llm_tokens_output = $7,
            llm_cost_usd = $8,
            processing_ms = $9,
            completed_at = NOW()
      WHERE id = $1`,
    [
      attemptId,
      fields.status || 'completed',
      fields.prUrl || null,
      fields.branchName || null,
      fields.testSummary ? JSON.stringify(fields.testSummary) : null,
      fields.llmTokensInput || 0,
      fields.llmTokensOutput || 0,
      fields.llmCostUsd || 0,
      fields.processingMs || 0,
    ]
  );
}

async function markFailed(pg, attemptId, { status, errorCode, errorMessage }) {
  await pg.query(
    `UPDATE trello_fix_attempts
        SET status = $2,
            error_code = $3,
            error_message = $4,
            completed_at = NOW()
      WHERE id = $1`,
    [
      attemptId,
      status || 'llm_failed',
      errorCode || 'UNKNOWN',
      String(errorMessage || '').slice(0, 500),
    ]
  );
}

async function getLastAttempt(pg, { cardId }) {
  const { rows } = await pg.query(
    `SELECT id, card_id, attempt, trigger_type, status, hint,
            pr_url, branch_name, test_summary, error_code, error_message,
            llm_tokens_input, llm_tokens_output, llm_cost_usd,
            created_at, completed_at
       FROM trello_fix_attempts
      WHERE card_id = $1
      ORDER BY attempt DESC
      LIMIT 1`,
    [cardId]
  );
  return rows[0] || null;
}

async function countCompletedAttempts(pg, { cardId }) {
  const { rows } = await pg.query(
    `SELECT COUNT(*)::text AS count
       FROM trello_fix_attempts
      WHERE card_id = $1
        AND trigger_type IN ('fix', 'retry')
        AND status != 'queued'`,
    [cardId]
  );
  return parseInt(rows[0].count, 10);
}

module.exports = {
  createAttempt,
  markRunning,
  markCompleted,
  markFailed,
  getLastAttempt,
  countCompletedAttempts,
  VALID_TRIGGER_TYPES,
  VALID_STATUSES,
  MAX_ATTEMPTS,
};
```

- [ ] **Step 4: Rodar test (PASS) + adicionar ao test:unit**

```bash
cd apps/api && npx jest tests/services/trello-fix-attempts.test.js
```

Expected: `Tests: 11 passed, 11 total`.

`apps/api/package.json` `test:unit` script: append `tests/services/trello-fix-attempts.test.js` ao final da lista de globs.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/trello-fix-attempts.js \
        apps/api/tests/services/trello-fix-attempts.test.js \
        apps/api/package.json
git commit -m "feat(trello-qa): service trello-fix-attempts + 11 tests"
```

---

## Sub-fase T-B: Trello client + webhook receiver

### Task 3: Service `trello-client.js` + tests

**Files:**
- Create: `apps/api/src/services/trello-client.js`
- Test: `apps/api/tests/services/trello-client.test.js`

- [ ] **Step 1: Escrever test**

```javascript
// apps/api/tests/services/trello-client.test.js
'use strict';
const { describe, test, expect, beforeEach } = require('@jest/globals');

const mockFetch = jest.fn();
global.fetch = mockFetch;

const {
  verifyWebhookSignature, getCard, addComment, addLabel, getCardComments,
} = require('../../src/services/trello-client');

beforeEach(() => {
  mockFetch.mockReset();
  process.env.TRELLO_API_KEY = 'fake-key';
  process.env.TRELLO_API_TOKEN = 'fake-token';
  process.env.TRELLO_WEBHOOK_SECRET = 'secret-shared';
});

describe('verifyWebhookSignature', () => {
  test('signature válida retorna true', () => {
    const callbackUrl = 'https://app.genomaflow.com.br/api/webhooks/trello';
    const body = '{"hello":"world"}';
    // HMAC-SHA1 base64 de (body + callbackUrl) com secret
    const crypto = require('crypto');
    const expected = crypto
      .createHmac('sha1', 'secret-shared')
      .update(body + callbackUrl)
      .digest('base64');

    expect(verifyWebhookSignature({
      body, signature: expected, callbackUrl,
    })).toBe(true);
  });

  test('signature inválida retorna false', () => {
    expect(verifyWebhookSignature({
      body: '{}', signature: 'wrong', callbackUrl: 'x',
    })).toBe(false);
  });

  test('signature ausente retorna false', () => {
    expect(verifyWebhookSignature({
      body: '{}', signature: '', callbackUrl: 'x',
    })).toBe(false);
  });
});

describe('getCard', () => {
  test('GET /cards/:id?fields=...', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'c1', name: 'Bug X', desc: 'detalhes...' }),
    });
    const card = await getCard('c1');
    expect(card.name).toBe('Bug X');
    expect(mockFetch.mock.calls[0][0]).toMatch(/cards\/c1\?key=fake-key&token=fake-token/);
  });

  test('throw em status não-OK', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'not found',
    });
    await expect(getCard('nope')).rejects.toThrow(/404/);
  });
});

describe('addComment', () => {
  test('POST /cards/:id/actions/comments com text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'comment-1' }),
    });
    const r = await addComment('c1', 'olá!');
    expect(r.id).toBe('comment-1');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    expect(mockFetch.mock.calls[0][0]).toMatch(/cards\/c1\/actions\/comments/);
  });

  test('truncate comentário > 16384 chars (limite Trello)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'c' }) });
    const longText = 'x'.repeat(20000);
    await addComment('c1', longText);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text.length).toBeLessThanOrEqual(16384);
  });
});

describe('addLabel', () => {
  test('POST /cards/:id/idLabels', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await addLabel('c1', 'label-abc');
    expect(mockFetch.mock.calls[0][0]).toMatch(/cards\/c1\/idLabels/);
  });
});

describe('getCardComments', () => {
  test('GET /cards/:id/actions?filter=commentCard', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { id: 'a1', data: { text: '/fix aprovado' }, memberCreator: { username: 'dev1' } },
      ]),
    });
    const c = await getCardComments('c1');
    expect(c.length).toBe(1);
    expect(c[0].data.text).toBe('/fix aprovado');
  });
});
```

- [ ] **Step 2: Implementar service**

```javascript
// apps/api/src/services/trello-client.js
'use strict';

/**
 * Trello REST client wrapper. Sem lib oficial Node confiável — usa fetch direto.
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §4
 */

const crypto = require('crypto');

const TRELLO_BASE = 'https://api.trello.com/1';
const COMMENT_MAX_LENGTH = 16384; // limite Trello

function _credentials() {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_API_TOKEN;
  if (!key || !token) throw new Error('TRELLO_API_KEY/TOKEN não configurados');
  return { key, token };
}

function _authQuery() {
  const { key, token } = _credentials();
  return `key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
}

/**
 * Valida assinatura HMAC-SHA1 base64 do webhook.
 * Trello assina: SHA1(body + callbackUrl) com TRELLO_WEBHOOK_SECRET.
 */
function verifyWebhookSignature({ body, signature, callbackUrl }) {
  const secret = process.env.TRELLO_WEBHOOK_SECRET;
  if (!secret || !signature || !body || !callbackUrl) return false;
  const expected = crypto
    .createHmac('sha1', secret)
    .update(body + callbackUrl)
    .digest('base64');
  // timing-safe equal evita timing attack
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function _request(path, opts = {}) {
  const url = `${TRELLO_BASE}${path}${path.includes('?') ? '&' : '?'}${_authQuery()}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    method: opts.method || 'GET',
    body: opts.body || undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Trello API ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.json();
}

async function getCard(cardId) {
  return await _request(`/cards/${cardId}?fields=id,idShort,name,desc,idBoard,idList,labels`);
}

async function getCardComments(cardId) {
  return await _request(`/cards/${cardId}/actions?filter=commentCard&limit=50`);
}

async function addComment(cardId, text) {
  const truncated = text.length > COMMENT_MAX_LENGTH
    ? text.slice(0, COMMENT_MAX_LENGTH - 100) + '\n\n... [truncado]'
    : text;
  return await _request(`/cards/${cardId}/actions/comments`, {
    method: 'POST',
    body: JSON.stringify({ text: truncated }),
  });
}

async function addLabel(cardId, labelId) {
  return await _request(`/cards/${cardId}/idLabels`, {
    method: 'POST',
    body: JSON.stringify({ value: labelId }),
  });
}

async function listBoardLabels(boardId) {
  return await _request(`/boards/${boardId}/labels`);
}

module.exports = {
  verifyWebhookSignature,
  getCard,
  getCardComments,
  addComment,
  addLabel,
  listBoardLabels,
  COMMENT_MAX_LENGTH,
};
```

- [ ] **Step 3: Run test (PASS)**

```bash
cd apps/api && npx jest tests/services/trello-client.test.js
```

Expected: `Tests: 10 passed, 10 total`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/trello-client.js apps/api/tests/services/trello-client.test.js
git commit -m "feat(trello-qa): trello-client + 10 tests (HMAC, REST wrap)"
```

### Task 4: Webhook route + queue producer

**Files:**
- Create: `apps/api/src/queues/trello-qa-queue.js`
- Create: `apps/api/src/routes/webhooks/trello.js`
- Test: `apps/api/tests/routes/webhooks/trello.test.js`
- Modify: `apps/api/src/server.js`

- [ ] **Step 1: Implementar queue producer**

```javascript
// apps/api/src/queues/trello-qa-queue.js
'use strict';

const { Queue } = require('bullmq');
const IORedis = require('ioredis');

let _queue;
function getQueue() {
  if (_queue) return _queue;
  const connection = new IORedis(
    process.env.REDIS_URL || 'redis://redis:6379',
    { maxRetriesPerRequest: null },
  );
  _queue = new Queue('trello-qa', { connection });
  return _queue;
}

async function enqueue(data) {
  return getQueue().add('process', data, {
    attempts: 1,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  });
}

module.exports = { enqueue };
```

- [ ] **Step 2: Test webhook route**

```javascript
// apps/api/tests/routes/webhooks/trello.test.js
'use strict';
const { describe, test, expect, beforeEach } = require('@jest/globals');
const Fastify = require('fastify');
const crypto = require('crypto');

const mockEnqueue = jest.fn();
jest.mock('../../../src/queues/trello-qa-queue', () => ({
  enqueue: (...args) => mockEnqueue(...args),
}));

function signBody(body, callbackUrl, secret) {
  return crypto.createHmac('sha1', secret).update(body + callbackUrl).digest('base64');
}

async function buildApp() {
  mockEnqueue.mockReset();
  mockEnqueue.mockResolvedValue({ id: 'job1' });

  process.env.TRELLO_WEBHOOK_SECRET = 'sec';
  process.env.TRELLO_QA_LIST_ID = 'list-qa';
  process.env.TRELLO_API_KEY = 'k';
  process.env.TRELLO_API_TOKEN = 't';
  process.env.WEBHOOK_CALLBACK_URL = 'https://app.example.com/api/webhooks/trello';

  const app = Fastify({ logger: false });
  await app.register(require('../../../src/routes/webhooks/trello'), { prefix: '/api/webhooks' });
  return app;
}

describe('GET /api/webhooks/trello — healthcheck', () => {
  test('200 OK (Trello verifica endpoint na criação do webhook)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/webhooks/trello' });
    expect(res.statusCode).toBe(200);
  });

  test('HEAD também responde', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'HEAD', url: '/api/webhooks/trello' });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/webhooks/trello — signature', () => {
  test('401 sem header X-Trello-Webhook', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: { action: {} },
    });
    expect(res.statusCode).toBe(401);
  });

  test('401 assinatura inválida', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: { action: {} },
      headers: { 'x-trello-webhook': 'wrong-sig' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('200 + enqueue triage quando card movido pra coluna QA', async () => {
    const app = await buildApp();
    const body = {
      action: {
        id: 'action-1',
        type: 'updateCard',
        data: {
          card: { id: 'card-1', idShort: 42, name: 'Bug X' },
          listAfter: { id: 'list-qa' },
          listBefore: { id: 'list-todo' },
        },
        memberCreator: { username: 'qa1' },
      },
    };
    const bodyStr = JSON.stringify(body);
    const sig = signBody(bodyStr, process.env.WEBHOOK_CALLBACK_URL, 'sec');

    const res = await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: bodyStr,
      headers: {
        'content-type': 'application/json',
        'x-trello-webhook': sig,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      event: 'triage',
      card_id: 'card-1',
      card_short_id: '42',
      action_id: 'action-1',
    }));
  });

  test('200 SEM enqueue se card moveu pra coluna diferente de QA', async () => {
    const app = await buildApp();
    const body = {
      action: {
        id: 'a2', type: 'updateCard',
        data: {
          card: { id: 'c2', idShort: 43, name: 'X' },
          listAfter: { id: 'list-DONE' },
          listBefore: { id: 'list-qa' },
        },
        memberCreator: { username: 'x' },
      },
    };
    const bodyStr = JSON.stringify(body);
    const sig = signBody(bodyStr, process.env.WEBHOOK_CALLBACK_URL, 'sec');
    const res = await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: bodyStr,
      headers: { 'content-type': 'application/json', 'x-trello-webhook': sig },
    });
    expect(res.statusCode).toBe(200);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test('200 + enqueue fix quando comentário /fix aprovado', async () => {
    const app = await buildApp();
    const body = {
      action: {
        id: 'a3', type: 'commentCard',
        data: {
          card: { id: 'c3', idShort: 50, name: 'Y' },
          text: '/fix aprovado',
        },
        memberCreator: { username: 'po1' },
      },
    };
    const bodyStr = JSON.stringify(body);
    const sig = signBody(bodyStr, process.env.WEBHOOK_CALLBACK_URL, 'sec');
    const res = await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: bodyStr,
      headers: { 'content-type': 'application/json', 'x-trello-webhook': sig },
    });
    expect(res.statusCode).toBe(200);
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      event: 'fix',
      slash_command: 'aprovado',
      member_username: 'po1',
    }));
  });

  test('parse /fix retry: hint extrai hint', async () => {
    const app = await buildApp();
    const body = {
      action: {
        id: 'a4', type: 'commentCard',
        data: {
          card: { id: 'c4', idShort: 51, name: 'Z' },
          text: '/fix retry: usar getById em vez de getByName',
        },
        memberCreator: { username: 'dev' },
      },
    };
    const bodyStr = JSON.stringify(body);
    const sig = signBody(bodyStr, process.env.WEBHOOK_CALLBACK_URL, 'sec');
    await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: bodyStr,
      headers: { 'content-type': 'application/json', 'x-trello-webhook': sig },
    });
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      event: 'fix',
      slash_command: 'retry',
      hint: 'usar getById em vez de getByName',
    }));
  });

  test('comentário SEM /fix → não enqueue', async () => {
    const app = await buildApp();
    const body = {
      action: {
        id: 'a5', type: 'commentCard',
        data: { card: { id: 'c5', idShort: 52, name: 'W' }, text: 'comentário normal' },
        memberCreator: { username: 'x' },
      },
    };
    const bodyStr = JSON.stringify(body);
    const sig = signBody(bodyStr, process.env.WEBHOOK_CALLBACK_URL, 'sec');
    await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: bodyStr,
      headers: { 'content-type': 'application/json', 'x-trello-webhook': sig },
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Implementar webhook route**

```javascript
// apps/api/src/routes/webhooks/trello.js
'use strict';

/**
 * Webhook receiver Trello + dispatch BullMQ.
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §3
 */

const { verifyWebhookSignature } = require('../../services/trello-client');
const { enqueue } = require('../../queues/trello-qa-queue');

// Slash commands suportados — parse no comentário
const SLASH_COMMAND_RE = /^\/fix\s+(aprovado|retry|detalhe|cancel)(?::\s*(.+))?$/i;

module.exports = async function (fastify) {
  // Trello verifica o endpoint via HEAD/GET na criação. Retorna 200 vazio.
  fastify.get('/trello', async () => ({ ok: true }));
  fastify.head('/trello', async (request, reply) => reply.code(200).send());

  fastify.post('/trello', {
    config: { rateLimit: { max: 600, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const signature = request.headers['x-trello-webhook'];
    if (!signature || typeof signature !== 'string') {
      return reply.status(401).send({ error: 'MISSING_SIGNATURE' });
    }

    const rawBody = typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body);
    const callbackUrl = process.env.WEBHOOK_CALLBACK_URL;

    if (!verifyWebhookSignature({ body: rawBody, signature, callbackUrl })) {
      return reply.status(401).send({ error: 'INVALID_SIGNATURE' });
    }

    const action = request.body?.action;
    if (!action || !action.data?.card) {
      return reply.status(200).send({ ok: true, ignored: true });
    }

    const card = action.data.card;
    const member = action.memberCreator?.username || 'unknown';
    const actionId = action.id;
    const QA_LIST_ID = process.env.TRELLO_QA_LIST_ID;

    // Event 1: card movido pra coluna QA → triage
    if (action.type === 'updateCard'
        && action.data.listAfter
        && action.data.listAfter.id === QA_LIST_ID) {
      await enqueue({
        event: 'triage',
        card_id: card.id,
        card_short_id: String(card.idShort),
        action_id: actionId,
        triggered_by: member,
      });
      return reply.send({ ok: true, queued: 'triage' });
    }

    // Event 2: comment /fix em qualquer card
    if (action.type === 'commentCard' && action.data.text) {
      const text = String(action.data.text).trim();
      const m = SLASH_COMMAND_RE.exec(text);
      if (!m) return reply.send({ ok: true, ignored: 'not_slash_command' });

      const subcommand = m[1].toLowerCase();
      const hint = (m[2] || '').trim() || undefined;
      await enqueue({
        event: 'fix',
        card_id: card.id,
        card_short_id: String(card.idShort),
        action_id: actionId,
        slash_command: subcommand,
        hint,
        member_username: member,
        triggered_by: member,
      });
      return reply.send({ ok: true, queued: 'fix', subcommand });
    }

    return reply.send({ ok: true, ignored: 'unhandled_action_type' });
  });
};
```

- [ ] **Step 4: Registrar no server.js**

Em `apps/api/src/server.js`, dentro do bloco `fastify.register(async function (fastify) { ... }, { prefix: API_PREFIX })`:

```javascript
fastify.register(require('./routes/webhooks/trello'), { prefix: '/webhooks' });
```

- [ ] **Step 5: Run tests (PASS) + adicionar ao test:unit**

```bash
cd apps/api && npx jest tests/routes/webhooks/trello.test.js
```

Expected: `Tests: 9 passed, 9 total`.

Append `tests/routes/webhooks/trello.test.js` ao `test:unit` em `apps/api/package.json`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/queues/trello-qa-queue.js \
        apps/api/src/routes/webhooks/trello.js \
        apps/api/tests/routes/webhooks/trello.test.js \
        apps/api/src/server.js \
        apps/api/package.json
git commit -m "feat(trello-qa): webhook receiver + queue producer + 9 tests"
```

---

## Sub-fase T-C: Codebase tools (worker)

### Task 5: `codebase-tools.js` (read-only set primeiro)

**Files:**
- Create: `apps/worker/src/lib/codebase-tools.js`
- Test: `apps/worker/tests/lib/codebase-tools.test.js`

- [ ] **Step 1: Escrever test**

```javascript
// apps/worker/tests/lib/codebase-tools.test.js
'use strict';
const { describe, test, expect } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  readFile, listFiles, grep, editFile, createFile,
  isEditableAllowed, getToolSchemas,
} = require('../../src/lib/codebase-tools');

let tempRoot;
beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebase-tools-'));
  // Estrutura mínima de teste
  fs.mkdirSync(path.join(tempRoot, 'apps/api/src'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'apps/worker/src'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'infra'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'apps/api/src/foo.js'), 'function foo() {\n  return 42;\n}');
  fs.writeFileSync(path.join(tempRoot, 'apps/api/src/bar.js'), 'const x = "hello";');
  fs.writeFileSync(path.join(tempRoot, 'infra/danger.tf'), 'critical');
});
afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('isEditableAllowed', () => {
  test('allow apps/api/src', () => {
    expect(isEditableAllowed('apps/api/src/foo.js')).toBe(true);
  });
  test('allow apps/worker/src', () => {
    expect(isEditableAllowed('apps/worker/src/bar.js')).toBe(true);
  });
  test('allow apps/web/src', () => {
    expect(isEditableAllowed('apps/web/src/x.ts')).toBe(true);
  });
  test('allow docs/', () => {
    expect(isEditableAllowed('docs/anything.md')).toBe(true);
  });
  test('deny infra/', () => {
    expect(isEditableAllowed('infra/lib/ecs-stack.ts')).toBe(false);
  });
  test('deny .github/', () => {
    expect(isEditableAllowed('.github/workflows/deploy.yml')).toBe(false);
  });
  test('deny migrations sql', () => {
    expect(isEditableAllowed('apps/api/src/db/migrations/099_foo.sql')).toBe(false);
  });
  test('deny package.json root', () => {
    expect(isEditableAllowed('package.json')).toBe(false);
  });
  test('deny path traversal ../', () => {
    expect(isEditableAllowed('../etc/passwd')).toBe(false);
  });
});

describe('readFile', () => {
  test('lê conteúdo de arquivo dentro do repo', async () => {
    const c = await readFile({ path: 'apps/api/src/foo.js', repoRoot: tempRoot });
    expect(c).toContain('function foo');
  });

  test('rejeita path fora do repo (traversal)', async () => {
    await expect(readFile({ path: '../../../etc/passwd', repoRoot: tempRoot }))
      .rejects.toThrow(/PATH_TRAVERSAL/);
  });

  test('rejeita arquivo > 50KB', async () => {
    const big = path.join(tempRoot, 'apps/api/src/big.js');
    fs.writeFileSync(big, 'x'.repeat(60 * 1024));
    await expect(readFile({ path: 'apps/api/src/big.js', repoRoot: tempRoot }))
      .rejects.toThrow(/FILE_TOO_LARGE/);
  });
});

describe('listFiles', () => {
  test('lista files em diretório', async () => {
    const files = await listFiles({ dir: 'apps/api/src', repoRoot: tempRoot });
    expect(files).toEqual(expect.arrayContaining(['apps/api/src/foo.js', 'apps/api/src/bar.js']));
  });
});

describe('grep', () => {
  test('encontra ocorrências com line numbers', async () => {
    const r = await grep({ pattern: 'function foo', repoRoot: tempRoot });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]).toMatchObject({
      path: 'apps/api/src/foo.js',
      line: 1,
    });
  });

  test('retorna [] quando não encontra', async () => {
    const r = await grep({ pattern: 'wholeworld_unique_token_xyz', repoRoot: tempRoot });
    expect(r).toEqual([]);
  });
});

describe('editFile', () => {
  test('substitui old_string por new_string', async () => {
    await editFile({
      path: 'apps/api/src/foo.js',
      oldString: 'return 42',
      newString: 'return 43',
      repoRoot: tempRoot,
    });
    const c = await readFile({ path: 'apps/api/src/foo.js', repoRoot: tempRoot });
    expect(c).toContain('return 43');
  });

  test('rejeita edit em path NÃO permitido', async () => {
    await expect(editFile({
      path: 'infra/danger.tf',
      oldString: 'critical',
      newString: 'safe',
      repoRoot: tempRoot,
    })).rejects.toThrow(/NOT_EDITABLE/);
  });

  test('rejeita se old_string não encontrada', async () => {
    await expect(editFile({
      path: 'apps/api/src/bar.js',
      oldString: 'string-inexistente',
      newString: 'x',
      repoRoot: tempRoot,
    })).rejects.toThrow(/OLD_STRING_NOT_FOUND/);
  });

  test('rejeita se old_string ambígua (múltiplas ocorrências)', async () => {
    const f = path.join(tempRoot, 'apps/api/src/ambiguous.js');
    fs.writeFileSync(f, 'foo();\nfoo();\nfoo();');
    await expect(editFile({
      path: 'apps/api/src/ambiguous.js',
      oldString: 'foo();',
      newString: 'bar();',
      repoRoot: tempRoot,
    })).rejects.toThrow(/AMBIGUOUS_MATCH/);
  });
});

describe('createFile', () => {
  test('cria arquivo novo em path permitido', async () => {
    await createFile({
      path: 'apps/api/src/new-file.js',
      content: 'module.exports = {};',
      repoRoot: tempRoot,
    });
    expect(fs.existsSync(path.join(tempRoot, 'apps/api/src/new-file.js'))).toBe(true);
  });

  test('rejeita criar fora de allowlist', async () => {
    await expect(createFile({
      path: 'infra/new-bad.tf',
      content: 'x',
      repoRoot: tempRoot,
    })).rejects.toThrow(/NOT_EDITABLE/);
  });

  test('rejeita se arquivo já existe (anti-overwrite)', async () => {
    await expect(createFile({
      path: 'apps/api/src/foo.js',
      content: 'novo conteúdo',
      repoRoot: tempRoot,
    })).rejects.toThrow(/FILE_EXISTS/);
  });
});

describe('getToolSchemas', () => {
  test('retorna lista de schemas Claude Tool Use', () => {
    const schemas = getToolSchemas({ readOnly: false });
    const names = schemas.map(s => s.name);
    expect(names).toEqual(expect.arrayContaining([
      'read_file', 'list_files', 'grep', 'edit_file', 'create_file', 'run_tests', 'run_lint',
    ]));
  });

  test('readOnly=true exclui edit/create/run', () => {
    const schemas = getToolSchemas({ readOnly: true });
    const names = schemas.map(s => s.name);
    expect(names).toEqual(expect.arrayContaining(['read_file', 'list_files', 'grep']));
    expect(names).not.toContain('edit_file');
    expect(names).not.toContain('run_tests');
  });
});
```

- [ ] **Step 2: Implementar codebase-tools**

```javascript
// apps/worker/src/lib/codebase-tools.js
'use strict';

/**
 * Codebase tools — read/list/grep + edit/create + run_tests + run_lint.
 * Allowlist explícita de paths editáveis pra proteger infra crítica.
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §7
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MAX_FILE_SIZE = 50 * 1024;          // 50KB
const GREP_MAX_RESULTS = 200;

const EDITABLE_PREFIXES = [
  'apps/api/src/',
  'apps/worker/src/',
  'apps/web/src/',
  'docs/',
  'apps/api/tests/',
  'apps/worker/tests/',
  'apps/web/src/',  // testes Angular vão junto com src
];

const BLOCKED_PATTERNS = [
  /^infra\//,
  /^\.github\//,
  /^aws\//,
  /^node_modules\//,
  /\/migrations\/.*\.sql$/,
  /^package\.json$/,                 // root package.json
  /^package-lock\.json$/,
  /^Dockerfile$/,
];

function isEditableAllowed(relPath) {
  if (!relPath || typeof relPath !== 'string') return false;
  // Bloqueia traversal
  if (relPath.includes('..')) return false;
  // Normaliza separadores pra forward slash
  const p = relPath.replace(/\\/g, '/');
  // Bloqueia padrões críticos
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(p)) return false;
  }
  // Whitelist prefix-based
  return EDITABLE_PREFIXES.some(prefix => p.startsWith(prefix));
}

function _resolveSafe(repoRoot, relPath) {
  if (relPath.includes('..')) {
    const err = new Error('PATH_TRAVERSAL');
    err.code = 'PATH_TRAVERSAL';
    throw err;
  }
  return path.resolve(repoRoot, relPath);
}

async function readFile({ path: relPath, repoRoot }) {
  const abs = _resolveSafe(repoRoot, relPath);
  const stat = await fs.stat(abs);
  if (stat.size > MAX_FILE_SIZE) {
    const err = new Error(`FILE_TOO_LARGE: ${stat.size} bytes (max ${MAX_FILE_SIZE})`);
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }
  return await fs.readFile(abs, 'utf8');
}

async function listFiles({ dir, repoRoot }) {
  const abs = _resolveSafe(repoRoot, dir);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  return entries
    .filter(e => e.isFile())
    .map(e => path.join(dir, e.name).replace(/\\/g, '/'));
}

async function grep({ pattern, dir = '.', repoRoot }) {
  const startDir = _resolveSafe(repoRoot, dir);
  const re = new RegExp(pattern);
  const results = [];

  async function walk(d) {
    if (results.length >= GREP_MAX_RESULTS) return;
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const ent of entries) {
      if (results.length >= GREP_MAX_RESULTS) return;
      const abs = path.join(d, ent.name);
      // Skip node_modules, dist, etc
      if (ent.isDirectory()) {
        if (['node_modules', 'dist', '.git', 'cdk.out'].includes(ent.name)) continue;
        await walk(abs);
      } else if (ent.isFile()) {
        try {
          const stat = await fs.stat(abs);
          if (stat.size > MAX_FILE_SIZE * 4) continue; // skip arquivos enormes em grep
          const content = await fs.readFile(abs, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
              results.push({ path: rel, line: i + 1, text: lines[i].slice(0, 200) });
              if (results.length >= GREP_MAX_RESULTS) return;
            }
          }
        } catch { /* skip binários, perm */ }
      }
    }
  }
  await walk(startDir);
  return results;
}

async function editFile({ path: relPath, oldString, newString, repoRoot }) {
  if (!isEditableAllowed(relPath)) {
    const err = new Error(`NOT_EDITABLE: ${relPath}`);
    err.code = 'NOT_EDITABLE';
    throw err;
  }
  const abs = _resolveSafe(repoRoot, relPath);
  const content = await fs.readFile(abs, 'utf8');
  const idx = content.indexOf(oldString);
  if (idx === -1) {
    const err = new Error('OLD_STRING_NOT_FOUND');
    err.code = 'OLD_STRING_NOT_FOUND';
    throw err;
  }
  // Anti-ambiguity: rejeita se old_string aparece >1 vez
  if (content.indexOf(oldString, idx + 1) !== -1) {
    const err = new Error('AMBIGUOUS_MATCH: old_string aparece >1 vez');
    err.code = 'AMBIGUOUS_MATCH';
    throw err;
  }
  const next = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
  await fs.writeFile(abs, next, 'utf8');
  return { ok: true, path: relPath };
}

async function createFile({ path: relPath, content, repoRoot }) {
  if (!isEditableAllowed(relPath)) {
    const err = new Error(`NOT_EDITABLE: ${relPath}`);
    err.code = 'NOT_EDITABLE';
    throw err;
  }
  const abs = _resolveSafe(repoRoot, relPath);
  if (fsSync.existsSync(abs)) {
    const err = new Error(`FILE_EXISTS: ${relPath}`);
    err.code = 'FILE_EXISTS';
    throw err;
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  return { ok: true, path: relPath };
}

async function runTests({ scope, repoRoot }) {
  return await _spawnCmd('npm', ['test'], path.join(repoRoot, `apps/${scope}`));
}

async function runLint({ scope, repoRoot }) {
  return await _spawnCmd('npm', ['run', 'lint', '--if-present'], path.join(repoRoot, `apps/${scope}`));
}

function _spawnCmd(cmd, args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, shell: process.platform === 'win32' });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code,
        stdout: stdout.slice(-10000), // cap output
        stderr: stderr.slice(-10000),
      });
    });
  });
}

function getToolSchemas({ readOnly = false } = {}) {
  const base = [
    {
      name: 'read_file',
      description: 'Lê o conteúdo de um arquivo do codebase (max 50KB).',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path relativo ao repo root' } },
        required: ['path'],
      },
    },
    {
      name: 'list_files',
      description: 'Lista arquivos de um diretório (não recursivo).',
      input_schema: {
        type: 'object',
        properties: { dir: { type: 'string', description: 'Path relativo ao repo root' } },
        required: ['dir'],
      },
    },
    {
      name: 'grep',
      description: 'Busca pattern regex no codebase. Retorna até 200 ocorrências com path+line.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern JS' },
          dir: { type: 'string', description: 'Limita busca a um diretório' },
        },
        required: ['pattern'],
      },
    },
  ];

  if (readOnly) return base;

  return [...base,
    {
      name: 'edit_file',
      description: 'Substitui old_string por new_string em um arquivo. old_string deve aparecer exatamente UMA vez.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    {
      name: 'create_file',
      description: 'Cria arquivo novo. Falha se arquivo já existe.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'run_tests',
      description: 'Roda npm test no scope (api | worker | web). Retorna { success, exitCode, stdout, stderr }.',
      input_schema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['api', 'worker', 'web'] },
        },
        required: ['scope'],
      },
    },
    {
      name: 'run_lint',
      description: 'Roda npm run lint --if-present. Retorna { success, exitCode, stdout, stderr }.',
      input_schema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['api', 'worker', 'web'] },
        },
        required: ['scope'],
      },
    },
  ];
}

module.exports = {
  readFile, listFiles, grep, editFile, createFile,
  runTests, runLint,
  isEditableAllowed, getToolSchemas,
  EDITABLE_PREFIXES, BLOCKED_PATTERNS, MAX_FILE_SIZE,
};
```

- [ ] **Step 3: Rodar tests (PASS)**

```bash
cd apps/worker && npx jest tests/lib/codebase-tools.test.js
```

Expected: `Tests: 19 passed, 19 total`.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/lib/codebase-tools.js apps/worker/tests/lib/codebase-tools.test.js
git commit -m "feat(trello-qa): codebase-tools (read/list/grep/edit/create) + 19 tests"
```

### Task 6: `github-pr.js` (Octokit wrapper)

**Files:**
- Create: `apps/worker/src/lib/github-pr.js`
- Test: `apps/worker/tests/lib/github-pr.test.js`
- Modify: `apps/worker/package.json` (add `@octokit/rest`)

- [ ] **Step 1: Install dependency**

```bash
cd apps/worker && npm install @octokit/rest --save --no-audit --no-fund
```

- [ ] **Step 2: Test github-pr**

```javascript
// apps/worker/tests/lib/github-pr.test.js
'use strict';
const { describe, test, expect, beforeEach } = require('@jest/globals');

const mockOctokit = {
  rest: {
    repos: {
      get: jest.fn(),
      getBranch: jest.fn(),
    },
    git: {
      getRef: jest.fn(),
      createRef: jest.fn(),
    },
    pulls: { create: jest.fn() },
  },
};

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn(() => mockOctokit),
}));

const { createBranchAndPR, _resetClient } = require('../../src/lib/github-pr');

beforeEach(() => {
  mockOctokit.rest.git.getRef.mockReset();
  mockOctokit.rest.git.createRef.mockReset();
  mockOctokit.rest.pulls.create.mockReset();
  process.env.GITHUB_BOT_TOKEN = 'gh-pat-xxx';
  process.env.GITHUB_REPO = 'owner/repo';
  _resetClient();
});

describe('createBranchAndPR', () => {
  test('happy path: cria branch, abre PR, retorna url', async () => {
    mockOctokit.rest.git.getRef.mockResolvedValueOnce({
      data: { object: { sha: 'main-sha-1' } },
    });
    mockOctokit.rest.git.createRef.mockResolvedValueOnce({});
    mockOctokit.rest.pulls.create.mockResolvedValueOnce({
      data: { html_url: 'https://github.com/owner/repo/pull/42', number: 42 },
    });

    const r = await createBranchAndPR({
      branchName: 'trello/abc/fix-1',
      baseBranch: 'main',
      title: '[Trello #abc] Bug X',
      body: 'fix descrição',
      // Note: o commit/push real será feito via git CLI separadamente
      // (Octokit Contents API tem limitação de tamanho).
    });

    expect(r.url).toBe('https://github.com/owner/repo/pull/42');
    expect(r.number).toBe(42);

    expect(mockOctokit.rest.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'refs/heads/trello/abc/fix-1',
        sha: 'main-sha-1',
      })
    );
    expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '[Trello #abc] Bug X',
        head: 'trello/abc/fix-1',
        base: 'main',
      })
    );
  });

  test('throw quando GITHUB_BOT_TOKEN ausente', async () => {
    delete process.env.GITHUB_BOT_TOKEN;
    _resetClient();
    await expect(createBranchAndPR({
      branchName: 'x', title: 'y', body: 'z',
    })).rejects.toThrow(/GITHUB_BOT_TOKEN/);
  });
});
```

- [ ] **Step 3: Implementar github-pr.js**

```javascript
// apps/worker/src/lib/github-pr.js
'use strict';

/**
 * GitHub PR helper via Octokit. Assume que commits foram feitos
 * localmente via git CLI; este módulo só cria a branch ref + abre o PR.
 *
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §7
 */

let _client = null;
function _resetClient() { _client = null; }

function getClient() {
  if (_client) return _client;
  const token = process.env.GITHUB_BOT_TOKEN;
  if (!token) throw new Error('GITHUB_BOT_TOKEN ausente');
  const { Octokit } = require('@octokit/rest');
  _client = new Octokit({ auth: token });
  return _client;
}

function _parseRepo() {
  const repo = process.env.GITHUB_REPO || 'rodrigonoma/genomaflow';
  const [owner, name] = repo.split('/');
  return { owner, repo: name };
}

/**
 * Cria branch a partir do baseBranch e abre PR.
 * NÃO comita arquivos — assume que worker já fez commit+push via git CLI antes.
 *
 * Fluxo simplificado: alternativa em projetos onde Octokit Contents API
 * é insuficiente (limit ~1MB por commit). Worker faz tudo via git nativo.
 *
 * @returns { url, number }
 */
async function createBranchAndPR({ branchName, baseBranch = 'main', title, body }) {
  const client = getClient();
  const { owner, repo } = _parseRepo();

  // 1. Pega SHA do baseBranch
  const baseRef = await client.rest.git.getRef({
    owner, repo, ref: `heads/${baseBranch}`,
  });
  const baseSha = baseRef.data.object.sha;

  // 2. Cria branch ref (idempotente — pode falhar se já existe; caller deve fazer commit+push primeiro neste fluxo)
  try {
    await client.rest.git.createRef({
      owner, repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });
  } catch (e) {
    // Se branch já existe (caller fez push via git CLI), tudo bem
    if (!String(e.message).includes('Reference already exists')) {
      throw e;
    }
  }

  // 3. Abre PR
  const pr = await client.rest.pulls.create({
    owner, repo, title, body,
    head: branchName,
    base: baseBranch,
  });

  return { url: pr.data.html_url, number: pr.data.number };
}

/**
 * Faz commit+push via git CLI nativo no diretório do repo.
 * Mais robusto que Octokit Contents API pra mudanças multi-arquivo.
 */
async function commitAndPushBranch({ repoRoot, branchName, message, gitUser = 'GenomaFlow Bot', gitEmail = 'bot@genomaflow.com.br' }) {
  const { spawn } = require('child_process');
  function run(args) {
    return new Promise((resolve, reject) => {
      const p = spawn('git', args, { cwd: repoRoot });
      let stderr = '';
      p.stderr.on('data', (d) => { stderr += d.toString(); });
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`git ${args.join(' ')} exit ${code}: ${stderr}`));
      });
    });
  }
  await run(['config', 'user.name', gitUser]);
  await run(['config', 'user.email', gitEmail]);
  await run(['checkout', '-b', branchName]);
  await run(['add', '-A']);
  await run(['commit', '-m', message]);
  // Push usa GITHUB_BOT_TOKEN no remote url
  const token = process.env.GITHUB_BOT_TOKEN;
  const { owner, repo } = _parseRepo();
  await run(['push', `https://x-access-token:${token}@github.com/${owner}/${repo}.git`, branchName]);
}

module.exports = {
  createBranchAndPR,
  commitAndPushBranch,
  _resetClient,
};
```

- [ ] **Step 4: Rodar test (PASS)**

```bash
cd apps/worker && npx jest tests/lib/github-pr.test.js
```

Expected: `Tests: 2 passed, 2 total`.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/lib/github-pr.js apps/worker/tests/lib/github-pr.test.js \
        apps/worker/package.json apps/worker/package-lock.json
git commit -m "feat(trello-qa): github-pr Octokit wrapper + 2 tests"
```

---

## Sub-fase T-D: Agente triagem

### Task 7: `trello-triage.js` (Claude loop read-only)

**Files:**
- Create: `apps/worker/src/agents/trello-triage.js`
- Test: `apps/worker/tests/agents/trello-triage.test.js`

- [ ] **Step 1: Test trello-triage**

```javascript
// apps/worker/tests/agents/trello-triage.test.js
'use strict';
const { describe, test, expect } = require('@jest/globals');

const mockMessages = { create: jest.fn() };
jest.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = mockMessages; },
}));

jest.mock('../../src/lib/codebase-tools', () => ({
  readFile: jest.fn(async () => 'file content'),
  listFiles: jest.fn(async () => ['x.js']),
  grep: jest.fn(async () => []),
  getToolSchemas: jest.fn(() => [
    { name: 'read_file', description: 'read', input_schema: {} },
    { name: 'list_files', description: 'list', input_schema: {} },
    { name: 'grep', description: 'grep', input_schema: {} },
  ]),
}));

const { triageCard, buildAnalysisComment } = require('../../src/agents/trello-triage');

beforeEach(() => mockMessages.create.mockReset());

describe('triageCard', () => {
  test('happy path: 1-shot Claude com end_turn retorna análise', async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        type: 'bug',
        makes_sense: 'yes',
        opinion: 'Faz sentido — alinhado com regra X',
        technical_details: ['Editar foo.js linha 42'],
        impact: ['Componente bar'],
        test_plan: ['Test unit cobrindo caso A'],
        risk: 'low',
      })}],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 500 },
    });

    const r = await triageCard({
      card: { id: 'c1', idShort: 42, name: 'Bug X', desc: 'algum desc' },
      repoRoot: '/tmp/repo',
    });

    expect(r.analysis.type).toBe('bug');
    expect(r.analysis.makes_sense).toBe('yes');
    expect(r.tokens_input).toBe(1000);
    expect(r.tokens_output).toBe(500);
  });

  test('Claude usa tools antes do end_turn (multi-turn loop)', async () => {
    // Turn 1: tool_use
    mockMessages.create.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'Vou ler o arquivo primeiro.' },
        { type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'apps/api/src/foo.js' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 500, output_tokens: 200 },
    });
    // Turn 2: análise final
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        type: 'bug', makes_sense: 'yes', opinion: 'OK',
        technical_details: [], impact: [], test_plan: [], risk: 'low',
      })}],
      stop_reason: 'end_turn',
      usage: { input_tokens: 800, output_tokens: 300 },
    });

    const r = await triageCard({
      card: { id: 'c1', idShort: 42, name: 'Bug X', desc: 'x' },
      repoRoot: '/tmp/repo',
    });

    expect(r.tokens_input).toBe(1300);  // 500 + 800
    expect(r.tokens_output).toBe(500);  // 200 + 300
    expect(mockMessages.create).toHaveBeenCalledTimes(2);
  });

  test('loop infinito breaker: max 20 iterações', async () => {
    // Sempre tool_use, nunca end_turn
    mockMessages.create.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu', name: 'read_file', input: { path: 'x' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await expect(triageCard({
      card: { id: 'c1', idShort: 1, name: 'X', desc: 'y' },
      repoRoot: '/tmp/repo',
    })).rejects.toThrow(/MAX_ITERATIONS/);

    expect(mockMessages.create).toHaveBeenCalledTimes(20);
  });

  test('JSON malformado no texto → BAD_LLM_OUTPUT', async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'não é json válido' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await expect(triageCard({
      card: { id: 'c1', idShort: 1, name: 'X', desc: 'y' },
      repoRoot: '/tmp/repo',
    })).rejects.toMatchObject({ code: 'BAD_LLM_OUTPUT' });
  });
});

describe('buildAnalysisComment', () => {
  test('renderiza markdown com seções esperadas', () => {
    const md = buildAnalysisComment({
      type: 'bug',
      makes_sense: 'yes',
      opinion: 'OK',
      technical_details: ['Detalhe 1', 'Detalhe 2'],
      impact: ['Comp X'],
      test_plan: ['Test A'],
      risk: 'medium',
    });
    expect(md).toContain('🤖 Análise Automática');
    expect(md).toContain('Tipo:** Bug');
    expect(md).toContain('Detalhe 1');
    expect(md).toContain('Comp X');
    expect(md).toContain('Test A');
    expect(md).toContain('Próximos passos');
    expect(md).toContain('/fix aprovado');
    expect(md).toContain('Médio');
  });

  test('renderiza ⚠️ quando makes_sense=partial', () => {
    const md = buildAnalysisComment({
      type: 'feature',
      makes_sense: 'partial',
      opinion: 'preciso clarificar X',
      technical_details: [],
      impact: [],
      test_plan: [],
      risk: 'low',
    });
    expect(md).toContain('⚠️');
    expect(md).toContain('preciso clarificar X');
  });

  test('renderiza ❌ quando makes_sense=no', () => {
    const md = buildAnalysisComment({
      type: 'bug',
      makes_sense: 'no',
      opinion: 'conflita com Y',
      technical_details: [],
      impact: [],
      test_plan: [],
      risk: 'high',
    });
    expect(md).toContain('❌');
  });
});
```

- [ ] **Step 2: Implementar trello-triage**

```javascript
// apps/worker/src/agents/trello-triage.js
'use strict';

/**
 * Triage agent — Claude Tool Use loop read-only. Produz análise JSON
 * estruturada que vira comentário markdown no card.
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §3.1, §8
 */

const Anthropic = require('@anthropic-ai/sdk').default;
const tools = require('../lib/codebase-tools');

const MODEL = process.env.TRELLO_TRIAGE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 20;

const SYSTEM_PROMPT = `Você é o agente de triagem do GenomaFlow para a coluna QA do Trello.

Sua tarefa: ler o card (nome + descrição), explorar o codebase quando necessário, e produzir uma análise estruturada em JSON.

Tipos válidos: "bug" | "feature" | "copy" | "ux" | "documentation" | "configuration" | "infra" | "other"
makes_sense: "yes" | "partial" | "no"
risk: "low" | "medium" | "high"

Princípios:
- Seja crítico: se a tarefa não faz sentido, diga (makes_sense="no" com explicação clara)
- Identifique impacto cross-feature concretamente (cite componentes/funções)
- Plano de testes deve cobrir caso principal + edge cases
- Detalhes técnicos concretos: cite arquivo:linha quando possível
- NUNCA invente: se não tem informação, pesquise no codebase com tools

Ao terminar, retorne APENAS um JSON válido com este shape:
{
  "type": "bug|feature|...",
  "makes_sense": "yes|partial|no",
  "opinion": "1-3 frases explicando sua avaliação",
  "technical_details": ["Item 1", "Item 2", ...],
  "impact": ["Componente X afetado", ...],
  "test_plan": ["Teste 1", ...],
  "risk": "low|medium|high"
}

Sem texto fora do JSON.`;

async function triageCard({ card, repoRoot, anthropicClient }) {
  const client = anthropicClient || new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 120_000,
  });

  let totalIn = 0, totalOut = 0;
  const messages = [
    { role: 'user', content: `Analise este card Trello da coluna QA:

# ${card.name} (#${card.idShort})

${card.desc || '(sem descrição)'}` },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: tools.getToolSchemas({ readOnly: true }),
      messages,
    });

    totalIn += resp.usage?.input_tokens || 0;
    totalOut += resp.usage?.output_tokens || 0;

    if (resp.stop_reason === 'tool_use') {
      // Executa todos os tool_use do response
      const toolResults = [];
      for (const block of resp.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try {
          result = await _executeTool(block.name, block.input, repoRoot);
        } catch (e) {
          result = { error: e.message || String(e) };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result).slice(0, 5000),
        });
      }
      messages.push({ role: 'assistant', content: resp.content });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // end_turn: extrai JSON
    const textBlock = resp.content.find(b => b.type === 'text');
    const text = textBlock?.text || '';
    let parsed;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch {
      throw Object.assign(new Error('BAD_LLM_OUTPUT'), {
        code: 'BAD_LLM_OUTPUT',
        raw: text.slice(0, 500),
      });
    }
    return {
      analysis: parsed,
      tokens_input: totalIn,
      tokens_output: totalOut,
      iterations: i + 1,
    };
  }

  throw Object.assign(new Error('MAX_ITERATIONS atingido'), {
    code: 'MAX_ITERATIONS',
    tokens_input: totalIn,
    tokens_output: totalOut,
  });
}

async function _executeTool(name, input, repoRoot) {
  switch (name) {
    case 'read_file': return await tools.readFile({ ...input, repoRoot });
    case 'list_files': return await tools.listFiles({ ...input, repoRoot });
    case 'grep': return await tools.grep({ ...input, repoRoot });
    case 'edit_file': return await tools.editFile({ ...input, repoRoot });
    case 'create_file': return await tools.createFile({ ...input, repoRoot });
    case 'run_tests': return await tools.runTests({ ...input, repoRoot });
    case 'run_lint': return await tools.runLint({ ...input, repoRoot });
    default: throw new Error(`Tool desconhecida: ${name}`);
  }
}

function buildAnalysisComment(a) {
  const typeMap = {
    bug: 'Bug', feature: 'Feature', copy: 'Copy/Texto', ux: 'UX',
    documentation: 'Documentação', configuration: 'Configuração',
    infra: 'Infra', other: 'Outro',
  };
  const senseMap = {
    yes: '✅ Sim',
    partial: '⚠️ Parcialmente',
    no: '❌ Não recomendado',
  };
  const riskMap = { low: 'Baixo', medium: 'Médio', high: 'Alto' };

  return `## 🤖 Análise Automática (GenomaFlow Agent)

**Tipo:** ${typeMap[a.type] || a.type}
**Faz sentido?** ${senseMap[a.makes_sense] || a.makes_sense} — ${a.opinion}

### Detalhes técnicos
${(a.technical_details || []).map(d => `- ${d}`).join('\n') || '_(sem detalhes específicos identificados)_'}

### Impacto cross-feature
${(a.impact || []).map(d => `- ⚠️ ${d}`).join('\n') || '_(sem impacto cross-feature identificado)_'}

### Plano de testes
${(a.test_plan || []).map(d => `- [ ] ${d}`).join('\n') || '_(definir antes do fix)_'}

**Risco:** ${riskMap[a.risk] || a.risk}

---

### Próximos passos

Para que o agente implemente o fix, comente:
- \`/fix aprovado\` — agente edita código + roda testes + abre PR
- \`/fix retry\` — só após attempt anterior; re-tenta com mesma análise
- \`/fix retry: <hint>\` — re-tenta com sua dica (ex: \`/fix retry: usa getById em vez de getByName\`)
- \`/fix detalhe\` — agente explica análise profunda
- \`/fix cancel\` — desiste, marca pra dev humano`;
}

module.exports = { triageCard, buildAnalysisComment };
```

- [ ] **Step 3: Rodar test (PASS)**

```bash
cd apps/worker && npx jest tests/agents/trello-triage.test.js
```

Expected: `Tests: 7 passed, 7 total`.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/agents/trello-triage.js apps/worker/tests/agents/trello-triage.test.js
git commit -m "feat(trello-qa): trello-triage agent + 7 tests"
```

---

## Sub-fase T-E: Agente fix + PR

### Task 8: `trello-fix.js` (Claude loop full)

**Files:**
- Create: `apps/worker/src/agents/trello-fix.js`
- Test: `apps/worker/tests/agents/trello-fix.test.js`

- [ ] **Step 1: Test trello-fix**

```javascript
// apps/worker/tests/agents/trello-fix.test.js
'use strict';
const { describe, test, expect } = require('@jest/globals');

const mockMessages = { create: jest.fn() };
jest.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = mockMessages; },
}));

const mockTools = {
  readFile: jest.fn(async () => 'file'),
  listFiles: jest.fn(async () => []),
  grep: jest.fn(async () => []),
  editFile: jest.fn(async () => ({ ok: true })),
  createFile: jest.fn(async () => ({ ok: true })),
  runTests: jest.fn(),
  runLint: jest.fn(async () => ({ success: true })),
  getToolSchemas: jest.fn(() => []),
};
jest.mock('../../src/lib/codebase-tools', () => mockTools);

const mockPr = {
  createBranchAndPR: jest.fn(),
  commitAndPushBranch: jest.fn(async () => undefined),
};
jest.mock('../../src/lib/github-pr', () => mockPr);

const { fixCard } = require('../../src/agents/trello-fix');

beforeEach(() => {
  mockMessages.create.mockReset();
  mockTools.runTests.mockReset();
  mockPr.createBranchAndPR.mockReset();
  mockPr.commitAndPushBranch.mockReset();
});

describe('fixCard', () => {
  test('happy path: edits + tests passam + PR criado', async () => {
    // Claude diz "fix concluído, pode rodar tests"
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'FIX_DONE' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 2000, output_tokens: 800 },
    });
    mockTools.runTests.mockResolvedValueOnce({
      success: true,
      exitCode: 0,
      stdout: 'Tests: 50 passed, 1 skipped',
      stderr: '',
    });
    mockPr.createBranchAndPR.mockResolvedValueOnce({
      url: 'https://github.com/x/y/pull/1', number: 1,
    });

    const r = await fixCard({
      card: { id: 'c1', idShort: 42, name: 'Bug X', desc: 'desc' },
      attempt: 1,
      hint: null,
      memberUsername: 'po1',
      repoRoot: '/tmp/repo',
      scope: 'api',
    });

    expect(r.status).toBe('pr_opened');
    expect(r.pr_url).toBe('https://github.com/x/y/pull/1');
    expect(r.branch_name).toBe('trello/42/fix-1');
    expect(r.test_summary).toMatchObject({ success: true });
    expect(mockPr.commitAndPushBranch).toHaveBeenCalled();
  });

  test('testes falham: SEM PR, retorna tests_failed', async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'FIX_DONE' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    mockTools.runTests.mockResolvedValueOnce({
      success: false,
      exitCode: 1,
      stdout: 'Tests: 3 failed',
      stderr: 'AssertionError',
    });

    const r = await fixCard({
      card: { id: 'c1', idShort: 42, name: 'Bug X', desc: 'd' },
      attempt: 1,
      hint: null,
      memberUsername: 'po',
      repoRoot: '/tmp/repo',
      scope: 'api',
    });

    expect(r.status).toBe('tests_failed');
    expect(r.pr_url).toBeUndefined();
    expect(mockPr.createBranchAndPR).not.toHaveBeenCalled();
    expect(mockPr.commitAndPushBranch).not.toHaveBeenCalled();
  });

  test('hint humano injetado no prompt', async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'OK' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockTools.runTests.mockResolvedValueOnce({
      success: true, exitCode: 0, stdout: '', stderr: '',
    });
    mockPr.createBranchAndPR.mockResolvedValueOnce({ url: 'u', number: 1 });

    await fixCard({
      card: { id: 'c1', idShort: 42, name: 'X', desc: 'd' },
      attempt: 2,
      hint: 'usa getById em vez de getByName',
      memberUsername: 'dev',
      repoRoot: '/tmp/repo',
      scope: 'api',
    });

    const callMsg = mockMessages.create.mock.calls[0][0];
    const userText = callMsg.messages[0].content;
    expect(userText).toContain('usa getById em vez de getByName');
  });

  test('branch name segue padrão trello/<short>/fix-<attempt>', async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'OK' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockTools.runTests.mockResolvedValueOnce({ success: true, exitCode: 0, stdout: '', stderr: '' });
    mockPr.createBranchAndPR.mockResolvedValueOnce({ url: 'u', number: 1 });

    await fixCard({
      card: { id: 'c1', idShort: 99, name: 'X', desc: 'd' },
      attempt: 3,
      hint: null,
      memberUsername: 'po',
      repoRoot: '/tmp/repo',
      scope: 'worker',
    });

    expect(mockPr.commitAndPushBranch).toHaveBeenCalledWith(
      expect.objectContaining({ branchName: 'trello/99/fix-3' })
    );
    expect(mockPr.createBranchAndPR).toHaveBeenCalledWith(
      expect.objectContaining({ branchName: 'trello/99/fix-3' })
    );
  });
});
```

- [ ] **Step 2: Implementar trello-fix**

```javascript
// apps/worker/src/agents/trello-fix.js
'use strict';

/**
 * Fix agent — Claude Tool Use loop full (read+edit+test).
 * SE testes passam: cria branch, commit, push, abre PR.
 * SE testes falham: SEM PR, retorna tests_failed pro processor comentar no card.
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §3.2
 */

const Anthropic = require('@anthropic-ai/sdk').default;
const tools = require('../lib/codebase-tools');
const githubPr = require('../lib/github-pr');

const MODEL = process.env.TRELLO_FIX_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;
const MAX_ITERATIONS = 30;

const SYSTEM_PROMPT = `Você é o agente de fix do GenomaFlow.

Sua tarefa: ler o card, explorar o codebase, fazer as edições necessárias.

REGRAS CRÍTICAS:
- Use edit_file pra mudar UMA ocorrência por vez (old_string deve ser único no arquivo)
- Use create_file pra arquivos novos
- NÃO crie migrations SQL (bloqueado)
- NÃO edite infra/ ou .github/ (bloqueado)
- Faça mudanças MÍNIMAS — só o que o card pede
- Quando terminar, responda apenas \`FIX_DONE\` em texto

O processor vai rodar npm test depois. SE falhar, ele NÃO cria PR.
Você só edita; testes e PR são responsabilidade do processor.`;

function _userPrompt(card, hint) {
  let p = `Card Trello pra implementar:\n\n# ${card.name} (#${card.idShort})\n\n${card.desc || '(sem descrição)'}`;
  if (hint) {
    p += `\n\n---\n\nHINT do dev/PO (attempt anterior falhou): ${hint}`;
  }
  return p;
}

async function fixCard({
  card, attempt, hint, memberUsername, repoRoot, scope = 'api',
  anthropicClient,
}) {
  const client = anthropicClient || new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 300_000,
  });

  let totalIn = 0, totalOut = 0;
  const messages = [
    { role: 'user', content: _userPrompt(card, hint) },
  ];

  // 1. Loop Claude com tools
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: tools.getToolSchemas({ readOnly: false }),
      messages,
    });
    totalIn += resp.usage?.input_tokens || 0;
    totalOut += resp.usage?.output_tokens || 0;

    if (resp.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of resp.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try {
          result = await _executeTool(block.name, block.input, repoRoot);
        } catch (e) {
          result = { error: e.message || String(e) };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result).slice(0, 5000),
        });
      }
      messages.push({ role: 'assistant', content: resp.content });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // end_turn — esperamos FIX_DONE
    break;
  }

  // 2. Rodar testes — gate antes do PR
  const testResult = await tools.runTests({ scope, repoRoot });
  const testSummary = _parseTestSummary(testResult);

  if (!testResult.success) {
    return {
      status: 'tests_failed',
      test_summary: testSummary,
      tokens_input: totalIn,
      tokens_output: totalOut,
      stdout: testResult.stdout?.slice(-3000),
      stderr: testResult.stderr?.slice(-3000),
    };
  }

  // 3. Commit + push + PR
  const branchName = `trello/${card.idShort}/fix-${attempt}`;
  const commitMessage = `fix(trello-${card.idShort}): ${card.name}\n\nTrello #${card.idShort}\nApproved by @${memberUsername}\n${hint ? '\nHint: ' + hint : ''}`;

  await githubPr.commitAndPushBranch({
    repoRoot, branchName, message: commitMessage,
  });

  const pr = await githubPr.createBranchAndPR({
    branchName,
    baseBranch: 'main',
    title: `[Trello #${card.idShort}] ${card.name}`,
    body: `Closes Trello card https://trello.com/c/${card.idShort}\n\nGerado automaticamente pelo GenomaFlow Trello QA Agent — attempt ${attempt}.\nAprovado por @${memberUsername} via \`/fix aprovado\`${hint ? '\n\nHint do revisor: ' + hint : ''}\n\n**Revise os testes localmente antes de mergear.**`,
  });

  return {
    status: 'pr_opened',
    pr_url: pr.url,
    pr_number: pr.number,
    branch_name: branchName,
    test_summary: testSummary,
    tokens_input: totalIn,
    tokens_output: totalOut,
  };
}

function _parseTestSummary(testResult) {
  const out = (testResult.stdout || '') + (testResult.stderr || '');
  const passed = (out.match(/(\d+) passed/) || [])[1];
  const failed = (out.match(/(\d+) failed/) || [])[1];
  const skipped = (out.match(/(\d+) skipped/) || [])[1];
  return {
    success: testResult.success,
    passed: passed ? parseInt(passed) : null,
    failed: failed ? parseInt(failed) : null,
    skipped: skipped ? parseInt(skipped) : null,
    exit_code: testResult.exitCode,
  };
}

async function _executeTool(name, input, repoRoot) {
  switch (name) {
    case 'read_file': return await tools.readFile({ ...input, repoRoot });
    case 'list_files': return await tools.listFiles({ ...input, repoRoot });
    case 'grep': return await tools.grep({ ...input, repoRoot });
    case 'edit_file': return await tools.editFile({ ...input, repoRoot });
    case 'create_file': return await tools.createFile({ ...input, repoRoot });
    case 'run_tests': return await tools.runTests({ ...input, repoRoot });
    case 'run_lint': return await tools.runLint({ ...input, repoRoot });
    default: throw new Error(`Tool desconhecida: ${name}`);
  }
}

module.exports = { fixCard };
```

- [ ] **Step 3: Rodar tests (PASS)**

```bash
cd apps/worker && npx jest tests/agents/trello-fix.test.js
```

Expected: `Tests: 4 passed, 4 total`.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/agents/trello-fix.js apps/worker/tests/agents/trello-fix.test.js
git commit -m "feat(trello-qa): trello-fix agent + 4 tests (gate de testes obrigatório)"
```

---

## Sub-fase T-F: Processor + slash commands

### Task 9: Processor `trello-qa.js` + worker registration

**Files:**
- Create: `apps/worker/src/processors/trello-qa.js`
- Modify: `apps/worker/src/index.js`

- [ ] **Step 1: Implementar processor**

```javascript
// apps/worker/src/processors/trello-qa.js
'use strict';

/**
 * Processor BullMQ trello-qa: orchestra triage e fix.
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §3
 */

const { Pool } = require('pg');
const {
  createAttempt, markRunning, markCompleted, markFailed,
  countCompletedAttempts, MAX_ATTEMPTS,
} = require('../../../api/src/services/trello-fix-attempts');
// ^^ Worker importa do api por compartilhar lógica. Em CI são containers
// separados; isso só roda no runtime via dynamic require quando o
// processor for ativado.

const trelloClient = require('../../../api/src/services/trello-client');
const { triageCard, buildAnalysisComment } = require('../agents/trello-triage');
const { fixCard } = require('../agents/trello-fix');

const _pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const REPO_ROOT = process.env.TRELLO_REPO_ROOT || '/app';

async function processTrelloQA({ pool, data }) {
  pool = pool || _pool;
  const client = await pool.connect();
  const startMs = Date.now();

  try {
    if (data.event === 'triage') {
      await _handleTriage(client, data, startMs);
    } else if (data.event === 'fix') {
      await _handleFix(client, data, startMs);
    } else {
      throw new Error(`Unknown event: ${data.event}`);
    }
  } finally {
    client.release();
  }
}

async function _handleTriage(client, data, startMs) {
  const { card_id, card_short_id, triggered_by } = data;

  const attempt = await createAttempt(client, {
    cardId: card_id, cardShortId: card_short_id, attempt: 0,
    triggerType: 'triage', triggeredBy: triggered_by,
  });
  await markRunning(client, attempt.id);

  try {
    const card = await trelloClient.getCard(card_id);
    const r = await triageCard({ card, repoRoot: REPO_ROOT });
    const comment = buildAnalysisComment(r.analysis);
    await trelloClient.addComment(card_id, comment);

    await markCompleted(client, attempt.id, {
      status: 'completed',
      llmTokensInput: r.tokens_input,
      llmTokensOutput: r.tokens_output,
      llmCostUsd: _estimateCost(r.tokens_input, r.tokens_output),
      processingMs: Date.now() - startMs,
    });
  } catch (err) {
    await markFailed(client, attempt.id, {
      status: 'llm_failed',
      errorCode: err.code || 'UNKNOWN',
      errorMessage: err.message,
    });
    try {
      await trelloClient.addComment(card_id,
        `🚨 Agente falhou na triagem: \`${err.code || 'UNKNOWN'}\` — ${err.message}\n\nUm dev humano vai revisar manualmente.`);
    } catch { /* best-effort */ }
  }
}

async function _handleFix(client, data, startMs) {
  const {
    card_id, card_short_id, slash_command, hint, member_username, triggered_by,
  } = data;

  // /fix detalhe — só comenta análise extra (não cria attempt)
  if (slash_command === 'detalhe') {
    // simplificação MVP: re-roda triage com prompt diferente; pra agora, comenta texto
    await trelloClient.addComment(card_id,
      `🔍 Análise detalhada vai vir aqui em proxima versão. Veja o último teste falhado no GitHub Actions ou rode \`/fix retry: <hint>\`.`);
    return;
  }

  // /fix cancel — marca card como abandonado
  if (slash_command === 'cancel') {
    await createAttempt(client, {
      cardId: card_id, cardShortId: card_short_id, attempt: 0,
      triggerType: 'cancel', triggeredBy: triggered_by,
    });
    await trelloClient.addComment(card_id,
      `✋ Cancelado por @${member_username}. Card marcado pra dev humano. Não responderei mais aqui.`);
    return;
  }

  // /fix aprovado | retry — fix real
  const completedCount = await countCompletedAttempts(client, { cardId: card_id });
  if (completedCount >= MAX_ATTEMPTS) {
    await trelloClient.addComment(card_id,
      `🛑 Limite de ${MAX_ATTEMPTS} attempts atingido. Dev humano precisa intervir.`);
    return;
  }

  const newAttempt = completedCount + 1;
  const triggerType = slash_command === 'retry' ? 'retry' : 'fix';

  const attempt = await createAttempt(client, {
    cardId: card_id, cardShortId: card_short_id, attempt: newAttempt,
    triggerType, triggeredBy: triggered_by, hint,
  });
  await markRunning(client, attempt.id);

  try {
    const card = await trelloClient.getCard(card_id);
    const r = await fixCard({
      card, attempt: newAttempt, hint, memberUsername: member_username,
      repoRoot: REPO_ROOT,
      scope: 'api', // simplificação — agente pode rodar tests de múltiplos scopes em v2
    });

    if (r.status === 'pr_opened') {
      await markCompleted(client, attempt.id, {
        status: 'pr_opened',
        prUrl: r.pr_url, branchName: r.branch_name,
        testSummary: r.test_summary,
        llmTokensInput: r.tokens_input, llmTokensOutput: r.tokens_output,
        llmCostUsd: _estimateCost(r.tokens_input, r.tokens_output),
        processingMs: Date.now() - startMs,
      });
      await trelloClient.addComment(card_id,
        `✅ PR aberto: ${r.pr_url}\n\nTestes verdes (${r.test_summary?.passed} passed). Revise antes de mergear.`);
    } else if (r.status === 'tests_failed') {
      await markCompleted(client, attempt.id, {
        status: 'tests_failed',
        testSummary: r.test_summary,
        llmTokensInput: r.tokens_input, llmTokensOutput: r.tokens_output,
        llmCostUsd: _estimateCost(r.tokens_input, r.tokens_output),
        processingMs: Date.now() - startMs,
      });
      const failedCount = r.test_summary?.failed || '?';
      await trelloClient.addComment(card_id,
        `❌ Testes falharam (${failedCount}). NÃO criei PR.\n\nSaída resumida:\n\`\`\`\n${(r.stdout || '').slice(-1500)}\n\`\`\`\n\nComente \`/fix retry: <hint>\` com sua dica ou \`/fix cancel\` se quiser dev humano.`);
    }
  } catch (err) {
    await markFailed(client, attempt.id, {
      status: 'llm_failed',
      errorCode: err.code || 'UNKNOWN',
      errorMessage: err.message,
    });
    await trelloClient.addComment(card_id,
      `🚨 Agente falhou: \`${err.code || 'UNKNOWN'}\` — ${err.message}\n\nComente \`/fix retry\` pra tentar de novo ou \`/fix cancel\`.`);
  }
}

function _estimateCost(input, output) {
  // Claude Sonnet 4.6: ~$3/1M input, ~$15/1M output (aproximação)
  return ((input * 3) + (output * 15)) / 1_000_000;
}

module.exports = { processTrelloQA };
```

- [ ] **Step 2: Registrar worker no index.js**

Em `apps/worker/src/index.js`, após o registro do `aestheticDepth`:

```javascript
const { processTrelloQA } = require('./processors/trello-qa');
const trelloQAConn = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

const trelloQAWorker = new Worker('trello-qa', async (job) => {
  console.log(`[trello-qa-worker] Job ${job.id} event=${job.data.event} card=${job.data.card_short_id}`);
  await processTrelloQA({ data: job.data });
}, {
  connection: trelloQAConn,
  concurrency: 1,                 // fix é caro (LLM + tests + git)
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 86400 },
});

trelloQAWorker.on('completed', (job) => console.log(`[trello-qa-worker] Job ${job.id} completed`));
trelloQAWorker.on('failed', (job, err) => console.error(`[trello-qa-worker] Job ${job.id} failed: ${err.message}`));
```

Adicionar `trelloQAWorker.close()` e `trelloQAConn.quit()` no shutdown handler.

Atualizar a string de log final: `Listening for ..., trello-qa jobs and index events...`.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/processors/trello-qa.js apps/worker/src/index.js
git commit -m "feat(trello-qa): processor + worker registration (concurrency 1)"
```

---

## Sub-fase T-G: CDK secrets

### Task 10: SSM secrets em CDK

**Files:**
- Modify: `infra/lib/ecs-stack.ts`

- [ ] **Step 1: Adicionar secrets**

Em `infra/lib/ecs-stack.ts`, no bloco onde já estão definidos secrets pra API/Worker, adicionar:

```typescript
// ... no objeto secrets passado pra container ...
const trelloSecrets = {
  TRELLO_API_KEY: ecs.Secret.fromSsmParameter(
    ssm.StringParameter.fromStringParameterAttributes(this, 'TrelloApiKey', {
      parameterName: '/genomaflow/prod/trello-api-key',
    })
  ),
  TRELLO_API_TOKEN: ecs.Secret.fromSsmParameter(
    ssm.StringParameter.fromStringParameterAttributes(this, 'TrelloApiToken', {
      parameterName: '/genomaflow/prod/trello-api-token',
    })
  ),
  TRELLO_WEBHOOK_SECRET: ecs.Secret.fromSsmParameter(
    ssm.StringParameter.fromStringParameterAttributes(this, 'TrelloWebhookSecret', {
      parameterName: '/genomaflow/prod/trello-webhook-secret',
    })
  ),
  TRELLO_BOARD_ID: ecs.Secret.fromSsmParameter(
    ssm.StringParameter.fromStringParameterAttributes(this, 'TrelloBoardId', {
      parameterName: '/genomaflow/prod/trello-board-id',
    })
  ),
  TRELLO_QA_LIST_ID: ecs.Secret.fromSsmParameter(
    ssm.StringParameter.fromStringParameterAttributes(this, 'TrelloQaListId', {
      parameterName: '/genomaflow/prod/trello-qa-list-id',
    })
  ),
  GITHUB_BOT_TOKEN: ecs.Secret.fromSsmParameter(
    ssm.StringParameter.fromStringParameterAttributes(this, 'GithubBotToken', {
      parameterName: '/genomaflow/prod/github-bot-token',
    })
  ),
};

// Merge em ambos API e Worker container definitions
apiTaskDef.addContainer('api', {
  // ... existente ...
  secrets: { ...existingSecrets, ...trelloSecrets },
});
workerTaskDef.addContainer('worker', {
  // ... existente ...
  secrets: { ...existingSecrets, ...trelloSecrets },
});
```

Também adicionar `WEBHOOK_CALLBACK_URL` em environment (não secret):

```typescript
environment: {
  // ... existente ...
  WEBHOOK_CALLBACK_URL: 'https://app.genomaflow.com.br/api/webhooks/trello',
  TRELLO_TRIAGE_MODEL: 'claude-sonnet-4-6',
  TRELLO_FIX_MODEL: 'claude-sonnet-4-6',
  TRELLO_REPO_ROOT: '/app',
}
```

- [ ] **Step 2: Pre-criar parâmetros SSM em produção (manual)**

Antes do `cdk deploy`, criar os parâmetros:

```bash
# Localmente, com AWS CLI configurada
AWS_REGION=us-east-1 aws ssm put-parameter \
  --name /genomaflow/prod/trello-api-key --value "<KEY>" --type SecureString

AWS_REGION=us-east-1 aws ssm put-parameter \
  --name /genomaflow/prod/trello-api-token --value "<TOKEN>" --type SecureString

AWS_REGION=us-east-1 aws ssm put-parameter \
  --name /genomaflow/prod/trello-webhook-secret --value "<RANDOM 32 BYTES>" --type SecureString

AWS_REGION=us-east-1 aws ssm put-parameter \
  --name /genomaflow/prod/trello-board-id --value "<BOARD_ID>" --type String

AWS_REGION=us-east-1 aws ssm put-parameter \
  --name /genomaflow/prod/trello-qa-list-id --value "<LIST_ID>" --type String

AWS_REGION=us-east-1 aws ssm put-parameter \
  --name /genomaflow/prod/github-bot-token --value "<PAT>" --type SecureString
```

- [ ] **Step 3: CDK diff + deploy**

```bash
cd infra && AWS_SHARED_CREDENTIALS_FILE="$PWD/../aws/credentials" \
  CDK_DEFAULT_ACCOUNT=981207388012 CDK_DEFAULT_REGION=us-east-1 \
  npx cdk diff genomaflow-ecs
```

Confirma que mostra a adição dos 6 secrets + 4 env vars.

```bash
cd infra && AWS_SHARED_CREDENTIALS_FILE="$PWD/../aws/credentials" \
  CDK_DEFAULT_ACCOUNT=981207388012 CDK_DEFAULT_REGION=us-east-1 \
  npx cdk deploy genomaflow-ecs --require-approval never
```

- [ ] **Step 4: Commit + push**

```bash
git add infra/lib/ecs-stack.ts
git commit -m "feat(trello-qa): IAM/Secrets CDK pros 6 secrets Trello + GitHub PAT"
```

- [ ] **Step 5: Registrar webhook no Trello (manual)**

Após CDK deploy + commit api/worker em prod, registrar webhook chamando:

```bash
curl -X POST \
  "https://api.trello.com/1/webhooks/?key=<KEY>&token=<TOKEN>" \
  -d 'description=GenomaFlow QA Agent' \
  -d 'callbackURL=https://app.genomaflow.com.br/api/webhooks/trello' \
  -d 'idModel=<BOARD_ID>'
```

Trello vai chamar HEAD/GET no callbackURL na criação — endpoint já responde 200.

---

## Sub-fase T-H: Memória + smoke test

### Task 11: Memória + smoke prod

**Files:**
- Create: `docs/claude-memory/project_trello_qa_agent.md`
- Modify: `docs/claude-memory/MEMORY.md`

- [ ] **Step 1: Escrever memória**

```markdown
---
name: Trello QA Agent
description: Agente IA integrado ao Trello que enriquece cards na coluna QA (triagem automática) e, sob /fix aprovado, edita codebase + roda testes + abre PR. Entregue YYYY-MM-DD.
type: project
---

# Trello QA Agent

Webhook Trello → worker BullMQ → Claude Tool Use → triagem ou fix.

## Componentes

[Tabela com arquivos e responsabilidades — copiar do plan]

## Pipeline

[Diagrama do spec §3]

## Slash commands

[Tabela do spec §3.3]

## Secrets

6 secrets em SSM Parameter Store. CDK ecs-stack.ts injeta como
containerDefinitions[].secrets em api+worker.

## Limites operacionais

- Max 5 attempts/card (depois força /fix cancel)
- Max 200k tokens/attempt (cost cap LLM)
- Max 20 iterations no loop triagem
- Max 30 iterations no loop fix
- Tests obrigatórios antes do PR

## Pendências conhecidas

- /fix detalhe ainda é stub — implementar análise profunda do último erro
- Scope auto-detect (agente decide se roda tests do api/worker/web) — hoje fixo api
- Multi-tenant — fora de escopo MVP

## Não regredir

❌ Não desabilitar gate de testes antes do PR
❌ Não permitir agente editar infra/ ou migrations/
❌ Não auto-mergear PR
❌ Não passar attempt > 5
```

- [ ] **Step 2: Atualizar MEMORY.md**

Adicionar ao index.

- [ ] **Step 3: Commit + push**

```bash
git add docs/claude-memory/project_trello_qa_agent.md docs/claude-memory/MEMORY.md
git commit -m "docs(memory): Trello QA Agent entregue"
git push origin main
```

- [ ] **Step 4: Smoke test em produção**

1. Verificar deploy verde no GitHub Actions
2. Mover um card pra coluna QA no Trello
3. Aguardar ~30s
4. Verificar:
   - Comentário "🤖 Análise Automática" aparece no card
   - Tabela `trello_fix_attempts` tem 1 row com `attempt=0, status=completed`
5. Comentar `/fix aprovado` no card
6. Aguardar ~2-5min
7. Verificar:
   - Worker logs no CloudWatch mostram inicio do fix
   - SE tests passam: PR aparece no GitHub + comentário no card
   - SE tests falham: comentário no card explicando erros

- [ ] **Step 5: Documentar resultado smoke no memory**

Atualiza `project_trello_qa_agent.md` com data de entrega e qualquer ajuste necessário descoberto no smoke.

---

## Self-review checklist

- [ ] **Spec coverage:** todas as 12 decisões D1-D10 + sub-fases T-A a T-H implementadas
- [ ] **Sem placeholders:** todo step tem código completo
- [ ] **Type consistency:** `triageCard`, `fixCard`, `createAttempt`, `markRunning`, etc. usados consistentemente entre tasks
- [ ] **Allowlist paths:** `EDITABLE_PREFIXES` e `BLOCKED_PATTERNS` definidos em codebase-tools.js task 5; usados em task 8 fix agent
- [ ] **Tabelas/colunas:** `trello_fix_attempts` colunas match entre migration (task 1), service (task 2), processor (task 9)
- [ ] **Naming branches/PR:** padrão `trello/<short>/fix-<attempt>` consistent task 8 + task 9

## Estimativa

- 11 tasks
- ~2700 LOC
- ~52 testes (11 + 10 + 9 + 19 + 2 + 7 + 4 = 62; estimei 40 no spec, é maior)
- 1 migration
- 6 SSM parameters
- 1 cdk deploy manual
- 1 Trello webhook registration manual

**Tempo:** 3-5 dias de implementação ativa.
