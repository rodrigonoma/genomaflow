# Aesthetic V2 — Fase 1 Implementation Plan

**Spec:** `docs/superpowers/specs/2026-05-12-aesthetic-v2-fase1-design.md`

**Goal:** Adicionar tier `advanced` à plataforma estética com captura guiada de 5 fotos faciais ou 4 corporais via MediaPipe Web, landmarks salvos no cliente, métricas geométricas calculadas no worker, mantendo tier `standard` (F1-F6) totalmente intacto.

**Architecture:** Schema aditivo (4 migrations) → routes tier-aware → frontend lazy-loaded MediaPipe + tier selector + captura wizard → worker agente de landmarks-metrics tier-gated → resultado com overlay e comparação evolutiva.

**Tech Stack:** Postgres 15 + Fastify + BullMQ worker (existente), `@mediapipe/tasks-vision@0.10.16` (frontend, lazy), Angular 18 standalone, Capacitor 6 (mobile sync).

**Branch:** `feat/aesthetic-v2-fase1` (já criada). Cada sub-fase = 1 commit ff-only após aprovação local + smoke test.

---

## Sumário de sub-fases

| Sub-fase | Conteúdo | Critério done |
|---|---|---|
| V2-A | Schema + RLS + audit + tier column + credit_ledger kinds | 4 migrations aplicadas em local, integration test passa |
| V2-B | Routes tier-aware + sessions CRUD + compare gate + validate service | API tests + integration tests verdes |
| V2-C | Frontend tier selector + captura facial + MediaPipe lazy + heurísticas | Wizard funcional desktop+mobile, smoke Android |
| V2-D | Frontend captura corporal | Wizard 4 poses corporais funcional |
| V2-E | Worker aesthetic-landmarks-metrics + processor integration | 10 métricas calculadas, worker tests verdes |
| V2-F | Resultado tier-aware + landmarks overlay + compare UI + PDF section | Análise end-to-end live + comparação evolutiva |

---

# Sub-fase V2-A — Schema + Migrations

### Task A1: Migration 099 — aesthetic_sessions

**Files:**
- Create: `apps/api/src/db/migrations/099_aesthetic_sessions.sql`
- Test: `apps/api/tests/db/migrations-aesthetic-v2.test.js`

- [ ] **Step 1: Escrever migration**

```sql
-- 099_aesthetic_sessions.sql
-- Wrapper de avaliação estética V2: agrupa N fotos padronizadas + 1 análise.
-- tier=advanced exige session_id obrigatório (FK em aesthetic_analyses).

CREATE TABLE IF NOT EXISTS aesthetic_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_type VARCHAR(50) NOT NULL,
  notes TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT aesthetic_sessions_type_check
    CHECK (session_type IN ('facial_analysis', 'body_analysis'))
);

ALTER TABLE aesthetic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY aesthetic_sessions_tenant ON aesthetic_sessions
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_aesthetic_sessions_subject
  ON aesthetic_sessions (tenant_id, subject_id, session_date DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER aesthetic_sessions_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_sessions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

- [ ] **Step 2: Test migration aplica + tabela existe + RLS ativo + trigger criado**

```javascript
// apps/api/tests/db/migrations-aesthetic-v2.test.js
const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const { runMigrations, closePool, getPool } = require('../integration/setup');

describe('Migrations V2 Fase 1', () => {
  beforeAll(async () => { await runMigrations(); });
  afterAll(async () => { await closePool(); });

  test('099: aesthetic_sessions existe com RLS + trigger', async () => {
    const pool = getPool();
    const { rows: cols } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='aesthetic_sessions' ORDER BY column_name`);
    const names = cols.map(c => c.column_name);
    expect(names).toEqual(expect.arrayContaining([
      'id','tenant_id','subject_id','user_id','session_date','session_type',
      'notes','deleted_at','created_at'
    ]));

    const { rows: rls } = await pool.query(`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname='aesthetic_sessions'`);
    expect(rls[0].relrowsecurity).toBe(true);
    expect(rls[0].relforcerowsecurity).toBe(true);

    const { rows: trg } = await pool.query(`
      SELECT tgname FROM pg_trigger WHERE tgrelid='aesthetic_sessions'::regclass`);
    expect(trg.some(t => t.tgname === 'aesthetic_sessions_audit')).toBe(true);
  });
});
```

- [ ] **Step 3: Aplicar migration local + rodar test**

```bash
docker compose exec api node src/db/migrate.js
cd apps/api && npm test -- tests/db/migrations-aesthetic-v2.test.js
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/099_aesthetic_sessions.sql apps/api/tests/db/migrations-aesthetic-v2.test.js
git commit -m "feat(aesthetic-v2): migration 099 aesthetic_sessions + RLS + audit"
```

---

### Task A2: Migration 100 — aesthetic_photos pose + landmarks

**Files:**
- Create: `apps/api/src/db/migrations/100_aesthetic_photos_pose_landmarks.sql`
- Modify: `apps/api/tests/db/migrations-aesthetic-v2.test.js`

- [ ] **Step 1: Migration**

```sql
-- 100_aesthetic_photos_pose_landmarks.sql
-- V2 advanced grava pose + landmarks por foto. NULL preserva fotos F1-F6.

ALTER TABLE aesthetic_photos
  ADD COLUMN IF NOT EXISTS pose VARCHAR(40),
  ADD COLUMN IF NOT EXISTS landmarks JSONB,
  ADD COLUMN IF NOT EXISTS session_id UUID
    REFERENCES aesthetic_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_aesthetic_photos_pose
  ON aesthetic_photos (tenant_id, subject_id, pose)
  WHERE pose IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_aesthetic_photos_session
  ON aesthetic_photos (session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN aesthetic_photos.pose IS
  'Pose declarada V2. Facial: frontal/profile_left/profile_right/45_left/45_right. Body: body_front/body_back/body_lateral_left/body_lateral_right. NULL = legacy F1-F6.';
COMMENT ON COLUMN aesthetic_photos.landmarks IS
  'Landmarks MediaPipe detectados no cliente. NULL = legacy/standard tier.';
```

- [ ] **Step 2: Test additivo**

Append em `migrations-aesthetic-v2.test.js`:

```javascript
test('100: aesthetic_photos ganha pose + landmarks + session_id', async () => {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='aesthetic_photos' AND column_name IN ('pose','landmarks','session_id')`);
  const map = Object.fromEntries(rows.map(r => [r.column_name, r.data_type]));
  expect(map.pose).toBe('character varying');
  expect(map.landmarks).toBe('jsonb');
  expect(map.session_id).toBe('uuid');
});
```

- [ ] **Step 3: Aplicar + run test**

```bash
docker compose exec api node src/db/migrate.js
cd apps/api && npm test -- tests/db/migrations-aesthetic-v2.test.js
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/100_aesthetic_photos_pose_landmarks.sql apps/api/tests/db/migrations-aesthetic-v2.test.js
git commit -m "feat(aesthetic-v2): migration 100 aesthetic_photos pose+landmarks+session_id"
```

---

### Task A3: Migration 101 — aesthetic_analyses tier + session_id

**Files:**
- Create: `apps/api/src/db/migrations/101_aesthetic_analyses_tier_session.sql`

- [ ] **Step 1: Migration**

```sql
-- 101_aesthetic_analyses_tier_session.sql
-- tier='standard' (default) preserva F1-F6. tier='advanced' = V2 com captura guiada.

ALTER TABLE aesthetic_analyses
  ADD COLUMN IF NOT EXISTS session_id UUID NULL
    REFERENCES aesthetic_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'standard';

ALTER TABLE aesthetic_analyses
  ADD CONSTRAINT aesthetic_analyses_tier_check
  CHECK (tier IN ('standard', 'advanced'));

CREATE INDEX IF NOT EXISTS idx_aesthetic_analyses_session
  ON aesthetic_analyses (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aesthetic_analyses_tier
  ON aesthetic_analyses (tenant_id, tier, created_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN aesthetic_analyses.tier IS
  'standard (F1-F6, 5cr, 1-3 fotos) | advanced (V2 captura guiada, 10cr, 5 fotos + landmarks).';
COMMENT ON COLUMN aesthetic_analyses.session_id IS
  'Obrigatório quando tier=advanced. NULL para tier=standard (legacy).';
```

- [ ] **Step 2: Test**

```javascript
test('101: aesthetic_analyses ganha tier (default standard) + session_id', async () => {
  const pool = getPool();
  const { rows: cols } = await pool.query(`
    SELECT column_name, column_default, is_nullable FROM information_schema.columns
    WHERE table_name='aesthetic_analyses' AND column_name IN ('tier','session_id')`);
  const map = Object.fromEntries(cols.map(r => [r.column_name, r]));
  expect(map.tier.column_default).toMatch(/standard/);
  expect(map.tier.is_nullable).toBe('NO');
  expect(map.session_id.is_nullable).toBe('YES');

  const { rows: chk } = await pool.query(`
    SELECT conname FROM pg_constraint WHERE conrelid='aesthetic_analyses'::regclass
      AND conname='aesthetic_analyses_tier_check'`);
  expect(chk.length).toBe(1);
});
```

- [ ] **Step 3: Aplicar + run**

```bash
docker compose exec api node src/db/migrate.js
cd apps/api && npm test -- tests/db/migrations-aesthetic-v2.test.js
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/101_aesthetic_analyses_tier_session.sql apps/api/tests/db/migrations-aesthetic-v2.test.js
git commit -m "feat(aesthetic-v2): migration 101 aesthetic_analyses tier + session_id"
```

---

### Task A4: Migration 102 — credit_ledger kinds advanced

**Files:**
- Create: `apps/api/src/db/migrations/102_credit_ledger_advanced_kinds.sql`

- [ ] **Step 1: Migration**

```sql
-- 102_credit_ledger_advanced_kinds.sql
-- Adiciona kinds *_advanced para tier V2. Drop+recreate constraint (única forma de estender CHECK).

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_kind_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_kind_check
  CHECK (kind IN (
    'topup', 'adjustment', 'aesthetic_refund',
    -- standard tier (migration 098)
    'aesthetic_facial_analysis', 'aesthetic_eyelids_analysis', 'aesthetic_neck_analysis',
    'aesthetic_breast_analysis', 'aesthetic_arms_analysis', 'aesthetic_abdomen_analysis',
    'aesthetic_legs_analysis', 'aesthetic_glutes_analysis', 'aesthetic_full_body_analysis',
    'aesthetic_other_analysis',
    -- advanced tier (V2 Fase 1)
    'aesthetic_facial_analysis_advanced', 'aesthetic_eyelids_analysis_advanced',
    'aesthetic_neck_analysis_advanced', 'aesthetic_breast_analysis_advanced',
    'aesthetic_arms_analysis_advanced', 'aesthetic_abdomen_analysis_advanced',
    'aesthetic_legs_analysis_advanced', 'aesthetic_glutes_analysis_advanced',
    'aesthetic_full_body_analysis_advanced', 'aesthetic_other_analysis_advanced'
  ));
```

- [ ] **Step 2: Test**

```javascript
test('102: credit_ledger_kind_check aceita kinds *_advanced', async () => {
  const pool = getPool();
  // Pega um tenant fictício pra teste (qualquer um — RLS desligado em teardown não conta aqui)
  await pool.query("SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', true)");
  // Insert deve não levantar constraint violation
  await expect(pool.query(`
    INSERT INTO credit_ledger (tenant_id, amount, kind, description)
    VALUES ('00000000-0000-0000-0000-000000000000', 10, 'aesthetic_facial_analysis_advanced', 'test')
    RETURNING id`)).resolves.toBeTruthy();
  await pool.query("DELETE FROM credit_ledger WHERE description='test'");
});
```

- [ ] **Step 3: Aplicar + run**

```bash
docker compose exec api node src/db/migrate.js
cd apps/api && npm test -- tests/db/migrations-aesthetic-v2.test.js
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/102_credit_ledger_advanced_kinds.sql apps/api/tests/db/migrations-aesthetic-v2.test.js
git commit -m "feat(aesthetic-v2): migration 102 credit_ledger kinds *_advanced"
```

---

### Task A5: Repo aesthetic-sessions service

**Files:**
- Create: `apps/api/src/services/aesthetic-sessions.js`
- Create: `apps/api/tests/services/aesthetic-sessions.test.js`

- [ ] **Step 1: Service**

```javascript
// apps/api/src/services/aesthetic-sessions.js
'use strict';
const { withTenant } = require('../db/tenant');

const VALID_TYPES = new Set(['facial_analysis', 'body_analysis']);

async function createSession(pg, { tenantId, subjectId, userId, sessionType, notes }) {
  if (!VALID_TYPES.has(sessionType)) {
    throw Object.assign(new Error('INVALID_SESSION_TYPE'), { status: 400 });
  }
  return await withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(`
      INSERT INTO aesthetic_sessions (tenant_id, subject_id, user_id, session_type, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, session_date, session_type, notes, created_at`,
      [tenantId, subjectId, userId, sessionType, notes || null]);
    return rows[0];
  }, { userId, channel: 'ui' });
}

async function listForSubject(pg, { tenantId, subjectId, limit = 20, offset = 0 }) {
  return await withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(`
      SELECT id, session_date, session_type, notes, created_at
        FROM aesthetic_sessions
       WHERE tenant_id = $1 AND subject_id = $2 AND deleted_at IS NULL
       ORDER BY session_date DESC
       LIMIT $3 OFFSET $4`,
      [tenantId, subjectId, limit, offset]);
    return rows;
  });
}

async function getById(pg, { tenantId, sessionId }) {
  return await withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(`
      SELECT id, tenant_id, subject_id, user_id, session_date, session_type, notes, created_at
        FROM aesthetic_sessions
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [sessionId, tenantId]);
    return rows[0] || null;
  });
}

module.exports = { createSession, listForSubject, getById };
```

- [ ] **Step 2: Tests**

```javascript
// apps/api/tests/services/aesthetic-sessions.test.js
const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { createSession } = require('../../src/services/aesthetic-sessions');

jest.mock('../../src/db/tenant', () => ({
  withTenant: jest.fn(async (pg, _t, fn) => fn(pg)),
}));

describe('aesthetic-sessions service', () => {
  test('createSession rejeita session_type inválido', async () => {
    await expect(createSession({}, { sessionType: 'invalid' })).rejects.toMatchObject({
      message: 'INVALID_SESSION_TYPE', status: 400,
    });
  });

  test('createSession INSERT + retorna row', async () => {
    const mockPg = { query: jest.fn().mockResolvedValueOnce({
      rows: [{ id: 'uuid', session_date: 'now', session_type: 'facial_analysis', notes: null, created_at: 'now' }],
    })};
    const result = await createSession(mockPg, {
      tenantId: 't1', subjectId: 's1', userId: 'u1', sessionType: 'facial_analysis',
    });
    expect(result.id).toBe('uuid');
    expect(mockPg.query.mock.calls[0][0]).toMatch(/INSERT INTO aesthetic_sessions/);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd apps/api && npm test -- tests/services/aesthetic-sessions.test.js
git add apps/api/src/services/aesthetic-sessions.js apps/api/tests/services/aesthetic-sessions.test.js
git commit -m "feat(aesthetic-v2): aesthetic-sessions service (create/list/get)"
```

---

# Sub-fase V2-B — Backend Routes + Validation

### Task B1: Landmarks validate service

**Files:**
- Create: `apps/api/src/services/aesthetic-landmarks-validate.js`
- Create: `apps/api/tests/services/aesthetic-landmarks-validate.test.js`

- [ ] **Step 1: Service**

```javascript
// apps/api/src/services/aesthetic-landmarks-validate.js
'use strict';

const FACE_POINTS = 468;
const BODY_POINTS = 33;
const VALID_PROVIDERS = new Set(['mediapipe']);

function isValidPoint(p) {
  return p && typeof p === 'object'
    && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
    && p.x >= -1 && p.x <= 2
    && p.y >= -1 && p.y <= 2
    && p.z >= -1 && p.z <= 2;
}

function validateLandmarks(lm, pose) {
  if (!lm || typeof lm !== 'object') {
    return { valid: false, error: 'LANDMARKS_MISSING' };
  }
  if (!VALID_PROVIDERS.has(lm.provider)) {
    return { valid: false, error: 'INVALID_PROVIDER' };
  }
  if (lm.type !== 'face' && lm.type !== 'body') {
    return { valid: false, error: 'INVALID_TYPE' };
  }
  if (!Array.isArray(lm.points)) {
    return { valid: false, error: 'POINTS_NOT_ARRAY' };
  }
  const expected = lm.type === 'face' ? FACE_POINTS : BODY_POINTS;
  if (lm.points.length !== expected) {
    return { valid: false, error: `POINTS_COUNT_${lm.points.length}_EXPECTED_${expected}` };
  }
  if (!lm.points.every(isValidPoint)) {
    return { valid: false, error: 'POINT_OUT_OF_RANGE' };
  }
  // Coerência type vs pose
  const isFacePose = ['frontal','profile_left','profile_right','45_left','45_right'].includes(pose);
  const isBodyPose = ['body_front','body_back','body_lateral_left','body_lateral_right'].includes(pose);
  if (lm.type === 'face' && !isFacePose) return { valid: false, error: 'TYPE_POSE_MISMATCH' };
  if (lm.type === 'body' && !isBodyPose) return { valid: false, error: 'TYPE_POSE_MISMATCH' };
  return { valid: true };
}

module.exports = { validateLandmarks, FACE_POINTS, BODY_POINTS };
```

- [ ] **Step 2: Tests** (matriz)

```javascript
// apps/api/tests/services/aesthetic-landmarks-validate.test.js
const { describe, test, expect } = require('@jest/globals');
const { validateLandmarks } = require('../../src/services/aesthetic-landmarks-validate');

const validPoint = { x: 0.5, y: 0.5, z: 0 };
const facePoints = Array(468).fill(validPoint);
const bodyPoints = Array(33).fill(validPoint);

describe('validateLandmarks', () => {
  test('face com 468 pts válidos + pose frontal → OK', () => {
    const lm = { type: 'face', provider: 'mediapipe', provider_version: '0.10.16', model: 'face_landmarker_v1', points: facePoints, detected_at: 'now' };
    expect(validateLandmarks(lm, 'frontal')).toEqual({ valid: true });
  });
  test('body com 33 pts + body_front → OK', () => {
    const lm = { type: 'body', provider: 'mediapipe', provider_version: '0.10.16', model: 'pose_landmarker_v1', points: bodyPoints, detected_at: 'now' };
    expect(validateLandmarks(lm, 'body_front')).toEqual({ valid: true });
  });
  test('face com 467 pts → POINTS_COUNT', () => {
    const lm = { type: 'face', provider: 'mediapipe', points: facePoints.slice(1) };
    expect(validateLandmarks(lm, 'frontal').error).toMatch(/POINTS_COUNT/);
  });
  test('provider desconhecido → INVALID_PROVIDER', () => {
    const lm = { type: 'face', provider: 'openpose', points: facePoints };
    expect(validateLandmarks(lm, 'frontal').error).toBe('INVALID_PROVIDER');
  });
  test('ponto fora do range [-1,2] → POINT_OUT_OF_RANGE', () => {
    const bad = [{ x: 5, y: 0.5, z: 0 }, ...facePoints.slice(1)];
    const lm = { type: 'face', provider: 'mediapipe', points: bad };
    expect(validateLandmarks(lm, 'frontal').error).toBe('POINT_OUT_OF_RANGE');
  });
  test('type=face mas pose corporal → TYPE_POSE_MISMATCH', () => {
    const lm = { type: 'face', provider: 'mediapipe', points: facePoints };
    expect(validateLandmarks(lm, 'body_front').error).toBe('TYPE_POSE_MISMATCH');
  });
  test('landmarks null → LANDMARKS_MISSING', () => {
    expect(validateLandmarks(null, 'frontal').error).toBe('LANDMARKS_MISSING');
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd apps/api && npm test -- tests/services/aesthetic-landmarks-validate.test.js
# Append a 'test:unit' lista em package.json
git add apps/api/src/services/aesthetic-landmarks-validate.js apps/api/tests/services/aesthetic-landmarks-validate.test.js apps/api/package.json
git commit -m "feat(aesthetic-v2): aesthetic-landmarks-validate (shape + count + range + type/pose coerência)"
```

---

### Task B2: POST/GET /aesthetic/sessions routes

**Files:**
- Create: `apps/api/src/routes/aesthetic-sessions.js`
- Modify: `apps/api/src/server.js` (registrar rota)
- Create: `apps/api/tests/routes/aesthetic-sessions.test.js`

- [ ] **Step 1: Routes**

```javascript
// apps/api/src/routes/aesthetic-sessions.js
'use strict';
const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { createSession, listForSubject, getById } = require('../services/aesthetic-sessions');

module.exports = async function (fastify) {
  fastify.post('/sessions', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { subject_id, session_type, notes } = request.body || {};
    if (!subject_id) return reply.status(400).send({ error: 'subject_id obrigatório' });
    if (!session_type) return reply.status(400).send({ error: 'session_type obrigatório' });
    try {
      const session = await createSession(fastify.pg, {
        tenantId: request.user.tenant_id,
        subjectId: subject_id,
        userId: request.user.user_id,
        sessionType: session_type,
        notes,
      });
      return reply.status(201).send(session);
    } catch (e) {
      if (e.status === 400) return reply.status(400).send({ error: e.message });
      throw e;
    }
  });

  fastify.get('/sessions', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { subject_id, limit, offset } = request.query;
    if (!subject_id) return reply.status(400).send({ error: 'subject_id obrigatório' });
    const items = await listForSubject(fastify.pg, {
      tenantId: request.user.tenant_id,
      subjectId: subject_id,
      limit: Math.min(100, Math.max(1, parseInt(limit) || 20)),
      offset: Math.max(0, parseInt(offset) || 0),
    });
    return reply.send({ items });
  });

  fastify.get('/sessions/:id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
  }, async (request, reply) => {
    const session = await getById(fastify.pg, {
      tenantId: request.user.tenant_id,
      sessionId: request.params.id,
    });
    if (!session) return reply.status(404).send({ error: 'Sessão não encontrada' });
    return reply.send(session);
  });
};
```

- [ ] **Step 2: Registrar em server.js**

```javascript
// server.js (procurar bloco aesthetic routes, adicionar:)
await fastify.register(require('./routes/aesthetic-sessions'), { prefix: API_PREFIX + '/aesthetic' });
```

- [ ] **Step 3: Tests**

```javascript
// apps/api/tests/routes/aesthetic-sessions.test.js
// Estrutura espelhando outros routes tests da plataforma — 6 tests:
// 1. POST sem subject_id → 400
// 2. POST sem session_type → 400
// 3. POST session_type inválido → 400
// 4. POST happy path → 201 + body com id+session_date
// 5. GET sem subject_id → 400
// 6. GET happy → 200 com items[]
// Reusa setup de mock pg padrão da plataforma.
```

- [ ] **Step 4: Append test:unit + integration test em test-server.js**

Estender `apps/api/tests/integration/test-server.js` para registrar `aesthetic-sessions` route.

- [ ] **Step 5: Run + commit**

```bash
cd apps/api && npm run test:unit && npm test -- tests/routes/aesthetic-sessions.test.js
git add apps/api/src/routes/aesthetic-sessions.js apps/api/src/server.js apps/api/tests/routes/aesthetic-sessions.test.js apps/api/tests/integration/test-server.js apps/api/package.json
git commit -m "feat(aesthetic-v2): POST/GET /aesthetic/sessions com requireEsteticaModule"
```

---

### Task B3: Estender POST /aesthetic/photos (pose + landmarks + session_id)

**Files:**
- Modify: `apps/api/src/routes/aesthetic-photos.js`
- Modify: `apps/api/src/services/aesthetic-photos.js` (ou inline)
- Modify tests existentes

- [ ] **Step 1: Aceitar novos campos no body**

```javascript
// Em aesthetic-photos.js, no handler POST /photos:
const { pose, landmarks, session_id } = request.body || {};

if (pose) {
  const VALID_POSES = new Set([
    'frontal','profile_left','profile_right','45_left','45_right',
    'body_front','body_back','body_lateral_left','body_lateral_right',
  ]);
  if (!VALID_POSES.has(pose)) {
    return reply.status(400).send({ error: 'INVALID_POSE' });
  }
}

if (landmarks) {
  const { validateLandmarks } = require('../services/aesthetic-landmarks-validate');
  const { valid, error } = validateLandmarks(landmarks, pose);
  if (!valid) return reply.status(400).send({ error: 'INVALID_LANDMARKS', code: error });
}

if (session_id) {
  // Validar session pertence ao tenant + subject
  const { getById } = require('../services/aesthetic-sessions');
  const sess = await getById(fastify.pg, { tenantId, sessionId: session_id });
  if (!sess || sess.subject_id !== subject_id) {
    return reply.status(400).send({ error: 'INVALID_SESSION' });
  }
}

// Adicionar colunas no INSERT
// ... INSERT ... (pose, landmarks, session_id) VALUES (..., $X::jsonb, $Y)
```

- [ ] **Step 2: Tests** — 5 novos casos:
- pose inválida → 400
- landmarks com 467 pts → 400 INVALID_LANDMARKS
- session_id de outro tenant → 400 INVALID_SESSION
- happy path com pose+landmarks+session_id → 201 + gravado
- backward compat: payload sem pose/landmarks → 201 (legacy)

- [ ] **Step 3: Run + commit**

```bash
cd apps/api && npm run test:unit
git add apps/api/src/routes/aesthetic-photos.js apps/api/tests/routes/aesthetic-photos.test.js
git commit -m "feat(aesthetic-v2): POST /aesthetic/photos aceita pose + landmarks + session_id"
```

---

### Task B4: Estender POST /aesthetic/analyses (tier + cost tier-aware)

**Files:**
- Modify: `apps/api/src/routes/aesthetic-analyses.js`
- Modify: `apps/api/src/services/aesthetic-analyses.js`

- [ ] **Step 1: Cost table tier-aware**

```javascript
// Topo do aesthetic-analyses.js:
const COST_TABLE = {
  facial: {
    standard: Number(process.env.AESTHETIC_FACIAL_COST || 5),
    advanced: Number(process.env.AESTHETIC_FACIAL_COST_ADVANCED || 10),
  },
  body_measurements: {
    standard: Number(process.env.AESTHETIC_BODY_COST || 5),
    advanced: Number(process.env.AESTHETIC_BODY_COST_ADVANCED || 10),
  },
};
function costFor(analysisType, tier = 'standard') {
  return COST_TABLE[analysisType]?.[tier] ?? COST_TABLE[analysisType]?.standard ?? 5;
}
```

- [ ] **Step 2: Aceitar tier + session_id no body do POST**

```javascript
const { analysis_type, subject_id, photo_ids, baseline_id, session_id, tier: rawTier } = request.body || {};
const tier = rawTier === 'advanced' ? 'advanced' : 'standard';

// Validações por tier
if (tier === 'advanced') {
  if (!session_id) {
    return reply.status(400).send({ error: 'SESSION_REQUIRED', message: 'tier=advanced exige session_id' });
  }
  const expectedCount = analysis_type === 'facial' ? 5 : 4;
  if (photo_ids.length !== expectedCount) {
    return reply.status(400).send({
      error: 'PHOTO_COUNT_MISMATCH',
      message: `tier=advanced para ${analysis_type} exige exatamente ${expectedCount} fotos`,
    });
  }
  // Validar que todas as photos têm pose + landmarks + pertencem à session
  const { rows } = await fastify.pg.query(`
    SELECT id, pose, landmarks, session_id FROM aesthetic_photos
    WHERE id = ANY($1::uuid[]) AND tenant_id = $2`, [photo_ids, tenantId]);
  if (rows.length !== photo_ids.length) {
    return reply.status(400).send({ error: 'PHOTOS_NOT_FOUND' });
  }
  if (rows.some(r => !r.pose || !r.landmarks || r.session_id !== session_id)) {
    return reply.status(400).send({ error: 'PHOTOS_INCOMPLETE_FOR_ADVANCED' });
  }
}

// Cost tier-aware
const cost = costFor(analysis_type, tier);
// kind tier-aware
const kind = tier === 'advanced'
  ? `aesthetic_${analysis_type}_analysis_advanced`
  : `aesthetic_${analysis_type}_analysis`;
```

- [ ] **Step 3: Estender createPending no service**

```javascript
// aesthetic-analyses.js service:
async function createPending(pg, { tenantId, subjectId, userId, analysisType, photoIds, baselineId, creditsCharged, sessionId, tier }) {
  return await withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(`
      INSERT INTO aesthetic_analyses
        (tenant_id, subject_id, user_id, analysis_type, photo_ids, baseline_analysis_id,
         credits_charged, status, session_id, tier)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9)
      RETURNING *`,
      [tenantId, subjectId, userId, analysisType, photoIds, baselineId || null,
       creditsCharged, sessionId || null, tier || 'standard']);
    return rows[0];
  }, { userId, channel: 'ui' });
}
```

- [ ] **Step 4: Passar tier pro worker via BullMQ**

```javascript
await enqueue({
  analysis_id: analysis.id,
  tenant_id: tenantId,
  subject_id, user_id: userId,
  analysis_type, photo_ids,
  baseline_analysis_id: baseline_id,
  professional_type: request.user.professional_type,
  tier, // NOVO
  session_id, // NOVO
});
```

- [ ] **Step 5: Tests** — 8 casos:
- tier=advanced sem session_id → 400 SESSION_REQUIRED
- tier=advanced com 3 fotos faciais → 400 PHOTO_COUNT_MISMATCH
- tier=advanced photo sem landmarks → 400 PHOTOS_INCOMPLETE_FOR_ADVANCED
- tier=advanced photo de outra session → 400 PHOTOS_INCOMPLETE_FOR_ADVANCED
- tier=advanced happy → 201, cost=10, kind=*_advanced
- tier=standard com 3 fotos avulsas → 201, cost=5, kind=*_analysis (backward compat)
- payload sem tier → tier='standard' default
- env override AESTHETIC_FACIAL_COST_ADVANCED=15 → cobra 15

- [ ] **Step 6: Run + commit**

```bash
cd apps/api && npm run test:unit
git add apps/api/src/routes/aesthetic-analyses.js apps/api/src/services/aesthetic-analyses.js apps/api/tests/routes/aesthetic-analyses.test.js
git commit -m "feat(aesthetic-v2): POST /aesthetic/analyses tier-aware (standard 5cr | advanced 10cr)"
```

---

### Task B5: Compare tier-gate

**Files:**
- Modify: `apps/api/src/routes/aesthetic-analyses.js` (endpoint /compare)

- [ ] **Step 1: Adicionar tier check em /compare**

```javascript
// No handler POST /analyses/:id/compare, ANTES de chamar getMetricsOnly:
const [baselineFull, currentFull] = await Promise.all([
  fastify.pg.query('SELECT tier FROM aesthetic_analyses WHERE id=$1 AND tenant_id=$2', [baseline_id, tenantId]),
  fastify.pg.query('SELECT tier FROM aesthetic_analyses WHERE id=$1 AND tenant_id=$2', [request.params.id, tenantId]),
]);
const bTier = baselineFull.rows[0]?.tier;
const cTier = currentFull.rows[0]?.tier;
if (!bTier || !cTier) {
  return reply.status(404).send({ error: 'Análise não encontrada' });
}
if (bTier !== cTier) {
  return reply.status(400).send({
    error: 'TIER_MISMATCH',
    message: `Compare exige análises do mesmo tier. Baseline=${bTier}, current=${cTier}.`,
    baseline_tier: bTier,
    current_tier: cTier,
  });
}
```

- [ ] **Step 2: Tests** — 3 casos:
- baseline=standard, current=advanced → 400 TIER_MISMATCH
- baseline=advanced, current=standard → 400 TIER_MISMATCH
- mesmo tier → 200 com deltas

- [ ] **Step 3: Run + commit**

```bash
cd apps/api && npm run test:unit
git add apps/api/src/routes/aesthetic-analyses.js apps/api/tests/routes/aesthetic-analyses.test.js
git commit -m "feat(aesthetic-v2): /analyses/:id/compare exige mesmo tier (TIER_MISMATCH)"
```

---

### Task B6: Integration test V2 end-to-end (Camada 2)

**Files:**
- Create: `apps/api/tests/integration/aesthetic-v2.integration.test.js`

- [ ] **Step 1: Test full flow**

```javascript
// apps/api/tests/integration/aesthetic-v2.integration.test.js
// Setup análogo a aesthetic-mutations.integration.test.js. Adicional:
// 1. POST /sessions com subject_id válido → 201
// 2. Inserir 5 fotos com pose + landmarks (POST /photos × 5)
// 3. POST /analyses { tier:'advanced', session_id, photo_ids: [5 ids] } → 201, cost=10
// 4. Validação cruzada: cost cobrado = 10, kind=aesthetic_facial_analysis_advanced
// 5. POST /analyses { tier:'advanced', session_id, photo_ids: [3 ids] } → 400 PHOTO_COUNT_MISMATCH
// 6. Pode opcionalmente forçar status=done via SQL e testar /compare tier mismatch
```

- [ ] **Step 2: Append em integration list do package.json + run**

```bash
cd apps/api && npm run test:integration
git add apps/api/tests/integration/aesthetic-v2.integration.test.js
git commit -m "test(aesthetic-v2): integration suite end-to-end tier=advanced + camada 2"
```

---

# Sub-fase V2-C — Frontend tier selector + captura facial

### Task C1: AestheticCaptureModule lazy + rota

**Files:**
- Create: `apps/web/src/app/features/aesthetic/capture/aesthetic-capture.routes.ts`
- Modify: `apps/web/src/app/app.routes.ts` (lazy load)

- [ ] **Step 1: Routes definition**

```typescript
// aesthetic-capture.routes.ts
import { Routes } from '@angular/router';

export const AESTHETIC_CAPTURE_ROUTES: Routes = [
  { path: 'facial',
    loadComponent: () => import('./capture-guide-facial.component')
      .then(m => m.CaptureGuideFacialComponent) },
  { path: 'body',
    loadComponent: () => import('./capture-guide-body.component')
      .then(m => m.CaptureGuideBodyComponent) },
];
```

- [ ] **Step 2: Lazy mount no app.routes.ts**

```typescript
{
  path: 'aesthetic/capture',
  canActivate: [authGuard, moduleGuard('estetica')],
  loadChildren: () => import('./features/aesthetic/capture/aesthetic-capture.routes')
    .then(m => m.AESTHETIC_CAPTURE_ROUTES),
},
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/features/aesthetic/capture/ apps/web/src/app/app.routes.ts
git commit -m "feat(aesthetic-v2): rotas lazy /aesthetic/capture/{facial,body}"
```

---

### Task C2: MediaPipeLoaderService (singleton, lazy WASM)

**Files:**
- Create: `apps/web/src/app/features/aesthetic/services/mediapipe-loader.service.ts`
- Create: `apps/web/src/app/features/aesthetic/services/mediapipe-loader.service.spec.ts`
- Modify: `apps/web/package.json` (dep `@mediapipe/tasks-vision`)

- [ ] **Step 1: Instalar dep**

```bash
cd apps/web && npm install --save @mediapipe/tasks-vision@^0.10.16
```

- [ ] **Step 2: Service**

```typescript
// mediapipe-loader.service.ts
import { Injectable, signal } from '@angular/core';
import type { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';

@Injectable({ providedIn: 'root' })
export class MediaPipeLoaderService {
  private faceLandmarker?: FaceLandmarker;
  private poseLandmarker?: PoseLandmarker;
  private loadingFace?: Promise<FaceLandmarker>;
  private loadingPose?: Promise<PoseLandmarker>;
  readonly version = '0.10.16';
  readonly loading = signal(false);

  async getFaceLandmarker(): Promise<FaceLandmarker> {
    if (this.faceLandmarker) return this.faceLandmarker;
    if (this.loadingFace) return this.loadingFace;
    this.loading.set(true);
    this.loadingFace = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.16/wasm'
      );
      const lm = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        outputFaceBlendshapes: false,
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      this.faceLandmarker = lm;
      this.loading.set(false);
      return lm;
    })();
    return this.loadingFace;
  }

  async getPoseLandmarker(): Promise<PoseLandmarker> {
    if (this.poseLandmarker) return this.poseLandmarker;
    if (this.loadingPose) return this.loadingPose;
    this.loading.set(true);
    this.loadingPose = (async () => {
      const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.16/wasm'
      );
      const lm = await PoseLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      this.poseLandmarker = lm;
      this.loading.set(false);
      return lm;
    })();
    return this.loadingPose;
  }
}
```

- [ ] **Step 3: Tests** — single-flight, retorna mesma instância em segunda call.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/aesthetic/services/mediapipe-loader.service.ts apps/web/src/app/features/aesthetic/services/mediapipe-loader.service.spec.ts apps/web/package.json apps/web/package-lock.json
git commit -m "feat(aesthetic-v2): MediaPipeLoaderService lazy singleton (face+pose)"
```

---

### Task C3: CaptureValidatorService (7 heurísticas faciais)

**Files:**
- Create: `apps/web/src/app/features/aesthetic/services/capture-validator.service.ts`
- Create: `apps/web/src/app/features/aesthetic/services/capture-validator.service.spec.ts`

- [ ] **Step 1: Service com cada heurística pura (testável)**

```typescript
import { Injectable } from '@angular/core';

export interface ValidationIssue {
  code: string;
  message: string;
  ok: boolean;
}

export interface FaceValidationResult {
  approved: boolean;
  score: number; // 0-1
  issues: ValidationIssue[];
}

@Injectable({ providedIn: 'root' })
export class CaptureValidatorService {
  // Pose helpers — yaw aproximado pela diferença horizontal entre olhos
  yawFromLandmarks(points: Array<{x:number; y:number; z:number}>): number {
    // MediaPipe Face Mesh indices: 33 left eye outer, 263 right eye outer
    const l = points[33]; const r = points[263];
    return Math.atan2(r.z - l.z, r.x - l.x); // radians
  }

  // EAR — eye aspect ratio
  eyeAspectRatio(points: Array<{x:number; y:number}>, eyeIndices: number[]): number {
    const v1 = Math.hypot(points[eyeIndices[1]].x - points[eyeIndices[5]].x,
                          points[eyeIndices[1]].y - points[eyeIndices[5]].y);
    const v2 = Math.hypot(points[eyeIndices[2]].x - points[eyeIndices[4]].x,
                          points[eyeIndices[2]].y - points[eyeIndices[4]].y);
    const h  = Math.hypot(points[eyeIndices[0]].x - points[eyeIndices[3]].x,
                          points[eyeIndices[0]].y - points[eyeIndices[3]].y);
    return (v1 + v2) / (2 * h);
  }

  // MAR — mouth aspect ratio
  mouthAspectRatio(points: Array<{x:number;y:number}>): number {
    // 13 upper lip center, 14 lower lip center, 78/308 mouth corners
    const v = Math.hypot(points[13].x - points[14].x, points[13].y - points[14].y);
    const h = Math.hypot(points[78].x - points[308].x, points[78].y - points[308].y);
    return v / h;
  }

  // Laplacian variance via canvas (foco)
  laplacianVariance(canvas: HTMLCanvasElement): number {
    const ctx = canvas.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Convert grayscale + Laplacian 3x3 kernel
    // ... (implementação Laplacian, ~30 linhas)
    return 0; // placeholder — implementação completa no arquivo final
  }

  // Histogram mean (exposição)
  histogramMean(canvas: HTMLCanvasElement): number {
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0; let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += (data[i] + data[i+1] + data[i+2]) / 3;
      count++;
    }
    return sum / count;
  }

  validateFace(
    landmarks: Array<{x:number;y:number;z:number}>,
    canvas: HTMLCanvasElement,
    expectedPose: 'frontal'|'profile_left'|'profile_right'|'45_left'|'45_right'
  ): FaceValidationResult {
    const issues: ValidationIssue[] = [];
    const yaw = this.yawFromLandmarks(landmarks);
    const yawDeg = Math.abs(yaw * 180 / Math.PI);

    // Pose check
    const poseOk = (() => {
      if (expectedPose === 'frontal') return yawDeg < 10;
      if (expectedPose.startsWith('profile')) return yawDeg > 60;
      if (expectedPose.startsWith('45')) return yawDeg >= 30 && yawDeg <= 50;
      return false;
    })();
    issues.push({ code: 'POSE', ok: poseOk,
      message: poseOk ? 'Pose OK' : `Ajuste a pose (${expectedPose})` });

    // EAR (olhos abertos) — indices ~ 33,160,158,133,153,144 (left eye)
    const leftEye = [33, 160, 158, 133, 153, 144];
    const ear = this.eyeAspectRatio(landmarks, leftEye);
    issues.push({ code: 'EYES_OPEN', ok: ear > 0.2,
      message: ear > 0.2 ? 'Olhos abertos' : 'Abra os olhos' });

    // MAR (boca fechada)
    const mar = this.mouthAspectRatio(landmarks);
    issues.push({ code: 'MOUTH_CLOSED', ok: mar < 0.5,
      message: mar < 0.5 ? 'Boca fechada' : 'Feche a boca' });

    // Centralização
    const cx = landmarks.reduce((s,p) => s+p.x, 0)/landmarks.length;
    const cy = landmarks.reduce((s,p) => s+p.y, 0)/landmarks.length;
    const centerOk = Math.abs(cx - 0.5) < 0.15 && Math.abs(cy - 0.5) < 0.15;
    issues.push({ code: 'CENTERED', ok: centerOk,
      message: centerOk ? 'Centralizado' : 'Centralize o rosto' });

    // Foco
    const focus = this.laplacianVariance(canvas);
    issues.push({ code: 'FOCUS', ok: focus > 100,
      message: focus > 100 ? 'Foco OK' : 'Foco insuficiente — segure firme' });

    // Iluminação
    const expo = this.histogramMean(canvas);
    issues.push({ code: 'EXPOSURE', ok: expo > 70 && expo < 180,
      message: (expo > 70 && expo < 180) ? 'Iluminação OK' : 'Ajuste a iluminação' });

    const okCount = issues.filter(i => i.ok).length;
    return {
      approved: okCount === issues.length,
      score: okCount / issues.length,
      issues,
    };
  }
}
```

- [ ] **Step 2: Specs** — isolar cada heurística: yaw frontal=0, perfil=90°, 45°; EAR olhos abertos vs fechados; MAR boca fechada vs aberta; canvas mock pra Laplacian e histogram; matriz pose ok/falha.

- [ ] **Step 3: Run + commit**

```bash
cd apps/web && npm test -- capture-validator
git add apps/web/src/app/features/aesthetic/services/capture-validator.service.ts apps/web/src/app/features/aesthetic/services/capture-validator.service.spec.ts
git commit -m "feat(aesthetic-v2): CaptureValidatorService com 7 heurísticas client-side"
```

---

### Task C4: TierSelectorComponent (2 cards)

**Files:**
- Create: `apps/web/src/app/features/aesthetic/components/tier-selector.component.ts`

- [ ] **Step 1: Component standalone**

```typescript
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-tier-selector',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    .tier-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
    .tier-card { border: 2px solid #e5e7eb; border-radius: 12px; padding: 1.5rem; cursor: pointer; transition: all .2s; }
    .tier-card:hover { border-color: #ec4899; transform: translateY(-2px); }
    .tier-card.advanced { border-color: #f59e0b; background: linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%); }
    .badge { display: inline-block; background: linear-gradient(90deg, #f59e0b, #dc2626); color: white; padding: 0.2rem 0.6rem; border-radius: 20px; font-size: 0.7rem; font-weight: 700; }
    .cost { font-size: 1.5rem; font-weight: 700; color: #ec4899; }
    .cost.advanced { color: #f59e0b; }
  `],
  template: `
    <div class="tier-grid">
      <div class="tier-card standard" (click)="select.emit('standard')">
        <h3>Análise Rápida 2D</h3>
        <ul>
          <li>1–3 fotos avulsas</li>
          <li>IA Visual (40+ métricas)</li>
          <li>Recomendador + PDF</li>
        </ul>
        <p class="cost">💎 {{ standardCost }} créditos</p>
        <button>Começar análise rápida</button>
      </div>
      <div class="tier-card advanced" (click)="select.emit('advanced')">
        <span class="badge">✨ PRECISÃO</span>
        <h3>Análise Avançada — Captura Guiada</h3>
        <ul>
          <li>5 fotos padronizadas com MediaPipe</li>
          <li>Landmarks + 10 métricas geométricas</li>
          <li>Comparação evolutiva válida</li>
          <li>Base para Pseudo-3D futuro</li>
        </ul>
        <p class="cost advanced">💎 {{ advancedCost }} créditos</p>
        <button>Começar análise avançada</button>
      </div>
    </div>
  `,
})
export class TierSelectorComponent {
  @Input() standardCost = 5;
  @Input() advancedCost = 10;
  @Output() select = new EventEmitter<'standard'|'advanced'>();
}
```

- [ ] **Step 2: Spec** — click emite tier correto.

- [ ] **Step 3: Integrar no facial-analysis-tab** existente — passa a renderizar TierSelectorComponent no step 'idle' antes do fluxo de upload atual.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/aesthetic/components/tier-selector.component.ts
git commit -m "feat(aesthetic-v2): TierSelectorComponent com 2 cards (standard 5cr | advanced 10cr)"
```

---

### Task C5: CaptureGuideFacialComponent (wizard 5 poses)

**Files:**
- Create: `apps/web/src/app/features/aesthetic/capture/capture-guide-facial.component.ts`
- Create: `apps/web/src/app/features/aesthetic/capture/capture-guide-facial.component.spec.ts`

- [ ] **Step 1: Component state machine (signals)**

```typescript
// State machine: tier_selected → camera_init → pose_<N> → uploading → ready_to_submit
// signals: currentPoseIndex, capturedPhotos[5], validationResult, mediapipeReady
// onCapture: snapshot canvas → upload S3 + POST /aesthetic/photos { pose, landmarks } → next pose
// onAllCaptured: POST /aesthetic/sessions → POST /aesthetic/analyses tier=advanced
```

(Implementação completa ~400 LOC; ver spec §4.2 + §6 para detalhe das heurísticas e UX)

- [ ] **Step 2: Tests** — state transitions, MediaPipe mockado.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/features/aesthetic/capture/capture-guide-facial.component.ts apps/web/src/app/features/aesthetic/capture/capture-guide-facial.component.spec.ts
git commit -m "feat(aesthetic-v2): CaptureGuideFacialComponent wizard 5 poses + MediaPipe live overlay"
```

---

### Task C6: Mobile sync + smoke test Android

**Files:**
- Modify: `apps/web/src/environments/environment.mobile.ts` (se houver flag relevante)

- [ ] **Step 1: Build mobile + sync**

```bash
cd apps/web
ng build --configuration=mobile
npx cap sync android
```

- [ ] **Step 2: Smoke test Android low-end**
- Abrir `/aesthetic/capture/facial` no APK
- MediaPipe carrega em <10s
- Preview live 15+ fps
- 5 poses capturadas sem travar
- Se travar: fallback "upload sem validação" funciona

- [ ] **Step 3: Commit sync**

```bash
git add android/
git commit -m "build(android): sync V2-C captura guiada facial"
```

---

# Sub-fase V2-D — Frontend captura corporal

### Task D1: CaptureGuideBodyComponent (4 poses)

**Files:**
- Create: `apps/web/src/app/features/aesthetic/capture/capture-guide-body.component.ts`

- [ ] **Step 1: Análogo a Facial, mas com PoseLandmarker (33 pts) e 4 poses**

Heurísticas corporais:
- `FULL_BODY_VISIBLE`: head (pt 0) e ankles (pt 27, 28) presentes com visibility > 0.5
- `POSTURE_NEUTRAL`: ângulo torso vs vertical < 5° (pts 11, 12, 23, 24)
- `FEET_ALIGNED`: |pt27.x - pt28.x| < 0.1 (proximidade horizontal)
- `ARMS_RELAXED`: ângulo cotovelo (13-11-23) > 150° (braço estendido)

- [ ] **Step 2: Spec + commit**

```bash
git add apps/web/src/app/features/aesthetic/capture/capture-guide-body.component.ts apps/web/src/app/features/aesthetic/capture/capture-guide-body.component.spec.ts
git commit -m "feat(aesthetic-v2): CaptureGuideBodyComponent wizard 4 poses corporais"
```

---

# Sub-fase V2-E — Worker landmarks-metrics agente

### Task E1: aesthetic-landmarks-metrics agente

**Files:**
- Create: `apps/worker/src/agents/aesthetic-landmarks-metrics.js`
- Create: `apps/worker/tests/agents/aesthetic-landmarks-metrics.test.js`

- [ ] **Step 1: Agente com 10 métricas**

```javascript
'use strict';

// Cada função recebe { photos } onde photos[i] = { pose, landmarks: { points: [...] } }
// Retorna { score: 0-100, value_raw, confidence: 'high'|'low', pose_used, source: 'mediapipe' }

function findPhoto(photos, poses) {
  const arr = Array.isArray(poses) ? poses : [poses];
  for (const p of arr) {
    const photo = photos.find(ph => ph.pose === p && ph.landmarks);
    if (photo) return photo;
  }
  return null;
}

function clamp01(n) { return Math.max(0, Math.min(1, n)); }
function clampScore(n) { return Math.max(0, Math.min(100, Math.round(n))); }

// Métrica 1: simetria horizontal — distância média de pontos espelhados
function symmetryHorizontal(photos) {
  const photo = findPhoto(photos, 'frontal');
  if (!photo) return null;
  const pts = photo.landmarks.points;
  // MediaPipe Face Mesh pairs simétricos (índices selecionados)
  const pairs = [
    [33, 263],   // outer eye corners
    [133, 362],  // inner eye corners
    [61, 291],   // mouth corners
    [205, 425],  // cheek points
    [127, 356],  // jaw outer
  ];
  let sumDist = 0;
  for (const [l, r] of pairs) {
    sumDist += Math.abs((pts[l].x - 0.5) + (pts[r].x - 0.5));
  }
  const avg = sumDist / pairs.length;
  // Quanto menor o desvio (avg), maior o score
  const score = clampScore(100 * (1 - avg / 0.05)); // avg > 5% = score 0
  return { score, value_raw: avg, confidence: 'high', pose_used: 'frontal', source: 'mediapipe' };
}

// Métrica 2: proportion_thirds — regra de ouro (testa/nariz/queixo)
function proportionThirds(photos) {
  const photo = findPhoto(photos, 'frontal');
  if (!photo) return null;
  const pts = photo.landmarks.points;
  // Hairline ~ pt 10, nose tip ~ pt 1, chin ~ pt 152
  const hairline = pts[10].y; const nose = pts[1].y; const chin = pts[152].y;
  const t1 = nose - hairline;
  const t2 = chin - nose;
  const ratio = t1 / t2; // ideal ~1.0
  const dev = Math.abs(ratio - 1);
  const score = clampScore(100 * (1 - dev / 0.3));
  return { score, value_raw: ratio, confidence: 'high', pose_used: 'frontal', source: 'mediapipe' };
}

// Métrica 3-4: mandibular angles (esquerdo e direito)
function mandibularAngle(photos, side) {
  const pose = side === 'left' ? ['45_left', 'profile_left'] : ['45_right', 'profile_right'];
  const photo = findPhoto(photos, pose);
  if (!photo) return null;
  const pts = photo.landmarks.points;
  // tragus ~ 234/454, gonion ~ 172/397, mento ~ 152
  const tragus = side === 'left' ? pts[234] : pts[454];
  const gonion = side === 'left' ? pts[172] : pts[397];
  const mento = pts[152];
  // Ângulo no gonion entre tragus e mento
  const v1 = { x: tragus.x - gonion.x, y: tragus.y - gonion.y };
  const v2 = { x: mento.x - gonion.x, y: mento.y - gonion.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m1 = Math.hypot(v1.x, v1.y); const m2 = Math.hypot(v2.x, v2.y);
  const angleRad = Math.acos(dot / (m1 * m2));
  const angleDeg = angleRad * 180 / Math.PI;
  // Ângulo ideal entre 110-130°
  const ideal = 120;
  const dev = Math.abs(angleDeg - ideal);
  const score = clampScore(100 * (1 - dev / 20));
  return { score, value_raw: angleDeg, confidence: 'high', pose_used: photo.pose, source: 'mediapipe' };
}

// Métrica 5: head tilt roll (frontal)
function headTiltRoll(photos) {
  const photo = findPhoto(photos, 'frontal');
  if (!photo) return null;
  const pts = photo.landmarks.points;
  const leftEye = pts[33]; const rightEye = pts[263];
  const rollRad = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  const rollDeg = Math.abs(rollRad * 180 / Math.PI);
  const score = clampScore(100 * (1 - rollDeg / 10));
  return { score, value_raw: rollDeg, confidence: 'high', pose_used: 'frontal', source: 'mediapipe' };
}

// Métrica 6: interocular distance (frontal, normalized)
function interocularDistance(photos) {
  const photo = findPhoto(photos, 'frontal');
  if (!photo) return null;
  const pts = photo.landmarks.points;
  const dx = pts[263].x - pts[33].x; const dy = pts[263].y - pts[33].y;
  const dist = Math.hypot(dx, dy); // normalizada 0-1
  // Não vira score 0-100 — só value_raw + score neutro 50 (não é "bom" ou "ruim")
  return { score: 50, value_raw: dist, confidence: 'high', pose_used: 'frontal', source: 'mediapipe' };
}

// Métricas corporais 7-10
function postureShoulderAsymmetry(photos) {
  const photo = findPhoto(photos, 'body_front');
  if (!photo) return null;
  const pts = photo.landmarks.points;
  // MediaPipe Pose: 11 left shoulder, 12 right shoulder
  const dy = Math.abs(pts[11].y - pts[12].y);
  const score = clampScore(100 * (1 - dy / 0.05));
  return { score, value_raw: dy, confidence: 'high', pose_used: 'body_front', source: 'mediapipe' };
}

function postureHipAsymmetry(photos) {
  const photo = findPhoto(photos, 'body_front');
  if (!photo) return null;
  const pts = photo.landmarks.points;
  // 23 left hip, 24 right hip
  const dy = Math.abs(pts[23].y - pts[24].y);
  const score = clampScore(100 * (1 - dy / 0.05));
  return { score, value_raw: dy, confidence: 'high', pose_used: 'body_front', source: 'mediapipe' };
}

function waistHipRatioVisual(photos) {
  const photo = findPhoto(photos, 'body_front');
  if (!photo) return null;
  const pts = photo.landmarks.points;
  // Aproximação: largura cintura ~ |11-12| na metade inferior dos ombros, quadril ~ |23-24|
  const shoulderW = Math.abs(pts[11].x - pts[12].x);
  const hipW = Math.abs(pts[23].x - pts[24].x);
  const ratio = shoulderW / hipW;
  return { score: 50, value_raw: ratio, confidence: 'low', pose_used: 'body_front', source: 'mediapipe' };
}

function postureAlignmentLateral(photos) {
  const photo = findPhoto(photos, ['body_lateral_left','body_lateral_right']);
  if (!photo) return null;
  const pts = photo.landmarks.points;
  // Coluna vertical: 0 (head) → 23/24 (hips). Calcula desvio horizontal.
  const head = pts[0]; const hipMid = { x: (pts[23].x + pts[24].x)/2, y: (pts[23].y + pts[24].y)/2 };
  const dx = Math.abs(head.x - hipMid.x);
  const score = clampScore(100 * (1 - dx / 0.08));
  return { score, value_raw: dx, confidence: 'high', pose_used: photo.pose, source: 'mediapipe' };
}

async function computeLandmarkMetrics({ photos, analysisType }) {
  const metrics = {};
  if (analysisType === 'facial') {
    const map = {
      symmetry_horizontal: symmetryHorizontal(photos),
      proportion_thirds: proportionThirds(photos),
      mandibular_angle_left: mandibularAngle(photos, 'left'),
      mandibular_angle_right: mandibularAngle(photos, 'right'),
      head_tilt_roll: headTiltRoll(photos),
      interocular_distance: interocularDistance(photos),
    };
    for (const [k, v] of Object.entries(map)) {
      if (v) metrics[k] = v;
    }
  } else {
    const map = {
      posture_shoulder_asymmetry: postureShoulderAsymmetry(photos),
      posture_hip_asymmetry: postureHipAsymmetry(photos),
      waist_hip_ratio_visual: waistHipRatioVisual(photos),
      posture_alignment_lateral: postureAlignmentLateral(photos),
    };
    for (const [k, v] of Object.entries(map)) {
      if (v) metrics[k] = v;
    }
  }
  return { metrics };
}

module.exports = { computeLandmarkMetrics };
```

- [ ] **Step 2: Tests com fixtures de landmarks**

Criar `apps/worker/tests/fixtures/face-landmarks-frontal.json` com 468 pts realistas (simétricos) + casos asimétricos. Testar cada métrica isoladamente + happy paths para facial e body.

- [ ] **Step 3: Commit**

```bash
cd apps/worker && npm test -- tests/agents/aesthetic-landmarks-metrics
git add apps/worker/src/agents/aesthetic-landmarks-metrics.js apps/worker/tests/agents/aesthetic-landmarks-metrics.test.js apps/worker/tests/fixtures/
git commit -m "feat(aesthetic-v2): worker agente aesthetic-landmarks-metrics (10 métricas geométricas)"
```

---

### Task E2: Integrar no processor (tier gate)

**Files:**
- Modify: `apps/worker/src/processors/aesthetic-analysis.js`

- [ ] **Step 1: Após Vision, antes do recommender, condicional ao tier**

```javascript
// Após analyzeFacial/analyzeBody:
let visionMetrics = visionResult.metrics;
let landmarkMetrics = {};

if (job.data.tier === 'advanced') {
  try {
    const { computeLandmarkMetrics } = require('../agents/aesthetic-landmarks-metrics');
    // Buscar photos com landmarks
    const { rows: photos } = await pool.query(
      `SELECT id, pose, landmarks FROM aesthetic_photos
       WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
      [job.data.photo_ids, job.data.tenant_id]
    );
    const result = await computeLandmarkMetrics({ photos, analysisType: job.data.analysis_type });
    landmarkMetrics = result.metrics;
  } catch (err) {
    // Falha do agente landmarks NÃO falha a análise — só loga
    logger.warn({ err }, 'aesthetic-landmarks-metrics failed; continuing without geometric metrics');
  }
}

const mergedMetrics = { ...visionMetrics, ...landmarkMetrics };
// resto do pipeline usa mergedMetrics
```

- [ ] **Step 2: Tests** — mock landmarks fixture, asserta merge.

- [ ] **Step 3: Commit**

```bash
cd apps/worker && npm test
git add apps/worker/src/processors/aesthetic-analysis.js apps/worker/tests/processors/aesthetic-analysis.test.js
git commit -m "feat(aesthetic-v2): processor invoca landmarks-metrics quando tier=advanced (graceful fail)"
```

---

# Sub-fase V2-F — Frontend resultado + comparação

### Task F1: photo-overlay extends — landmarks layer

**Files:**
- Modify: `apps/web/src/app/features/aesthetic/components/photo-overlay.component.ts`

- [ ] **Step 1: Aceitar input opcional `landmarks` + renderizar como camada SVG separada**

```typescript
readonly landmarks = input<Array<{x:number; y:number}> | null>(null);
readonly showLandmarks = input<boolean>(false);

// No template, adicionar bloco antes do </svg>:
@if (showLandmarks() && landmarks(); as pts) {
  <g class="landmarks-layer" fill="#22d3ee" opacity="0.7">
    @for (p of pts; track $index) {
      <circle [attr.cx]="p.x * photoW()" [attr.cy]="p.y * photoH()" r="2" />
    }
  </g>
}
```

- [ ] **Step 2: Spec** — afirma renderização condicional.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/features/aesthetic/components/photo-overlay.component.ts apps/web/src/app/features/aesthetic/components/photo-overlay.component.spec.ts
git commit -m "feat(aesthetic-v2): photo-overlay renderiza landmarks como SVG layer condicional"
```

---

### Task F2: analysis-result tier-aware

**Files:**
- Modify: `apps/web/src/app/features/aesthetic/components/analysis-result.component.ts`

- [ ] **Step 1: Renderizar badge tier + separar métricas Vision vs MediaPipe**

```typescript
// No header: chip "✨ AVANÇADA" se analysis.tier === 'advanced'
// Na lista de métricas: agrupar por source — 2 sections:
// "Análise Visual (IA)" — source !== 'mediapipe'
// "Geometria Facial/Corporal" — source === 'mediapipe' (com ícone 🎯)
```

- [ ] **Step 2: Toggle "Mostrar landmarks"** acende landmarks layer no photo-overlay.

- [ ] **Step 3: Spec + commit**

```bash
git add apps/web/src/app/features/aesthetic/components/analysis-result.component.ts apps/web/src/app/features/aesthetic/components/analysis-result.component.spec.ts
git commit -m "feat(aesthetic-v2): analysis-result tier-aware + split Vision vs Geometria"
```

---

### Task F3: Compare UI tier gate

**Files:**
- Modify: componente de comparação (dropdown baseline)

- [ ] **Step 1: Filtrar dropdown de baseline pelo tier da current analysis**

```typescript
// Ao listar baselines disponíveis no GET /analyses?subject_id=X
// filter no client: items.filter(a => a.tier === current.tier)
// Se TIER_MISMATCH vier do backend (race condition), exibir aviso amigável
```

- [ ] **Step 2: Spec + commit**

```bash
git add apps/web/src/app/features/aesthetic/components/
git commit -m "feat(aesthetic-v2): compare UI filtra baseline pelo mesmo tier"
```

---

### Task F4: PDF advanced section

**Files:**
- Modify: `apps/api/src/services/aesthetic-pdf-export.js`

- [ ] **Step 1: Adicionar seção condicional**

```javascript
// Em buildAnalysisPDF, após section de métricas:
if (analysis.tier === 'advanced') {
  const geomMetrics = Object.entries(metrics).filter(([_, v]) => v.source === 'mediapipe');
  if (geomMetrics.length > 0) {
    ensure(60);
    page.drawText('Métricas Geométricas (Análise Avançada)', { x: 40, y: cursor, size: 14, font: boldFont });
    cursor -= 20;
    for (const [name, data] of geomMetrics) {
      ensure(20);
      page.drawText(`${humanize(name)}: ${data.score}/100`, { x: 50, y: cursor, size: 10, font });
      cursor -= 14;
    }
  }
}
```

- [ ] **Step 2: Spec + commit**

```bash
cd apps/api && npm run test:unit
git add apps/api/src/services/aesthetic-pdf-export.js apps/api/tests/services/aesthetic-pdf-export.test.js
git commit -m "feat(aesthetic-v2): PDF inclui seção 'Métricas Geométricas' quando tier=advanced"
```

---

### Task F5: Mobile sync final + smoke test

- [ ] **Step 1: Build mobile final**

```bash
cd apps/web && ng build --configuration=mobile
npx cap sync android
git add android/
git commit -m "build(android): sync V2-F resultado + comparação"
```

---

# Checklist final de aceite

- [ ] 4 migrations aplicadas (099, 100, 101, 102) — Camada 2 verde
- [ ] Tier selector visível com 2 cards + custos corretos
- [ ] Captura facial: 5 poses validadas + uploaded com landmarks
- [ ] Captura corporal: 4 poses idem
- [ ] Worker: 6 métricas faciais geométricas + 4 corporais quando tier=advanced
- [ ] credit_ledger.kind = `aesthetic_*_advanced` em tier advanced
- [ ] Compare: TIER_MISMATCH em cross-tier
- [ ] PDF advanced inclui section geométrica
- [ ] Backward compat: fluxo standard (1-3 fotos) idêntico ao F1-F6
- [ ] Mobile Android low-end smoke verde
- [ ] +60 testes verdes no CI gate (Camada 1 + 2)
- [ ] Multi-módulo: human/vet inalterados (regression check)
- [ ] LGPD: consent reforçado + audit + purge job estendido
- [ ] PR final mergeado em main + deploy verde no GH Actions

---

# Estimativa de PRs / commits

| Sub-fase | Commits | PR único | Tempo |
|---|---|---|---|
| V2-A | 5 | PR-1 (schema + repos) | 1 dia |
| V2-B | 6 | PR-2 (routes tier-aware) | 2-3 dias |
| V2-C | 6 | PR-3 (captura facial) | 4-5 dias |
| V2-D | 1 | PR-4 (captura corporal) | 2-3 dias |
| V2-E | 2 | PR-5 (worker) | 2 dias |
| V2-F | 5 | PR-6 (resultado + compare + PDF) | 3-4 dias |

**Total estimado: 15-20 dias úteis (3-4 semanas).**

Cada PR passa por: smoke test local, CI gate verde (Camada 1+2), aprovação humana, merge ff-only, deploy GH Actions, mobile sync (V2-C/D/F).
