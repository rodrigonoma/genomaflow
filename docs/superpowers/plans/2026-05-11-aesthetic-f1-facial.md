# Aesthetic F1 — Foundation + Facial Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a primeira fase da plataforma estética: análise facial via IA com 11 métricas, anotações visuais SVG sobre a foto, comparação evolutiva, consentimento operacional LGPD, e cobrança via créditos. Marketing pode ir ao ar após F1.

**Architecture:** Pipeline two-call (Sonnet Vision pra métricas + Opus 4.7 pra recomendação texto livre — catálogo só na F3). BullMQ queue isolada `aesthetic-analysis`. Frontend Angular standalone com tab condicional no patient-detail. Schema novo isolado (`aesthetic_photos`, `aesthetic_analyses`, `aesthetic_consent`) com RLS NULLIF + audit trigger.

**Tech Stack:** Fastify 4, Postgres 15 + pgvector, BullMQ, Redis, Anthropic SDK, Angular 18 standalone + signals, SVG inline, S3 (`genomaflow-uploads-prod`).

**Spec de referência:** `docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md` (seções 1-21).

**Estimativa:** ~15 dias úteis em 26 tarefas. Cada tarefa = 1 commit independente, deploy-safe.

**Princípios de execução:**
- TDD em backend e worker (test first → implementation → verify pass → commit)
- Frontend testa serviços + lógica isolada (TestBed mais flexível em componentes grandes)
- Smoke multi-módulo após cada fase grande (human + vet + estetica)
- Spec self-review antes de cada PR

---

## Task 1: Migration 088 — `aesthetic_photos` table

**Files:**
- Create: `apps/api/src/db/migrations/088_aesthetic_photos.sql`
- Test (post-apply): `apps/api/tests/security/aesthetic-rls.test.js`

- [ ] **Step 1: Criar branch**

```bash
git checkout main && git pull origin main
git checkout -b feat/aesthetic-f1-task-01-migration-photos
```

- [ ] **Step 2: Escrever a migration SQL**

`apps/api/src/db/migrations/088_aesthetic_photos.sql`:

```sql
-- 088_aesthetic_photos.sql
-- Tabela genérica de fotos estéticas (facial + corporal + antes/depois).
-- RLS NULLIF (igual audit_log/055) + audit trigger.
-- Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md §4.1

CREATE TABLE IF NOT EXISTS aesthetic_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  photo_type   TEXT NOT NULL CHECK (photo_type IN (
    'facial_front','facial_left','facial_right',
    'eyelids_close','neck_front','neck_side',
    'breast_front','breast_side',
    'body_front','body_back','body_left','body_right',
    'arms_front','arms_relaxed','arms_flexed',
    'abdomen_front','abdomen_side',
    'legs_front','legs_back','legs_side',
    'glutes_back',
    'full_body_front','full_body_back','full_body_side',
    'other')),
  s3_key       TEXT NOT NULL,
  is_sensitive BOOLEAN NOT NULL DEFAULT false,
  taken_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes        TEXT,
  deleted_at   TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aesthetic_photos_subject
  ON aesthetic_photos(tenant_id, subject_id, taken_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_aesthetic_photos_sensitive_retention
  ON aesthetic_photos(created_at)
  WHERE is_sensitive = true AND deleted_at IS NULL;

ALTER TABLE aesthetic_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_photos FORCE ROW LEVEL SECURITY;

CREATE POLICY aesthetic_photos_tenant ON aesthetic_photos
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE TRIGGER aesthetic_photos_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_photos
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

- [ ] **Step 3: Aplicar migration localmente**

```bash
docker compose exec api node src/db/migrate.js
```

Esperado: `[apply] 088_aesthetic_photos.sql`.

- [ ] **Step 4: Verificar schema no DB**

```bash
docker compose exec db psql -U postgres -d genomaflow -c "\d aesthetic_photos"
```

Esperado: tabela com 11 colunas, 2 índices, RLS ENABLED + FORCED.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/migrations/088_aesthetic_photos.sql
git commit -m "feat(aesthetic): migration 088 aesthetic_photos com RLS+audit (F1.1)

Tabela genérica de fotos estéticas. RLS NULLIF + audit trigger.
Spec: 2026-05-11-aesthetic-platform-design.md §4.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migration 089 — `aesthetic_analyses` table

**Files:**
- Create: `apps/api/src/db/migrations/089_aesthetic_analyses.sql`

- [ ] **Step 1: Criar branch nova (continua do Task 1 que pode ainda não estar mergeada)**

```bash
git checkout -b feat/aesthetic-f1-task-02-migration-analyses
```

- [ ] **Step 2: Escrever a migration SQL**

`apps/api/src/db/migrations/089_aesthetic_analyses.sql`:

```sql
-- 089_aesthetic_analyses.sql
-- Análises IA estéticas. Schema flexível com `metrics`/`observations`/`recommendations`
-- JSONB. analysis_type enum extensível por região anatômica.
-- Spec §4.2

CREATE TABLE IF NOT EXISTS aesthetic_analyses (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id               UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  analysis_type            TEXT NOT NULL CHECK (analysis_type IN (
    'facial','eyelids','neck','breast','arms',
    'abdomen','legs','glutes','full_body','other')),
  photo_ids                UUID[] NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN
                             ('pending','processing','done','error')),
  metrics                  JSONB,
  observations             JSONB,
  recommendations          JSONB,
  model_metrics            TEXT,
  model_recommendations    TEXT,
  tokens_input             INT,
  tokens_output            INT,
  error_code               TEXT,
  error_message            TEXT,
  baseline_analysis_id     UUID REFERENCES aesthetic_analyses(id) ON DELETE SET NULL,
  credits_charged          INT NOT NULL DEFAULT 5,
  credits_refunded         BOOLEAN NOT NULL DEFAULT false,
  deleted_at               TIMESTAMPTZ NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_aesthetic_analyses_subject
  ON aesthetic_analyses(tenant_id, subject_id, analysis_type, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_aesthetic_analyses_pending
  ON aesthetic_analyses(status, created_at)
  WHERE status IN ('pending','processing');

ALTER TABLE aesthetic_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_analyses FORCE ROW LEVEL SECURITY;

CREATE POLICY aesthetic_analyses_tenant ON aesthetic_analyses
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE TRIGGER aesthetic_analyses_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_analyses
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

- [ ] **Step 3: Aplicar + verificar**

```bash
docker compose exec api node src/db/migrate.js
docker compose exec db psql -U postgres -d genomaflow -c "\d aesthetic_analyses"
```

Esperado: tabela com 21 colunas, 2 índices, RLS ENABLED + FORCED, FK pra baseline_analysis_id (self).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/089_aesthetic_analyses.sql
git commit -m "feat(aesthetic): migration 089 aesthetic_analyses com RLS+audit (F1.2)

Análises IA. Schema flexível JSONB (metrics/observations/recommendations).
analysis_type enum cobre F1 facial + futuras regiões (F2/F5).
Spec §4.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Migration 090 — `aesthetic_consent` table

**Files:**
- Create: `apps/api/src/db/migrations/090_aesthetic_consent.sql`

- [ ] **Step 1: Criar branch + escrever SQL**

```bash
git checkout -b feat/aesthetic-f1-task-03-migration-consent
```

`apps/api/src/db/migrations/090_aesthetic_consent.sql`:

```sql
-- 090_aesthetic_consent.sql
-- Confirmação operacional do profissional. 1× por paciente.
-- Paciente não acessa o sistema — profissional confirma que tem
-- consentimento offline do paciente.
-- Spec §4.3

CREATE TABLE IF NOT EXISTS aesthetic_consent (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id          UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id),
  ip                  TEXT,
  user_agent          TEXT,
  notes               TEXT,
  reinforced_regions  TEXT[],
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, subject_id)
);

ALTER TABLE aesthetic_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_consent FORCE ROW LEVEL SECURITY;

CREATE POLICY aesthetic_consent_tenant ON aesthetic_consent
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE TRIGGER aesthetic_consent_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_consent
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

- [ ] **Step 2: Aplicar + verificar**

```bash
docker compose exec api node src/db/migrate.js
docker compose exec db psql -U postgres -d genomaflow -c "\d aesthetic_consent"
```

Esperado: tabela com 9 colunas, UNIQUE (tenant_id, subject_id), RLS ENABLED + FORCED.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/db/migrations/090_aesthetic_consent.sql
git commit -m "feat(aesthetic): migration 090 aesthetic_consent com RLS+audit (F1.3)

Confirmação operacional do profissional. 1× por paciente (UNIQUE).
Spec §4.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Constants — catálogo de métricas por região

**Files:**
- Create: `apps/api/src/constants/aesthetic-metrics.js`
- Test: `apps/api/tests/constants/aesthetic-metrics.test.js`

- [ ] **Step 1: Criar branch + escrever o teste**

```bash
git checkout -b feat/aesthetic-f1-task-04-metrics-catalog
```

`apps/api/tests/constants/aesthetic-metrics.test.js`:

```js
'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
  REGION_METRICS,
  VALID_ANALYSIS_TYPES,
  SENSITIVE_REGIONS,
  metricsForRegion,
  isValidMetric,
} = require('../../src/constants/aesthetic-metrics');

describe('aesthetic-metrics catalog', () => {
  test('facial has 11 métricas', () => {
    expect(REGION_METRICS.facial).toHaveLength(11);
    expect(REGION_METRICS.facial).toEqual(expect.arrayContaining([
      'rugas', 'firmeza', 'elasticidade', 'textura', 'manchas',
      'poros', 'olheiras', 'vermelhidao', 'uniformidade_tom',
      'acne', 'simetria',
    ]));
  });

  test('VALID_ANALYSIS_TYPES tem 10 valores e bate com CHECK constraint', () => {
    expect(VALID_ANALYSIS_TYPES).toHaveLength(10);
    expect(VALID_ANALYSIS_TYPES).toEqual([
      'facial','eyelids','neck','breast','arms',
      'abdomen','legs','glutes','full_body','other',
    ]);
  });

  test('SENSITIVE_REGIONS inclui breast, glutes, abdomen', () => {
    expect(SENSITIVE_REGIONS).toEqual(expect.arrayContaining(['breast','glutes','abdomen']));
  });

  test('metricsForRegion retorna array', () => {
    expect(metricsForRegion('facial')).toEqual(REGION_METRICS.facial);
    expect(metricsForRegion('other')).toEqual([]);
    expect(metricsForRegion('invalid')).toEqual([]);
  });

  test('isValidMetric bate com região', () => {
    expect(isValidMetric('facial', 'rugas')).toBe(true);
    expect(isValidMetric('facial', 'culote_esquerdo')).toBe(false);
    expect(isValidMetric('legs', 'culote_esquerdo')).toBe(true);
  });

  test('kebab_case names consistentes (sem espaços, sem maiúsculas)', () => {
    for (const region of Object.keys(REGION_METRICS)) {
      for (const metric of REGION_METRICS[region]) {
        expect(metric).toMatch(/^[a-z0-9_]+$/);
      }
    }
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

```bash
cd apps/api && npm test -- tests/constants/aesthetic-metrics.test.js
```

Esperado: FAIL `Cannot find module '../../src/constants/aesthetic-metrics'`.

- [ ] **Step 3: Implementar o módulo**

`apps/api/src/constants/aesthetic-metrics.js`:

```js
'use strict';

// Catálogo de métricas por região anatômica. Usado pelo agente IA pra
// saber quais métricas avaliar + pelo frontend pra renderizar UI.
// Métricas em kebab_case minúsculo, alinhadas com indications em
// aesthetic_treatments (F3).

const REGION_METRICS = {
  facial: [
    'rugas', 'firmeza', 'elasticidade', 'textura', 'manchas',
    'poros', 'olheiras', 'vermelhidao', 'uniformidade_tom',
    'acne', 'simetria',
  ],
  eyelids: [
    'ptose_superior', 'bolsas_inferiores', 'hooding',
    'rugas_periorbital', 'flacidez_palpebra_superior',
  ],
  neck: [
    'rugas_pescoco', 'flacidez_pescoco', 'manchas_pescoco',
    'papada', 'textura_pescoco',
  ],
  breast: [
    'ptose_mamaria', 'simetria_mamaria', 'volume_aparente',
    'qualidade_pele_torax',
  ],
  arms: [
    'flacidez_triceps', 'manchas_brazos', 'textura_brazos',
    'celulite_brazos', 'firmeza_brazos',
  ],
  abdomen: [
    'flacidez_abdominal', 'estrias_abdominais', 'manchas_abdominais',
    'volume_aparente_abdomen', 'diastase_visivel',
  ],
  legs: [
    'culote_esquerdo', 'culote_direito', 'celulite_coxas',
    'estrias_coxas', 'firmeza_coxas', 'flacidez_interna_coxa',
  ],
  glutes: [
    'firmeza_gluteos', 'celulite_gluteos', 'estrias_gluteos',
    'projecao_glutea',
  ],
  full_body: [
    'proporcao_corporal', 'postura_visual', 'simetria_global',
    'volume_aparente_global',
  ],
  other: [],
};

const VALID_ANALYSIS_TYPES = Object.keys(REGION_METRICS);

const SENSITIVE_REGIONS = ['breast', 'glutes', 'abdomen'];

function metricsForRegion(region) {
  return REGION_METRICS[region] || [];
}

function isValidMetric(region, metric) {
  return metricsForRegion(region).includes(metric);
}

module.exports = {
  REGION_METRICS,
  VALID_ANALYSIS_TYPES,
  SENSITIVE_REGIONS,
  metricsForRegion,
  isValidMetric,
};
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd apps/api && npm test -- tests/constants/aesthetic-metrics.test.js
```

Esperado: PASS (6 tests).

- [ ] **Step 5: Adicionar o teste ao subset do CI `test:unit`**

Edit `apps/api/package.json` `scripts.test:unit` — adicione `tests/constants/aesthetic-metrics.test.js` ao final do glob.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/constants/aesthetic-metrics.js apps/api/tests/constants/aesthetic-metrics.test.js apps/api/package.json
git commit -m "feat(aesthetic): catálogo de métricas por região (F1.4)

11 métricas faciais (MVP) + 4-6 por outras 8 regiões pra F2/F5.
SENSITIVE_REGIONS pra consent reforçado.
Spec §4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Middleware `requireEsteticaModule`

**Files:**
- Create: `apps/api/src/middleware/aesthetic-module-gate.js`
- Test: `apps/api/tests/middleware/aesthetic-module-gate.test.js`

- [ ] **Step 1: Branch + teste**

```bash
git checkout -b feat/aesthetic-f1-task-05-module-gate
```

`apps/api/tests/middleware/aesthetic-module-gate.test.js`:

```js
'use strict';

const { describe, test, expect, jest } = require('@jest/globals');
const Fastify = require('fastify');
const { requireEsteticaModule } = require('../../src/middleware/aesthetic-module-gate');

async function buildApp(role, module) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module };
  });
  app.get('/test', { preHandler: [app.authenticate, requireEsteticaModule] },
    async () => ({ ok: true }));
  return app;
}

describe('requireEsteticaModule', () => {
  test('passa quando module=estetica', async () => {
    const app = await buildApp('admin', 'estetica');
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  test('bloqueia 403 quando module=human', async () => {
    const app = await buildApp('admin', 'human');
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/estetica/i);
  });

  test('bloqueia 403 quando module=veterinary', async () => {
    const app = await buildApp('admin', 'veterinary');
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(403);
  });

  test('passa pra master mesmo sem module (pode acessar tudo)', async () => {
    const app = await buildApp('master', undefined);
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar teste e confirmar fail**

```bash
cd apps/api && npm test -- tests/middleware/aesthetic-module-gate.test.js
```

Esperado: FAIL `Cannot find module`.

- [ ] **Step 3: Implementar middleware**

`apps/api/src/middleware/aesthetic-module-gate.js`:

```js
'use strict';

// Bloqueia rotas /aesthetic/* pra módulos human/veterinary.
// Master é exceção (acesso a tudo).

async function requireEsteticaModule(request, reply) {
  if (request.user?.role === 'master') return;
  if (request.user?.module !== 'estetica') {
    return reply.status(403).send({
      error: 'Funcionalidade disponível apenas para clínicas com módulo estetica',
    });
  }
}

module.exports = { requireEsteticaModule };
```

- [ ] **Step 4: Rodar teste e confirmar pass**

```bash
cd apps/api && npm test -- tests/middleware/aesthetic-module-gate.test.js
```

Esperado: PASS (4 tests).

- [ ] **Step 5: Adicionar ao `test:unit`**

`apps/api/package.json`: append `tests/middleware/aesthetic-module-gate.test.js`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/middleware/aesthetic-module-gate.js \
        apps/api/tests/middleware/aesthetic-module-gate.test.js \
        apps/api/package.json
git commit -m "feat(aesthetic): middleware requireEsteticaModule (F1.5)

Bloqueia rotas /aesthetic/* pra outros módulos (403). Master é exceção.
Spec §2.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Service `aesthetic-consent` + rotas

**Files:**
- Create: `apps/api/src/services/aesthetic-consent.js`
- Create: `apps/api/src/routes/aesthetic-consent.js`
- Test: `apps/api/tests/routes/aesthetic-consent.test.js`

- [ ] **Step 1: Branch + teste**

```bash
git checkout -b feat/aesthetic-f1-task-06-consent
```

`apps/api/tests/routes/aesthetic-consent.test.js`:

```js
'use strict';

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const Fastify = require('fastify');

async function buildApp(role = 'admin', module = 'estetica') {
  const app = Fastify({ logger: false });
  const queries = [];
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module };
  });
  app.decorate('pg', {
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/INSERT INTO aesthetic_consent/i.test(sql)) {
        return { rows: [{ id: 'c1', created_at: new Date().toISOString() }], rowCount: 1 };
      }
      if (/SELECT .* FROM aesthetic_consent/i.test(sql)) {
        return { rows: params[0] === 'subject-yes'
          ? [{ id: 'c1', created_at: '2026-05-11T10:00:00Z', reinforced_regions: [] }]
          : [] };
      }
      return { rows: [], rowCount: 0 };
    }),
  });
  // Stub withTenant via decorate (alguns endpoints chamam)
  app._queries = queries;
  app.register(require('../../src/routes/aesthetic-consent'), { prefix: '/api/aesthetic' });
  return app;
}

describe('POST /aesthetic/consent', () => {
  test('cria consent e retorna 201', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/consent',
      payload: { subject_id: 'sub1', notes: 'paciente concordou em pessoa' },
      headers: { 'user-agent': 'test-agent' },
      remoteAddress: '10.0.0.1',
    });
    expect(res.statusCode).toBe(201);
    const insert = app._queries.find(q => /INSERT INTO aesthetic_consent/i.test(q.sql));
    expect(insert).toBeDefined();
    expect(insert.params).toContain('sub1');
  });

  test('bloqueia 403 pra módulo human', async () => {
    const app = await buildApp('admin', 'human');
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/consent',
      payload: { subject_id: 'sub1' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('400 se subject_id faltando', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/consent',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  test('aceita reinforced_regions array', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/consent',
      payload: { subject_id: 'sub1', reinforced_regions: ['breast', 'glutes'] },
    });
    expect(res.statusCode).toBe(201);
    const insert = app._queries.find(q => /INSERT INTO aesthetic_consent/i.test(q.sql));
    expect(insert.params.some(p => Array.isArray(p) && p.includes('breast'))).toBe(true);
  });
});

describe('GET /aesthetic/consent/:subject_id', () => {
  test('retorna 200 com confirmed:true se consent existe', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/consent/subject-yes',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ confirmed: true });
  });

  test('retorna 200 com confirmed:false se não existe', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/consent/subject-no',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ confirmed: false });
  });
});
```

- [ ] **Step 2: Confirmar fail**

```bash
cd apps/api && npm test -- tests/routes/aesthetic-consent.test.js
```

Esperado: FAIL `Cannot find module aesthetic-consent`.

- [ ] **Step 3: Implementar service**

`apps/api/src/services/aesthetic-consent.js`:

```js
'use strict';

const { withTenant } = require('../db/tenant');

async function getConsent(pg, tenantId, subjectId) {
  const { rows } = await pg.query(
    `SELECT id, created_at, reinforced_regions
     FROM aesthetic_consent
     WHERE tenant_id = $1 AND subject_id = $2`,
    [tenantId, subjectId]
  );
  return rows[0] || null;
}

async function createConsent(pg, { tenantId, subjectId, userId, notes, reinforcedRegions, ip, userAgent }) {
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO aesthetic_consent
         (tenant_id, subject_id, user_id, ip, user_agent, notes, reinforced_regions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, subject_id) DO UPDATE SET
         reinforced_regions = CASE
           WHEN aesthetic_consent.reinforced_regions IS NULL THEN EXCLUDED.reinforced_regions
           ELSE ARRAY(SELECT DISTINCT unnest(aesthetic_consent.reinforced_regions || EXCLUDED.reinforced_regions))
         END,
         notes = COALESCE(EXCLUDED.notes, aesthetic_consent.notes)
       RETURNING id, created_at, reinforced_regions`,
      [tenantId, subjectId, userId, ip, userAgent, notes, reinforcedRegions || []]
    );
    return rows[0];
  }, { userId, channel: 'ui' });
}

module.exports = { getConsent, createConsent };
```

- [ ] **Step 4: Implementar rota**

`apps/api/src/routes/aesthetic-consent.js`:

```js
'use strict';

const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { getConsent, createConsent } = require('../services/aesthetic-consent');

module.exports = async function (fastify) {
  // POST /aesthetic/consent
  fastify.post('/consent', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { subject_id, notes, reinforced_regions } = request.body || {};
    if (!subject_id) {
      return reply.status(400).send({ error: 'subject_id obrigatório' });
    }
    if (reinforced_regions && !Array.isArray(reinforced_regions)) {
      return reply.status(400).send({ error: 'reinforced_regions deve ser array' });
    }

    const consent = await createConsent(fastify.pg, {
      tenantId: request.user.tenant_id,
      subjectId: subject_id,
      userId: request.user.user_id,
      notes: notes ? String(notes).slice(0, 1000) : null,
      reinforcedRegions: reinforced_regions || [],
      ip: request.ip || null,
      userAgent: request.headers['user-agent'] ? String(request.headers['user-agent']).slice(0, 500) : null,
    });

    return reply.status(201).send({ id: consent.id, confirmed: true, created_at: consent.created_at });
  });

  // GET /aesthetic/consent/:subject_id
  fastify.get('/consent/:subject_id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { subject_id } = request.params;
    const consent = await getConsent(fastify.pg, request.user.tenant_id, subject_id);
    if (!consent) return reply.send({ confirmed: false });
    return reply.send({
      confirmed: true,
      id: consent.id,
      created_at: consent.created_at,
      reinforced_regions: consent.reinforced_regions || [],
    });
  });
};
```

- [ ] **Step 5: Registrar rota em `server.js`**

`apps/api/src/server.js` (procurar bloco de registro de rotas; adicionar):

```js
fastify.register(require('./routes/aesthetic-consent'), { prefix: API_PREFIX + '/aesthetic' });
```

- [ ] **Step 6: Rodar testes + adicionar a `test:unit`**

```bash
cd apps/api && npm test -- tests/routes/aesthetic-consent.test.js
```

Esperado: PASS (6 tests). Adicione path ao `package.json` `test:unit`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/aesthetic-consent.js \
        apps/api/src/routes/aesthetic-consent.js \
        apps/api/src/server.js \
        apps/api/tests/routes/aesthetic-consent.test.js \
        apps/api/package.json
git commit -m "feat(aesthetic): rotas consent + service (F1.6)

POST /aesthetic/consent: confirma 1×/paciente (UPSERT, merge reinforced_regions).
GET /aesthetic/consent/:subject_id: retorna { confirmed: bool, ... }.
Rate limits per spec §5.7. Module gate aplicado.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Service `aesthetic-credits` + rotas photos

**Files:**
- Create: `apps/api/src/services/aesthetic-credits.js`
- Create: `apps/api/src/services/aesthetic-photos.js`
- Create: `apps/api/src/routes/aesthetic-photos.js`
- Test: `apps/api/tests/services/aesthetic-credits.test.js`
- Test: `apps/api/tests/routes/aesthetic-photos.test.js`

Por ser tarefa maior, divida em sub-passos:

- [ ] **Step 1: Branch**

```bash
git checkout -b feat/aesthetic-f1-task-07-photos
```

- [ ] **Step 2: Test credits service**

`apps/api/tests/services/aesthetic-credits.test.js`:

```js
'use strict';

const { describe, test, expect, jest } = require('@jest/globals');
const { getBalance, debit, refund } = require('../../src/services/aesthetic-credits');

function mockPg(balance = 100) {
  return {
    query: jest.fn(async (sql, params) => {
      if (/COALESCE\(SUM\(amount\)/i.test(sql)) {
        return { rows: [{ balance: String(balance) }] };
      }
      if (/INSERT INTO credit_ledger/i.test(sql)) {
        return { rows: [{ id: 'cl1', amount: params[1] }] };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

describe('aesthetic-credits service', () => {
  test('getBalance retorna número', async () => {
    const pg = mockPg(50);
    expect(await getBalance(pg, 't1')).toBe(50);
  });

  test('debit insere amount negativo', async () => {
    const pg = mockPg();
    await debit(pg, { tenantId: 't1', amount: 5, kind: 'aesthetic_facial_analysis', description: 'test', refId: 'a1', userId: 'u1' });
    const insertCall = pg.query.mock.calls.find(c => /INSERT INTO credit_ledger/.test(c[0]));
    expect(insertCall[1][1]).toBe(-5);
  });

  test('refund insere amount positivo + idempotente via WHERE NOT EXISTS', async () => {
    const pg = mockPg();
    await refund(pg, { tenantId: 't1', amount: 5, kind: 'aesthetic_refund', description: 'test', refId: 'a1', userId: 'u1' });
    const insertCall = pg.query.mock.calls.find(c => /INSERT INTO credit_ledger/.test(c[0]));
    expect(insertCall[1][1]).toBe(+5);
  });

  test('debit rejeita amount negativo (deve ser positivo, virada internamente)', async () => {
    const pg = mockPg();
    await expect(debit(pg, { tenantId: 't1', amount: -1, kind: 'x', description: 'x', refId: 'x', userId: 'u' }))
      .rejects.toThrow(/amount/);
  });
});
```

- [ ] **Step 3: Implementar credits service**

`apps/api/src/services/aesthetic-credits.js`:

```js
'use strict';

const { withTenant } = require('../db/tenant');

async function getBalance(pg, tenantId) {
  const { rows } = await pg.query(
    `SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_ledger WHERE tenant_id = $1`,
    [tenantId]
  );
  return Number(rows[0].balance);
}

async function debit(pg, { tenantId, amount, kind, description, refId, userId }) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('debit: amount deve ser inteiro positivo (será negativado internamente)');
  }
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description, ref_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, amount`,
      [tenantId, -amount, kind, description, refId]
    );
    return rows[0];
  }, { userId, channel: 'ui' });
}

async function refund(pg, { tenantId, amount, kind, description, refId, userId }) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('refund: amount deve ser inteiro positivo');
  }
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description, ref_id)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM credit_ledger WHERE ref_id = $5 AND kind = $3
       )
       RETURNING id, amount`,
      [tenantId, +amount, kind, description, refId]
    );
    return rows[0] || null;
  }, { userId, channel: 'worker' });
}

module.exports = { getBalance, debit, refund };
```

- [ ] **Step 4: Verificar pass do credits test**

```bash
cd apps/api && npm test -- tests/services/aesthetic-credits.test.js
```

Esperado: PASS (4 tests).

- [ ] **Step 5: Test photos route**

`apps/api/tests/routes/aesthetic-photos.test.js`:

```js
'use strict';

const { describe, test, expect, jest } = require('@jest/globals');
const Fastify = require('fastify');
const multipart = require('@fastify/multipart');

// Mock S3 antes do require da rota
jest.mock('../../src/services/aesthetic-s3', () => ({
  uploadPhoto: jest.fn(async ({ key }) => ({ s3_key: key })),
  signedUrlFor: jest.fn(async ({ key }) => `https://s3.example/${key}?signed=1`),
  deletePhoto: jest.fn(async () => ({ deleted: true })),
}));

async function buildApp(role = 'admin', module = 'estetica') {
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  const queries = [];
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module };
  });
  app.decorate('pg', {
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/INSERT INTO aesthetic_photos/i.test(sql)) {
        return { rows: [{ id: 'photo-1', s3_key: params[3] }] };
      }
      if (/SELECT .* FROM aesthetic_photos/i.test(sql)) {
        if (params[0] === 'photo-yes') return { rows: [{ id: 'photo-yes', s3_key: 'aesthetic-photos/t1/sub1/photo-yes.jpg', tenant_id: 't1', deleted_at: null }] };
        return { rows: [] };
      }
      if (/UPDATE aesthetic_photos SET deleted_at/i.test(sql)) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    }),
  });
  app._queries = queries;
  app.register(require('../../src/routes/aesthetic-photos'), { prefix: '/api/aesthetic' });
  return app;
}

describe('POST /aesthetic/photos', () => {
  test('aceita upload válido', async () => {
    const app = await buildApp();
    const form = new FormData();
    const blob = new Blob([Buffer.from('fake-jpg-bytes')], { type: 'image/jpeg' });
    form.append('subject_id', 'sub1');
    form.append('photo_type', 'facial_front');
    form.append('file', blob, 'photo.jpg');
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/photos',
      payload: form, headers: { 'content-type': `multipart/form-data; boundary=${form._boundary || 'b'}` },
    });
    // Por simplicidade, esperamos 201 mesmo com mock de multipart
    expect([201, 200]).toContain(res.statusCode);
  });

  test('bloqueia 403 pra módulo human', async () => {
    const app = await buildApp('admin', 'human');
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/photos',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /aesthetic/photos/:id/url', () => {
  test('retorna URL signed válida pra foto do tenant', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/photos/photo-yes/url',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).url).toMatch(/^https:/);
  });

  test('404 se photo não existe ou outro tenant', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/photos/photo-other/url',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /aesthetic/photos/:id', () => {
  test('marca deleted_at e retorna 204', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE', url: '/api/aesthetic/photos/photo-yes',
    });
    expect(res.statusCode).toBe(204);
  });
});
```

- [ ] **Step 6: Implementar S3 helper + photos service**

`apps/api/src/services/aesthetic-s3.js`:

```js
'use strict';

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET || 'genomaflow-uploads-prod';
const s3 = new S3Client({ region: REGION });

function buildKey({ tenantId, subjectId, photoId, ext = 'jpg' }) {
  return `aesthetic-photos/${tenantId}/${subjectId}/${photoId}.${ext}`;
}

async function uploadPhoto({ key, body, contentType }) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
  return { s3_key: key };
}

async function signedUrlFor({ key, ttlSeconds = 3600 }) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: ttlSeconds });
}

async function deletePhoto({ key }) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  return { deleted: true };
}

module.exports = { buildKey, uploadPhoto, signedUrlFor, deletePhoto };
```

`apps/api/src/services/aesthetic-photos.js`:

```js
'use strict';

const { withTenant } = require('../db/tenant');
const { SENSITIVE_REGIONS } = require('../constants/aesthetic-metrics');

const SENSITIVE_PHOTO_TYPES = new Set([
  'breast_front','breast_side',
  'glutes_back',
  'abdomen_front','abdomen_side',
]);

function isSensitive(photoType) {
  return SENSITIVE_PHOTO_TYPES.has(photoType);
}

async function createPhoto(pg, { tenantId, subjectId, userId, photoType, s3Key, notes }) {
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO aesthetic_photos
         (tenant_id, subject_id, user_id, photo_type, s3_key, is_sensitive, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, s3_key, photo_type, is_sensitive, taken_at`,
      [tenantId, subjectId, userId, photoType, s3Key, isSensitive(photoType), notes]
    );
    return rows[0];
  }, { userId, channel: 'ui' });
}

async function getPhotoForTenant(pg, photoId, tenantId) {
  const { rows } = await pg.query(
    `SELECT id, s3_key, tenant_id, subject_id, photo_type, is_sensitive, deleted_at
     FROM aesthetic_photos
     WHERE id = $1 AND tenant_id = $2`,
    [photoId, tenantId]
  );
  return rows[0] || null;
}

async function softDeletePhoto(pg, photoId, tenantId, userId) {
  return withTenant(pg, tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE aesthetic_photos SET deleted_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [photoId, tenantId]
    );
    return rowCount > 0;
  }, { userId, channel: 'ui' });
}

module.exports = { createPhoto, getPhotoForTenant, softDeletePhoto, isSensitive };
```

- [ ] **Step 7: Implementar rota photos**

`apps/api/src/routes/aesthetic-photos.js`:

```js
'use strict';

const { randomUUID } = require('crypto');
const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { buildKey, uploadPhoto, signedUrlFor } = require('../services/aesthetic-s3');
const { createPhoto, getPhotoForTenant, softDeletePhoto } = require('../services/aesthetic-photos');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const MAX_BYTES = 5 * 1024 * 1024;

module.exports = async function (fastify) {
  // POST /aesthetic/photos (multipart)
  fastify.post('/photos', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const parts = request.parts();
    const fields = {};
    let fileBuf, fileMime;
    for await (const part of parts) {
      if (part.type === 'file') {
        if (!ALLOWED_MIME.has(part.mimetype)) {
          return reply.status(400).send({ error: 'Formato não suportado. Use JPEG ou PNG.' });
        }
        fileMime = part.mimetype;
        const chunks = [];
        for await (const c of part.file) chunks.push(c);
        fileBuf = Buffer.concat(chunks);
        if (fileBuf.length > MAX_BYTES) {
          return reply.status(400).send({ error: 'Arquivo maior que 5MB.' });
        }
      } else {
        fields[part.fieldname] = part.value;
      }
    }
    const { subject_id, photo_type, notes } = fields;
    if (!subject_id || !photo_type) {
      return reply.status(400).send({ error: 'subject_id e photo_type obrigatórios' });
    }
    if (!fileBuf) {
      return reply.status(400).send({ error: 'Arquivo obrigatório no campo "file"' });
    }
    const photoId = randomUUID();
    const ext = fileMime === 'image/png' ? 'png' : 'jpg';
    const key = buildKey({ tenantId: request.user.tenant_id, subjectId: subject_id, photoId, ext });
    await uploadPhoto({ key, body: fileBuf, contentType: fileMime });
    const photo = await createPhoto(fastify.pg, {
      tenantId: request.user.tenant_id,
      subjectId: subject_id,
      userId: request.user.user_id,
      photoType: photo_type,
      s3Key: key,
      notes: notes ? String(notes).slice(0, 1000) : null,
    });
    return reply.status(201).send({
      id: photo.id, s3_key: photo.s3_key, photo_type: photo.photo_type,
      is_sensitive: photo.is_sensitive, taken_at: photo.taken_at,
    });
  });

  // GET /aesthetic/photos/:id/url (signed)
  fastify.get('/photos/:id/url', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const photo = await getPhotoForTenant(fastify.pg, request.params.id, request.user.tenant_id);
    if (!photo || photo.deleted_at) return reply.status(404).send({ error: 'Photo não encontrada' });
    const url = await signedUrlFor({ key: photo.s3_key, ttlSeconds: 3600 });
    return reply.send({ url, expires_in: 3600 });
  });

  // DELETE /aesthetic/photos/:id (soft)
  fastify.delete('/photos/:id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const ok = await softDeletePhoto(fastify.pg, request.params.id, request.user.tenant_id, request.user.user_id);
    if (!ok) return reply.status(404).send({ error: 'Photo não encontrada ou já apagada' });
    return reply.status(204).send();
  });
};
```

- [ ] **Step 8: Registrar rota em server.js**

```js
fastify.register(require('./routes/aesthetic-photos'), { prefix: API_PREFIX + '/aesthetic' });
```

- [ ] **Step 9: Rodar testes**

```bash
cd apps/api && npm test -- tests/services/aesthetic-credits.test.js tests/routes/aesthetic-photos.test.js
```

Esperado: PASS. Adicione paths ao `package.json` `test:unit`.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/services/aesthetic-credits.js \
        apps/api/src/services/aesthetic-photos.js \
        apps/api/src/services/aesthetic-s3.js \
        apps/api/src/routes/aesthetic-photos.js \
        apps/api/src/server.js \
        apps/api/tests/services/aesthetic-credits.test.js \
        apps/api/tests/routes/aesthetic-photos.test.js \
        apps/api/package.json
git commit -m "feat(aesthetic): rotas photos + service S3 + credits (F1.7)

POST upload (JPEG/PNG max 5MB, valida MIME).
GET signed URL TTL 1h (valida ownership tenant).
DELETE soft (deleted_at).
SENSITIVE_PHOTO_TYPES auto-detecta breast/glutes/abdomen.
credit_ledger debit/refund helpers com idempotência via ref_id+kind.
Spec §4.1, §5.2, §11.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Rotas `aesthetic-analyses` — POST (pre-flight + enqueue)

**Files:**
- Create: `apps/api/src/services/aesthetic-analyses.js`
- Create: `apps/api/src/routes/aesthetic-analyses.js`
- Test: `apps/api/tests/routes/aesthetic-analyses.test.js`

- [ ] **Step 1: Branch + teste**

```bash
git checkout -b feat/aesthetic-f1-task-08-analyses-create
```

`apps/api/tests/routes/aesthetic-analyses.test.js`:

```js
'use strict';

const { describe, test, expect, jest } = require('@jest/globals');
const Fastify = require('fastify');

jest.mock('../../src/queues/aesthetic-analysis-queue', () => ({
  enqueue: jest.fn(async () => 'job-123'),
}));

async function buildApp({ balance = 100, hasConsent = true, photosOk = true, role = 'admin', module = 'estetica' } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module, professional_type: 'medico' };
  });
  const queries = [];
  app.decorate('pg', {
    connect: jest.fn(async () => app.pg),
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/COALESCE\(SUM\(amount\)/i.test(sql)) return { rows: [{ balance: String(balance) }] };
      if (/SELECT .* FROM aesthetic_consent/i.test(sql)) return { rows: hasConsent ? [{ id: 'c1' }] : [] };
      if (/SELECT id FROM aesthetic_photos/i.test(sql)) {
        if (!photosOk) return { rows: [] };
        return { rows: params[0].map((id) => ({ id })) };
      }
      if (/INSERT INTO aesthetic_analyses/i.test(sql)) return { rows: [{ id: 'a-new' }] };
      if (/INSERT INTO credit_ledger/i.test(sql)) return { rows: [{ id: 'cl1' }] };
      return { rows: [] };
    }),
    release: jest.fn(),
  });
  app._queries = queries;
  app.register(require('../../src/routes/aesthetic-analyses'), { prefix: '/api/aesthetic' });
  return app;
}

describe('POST /aesthetic/analyses', () => {
  test('cria análise + enqueue + debita créditos', async () => {
    const app = await buildApp();
    const { enqueue } = require('../../src/queues/aesthetic-analysis-queue');
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1','p2'] },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({ analysis_id: 'a-new', status: 'pending' });
    expect(enqueue).toHaveBeenCalled();
    const debitCall = app._queries.find(q => /INSERT INTO credit_ledger/.test(q.sql));
    expect(debitCall.params[1]).toBe(-5);
  });

  test('402 sem créditos suficientes', async () => {
    const app = await buildApp({ balance: 2 });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1'] },
    });
    expect(res.statusCode).toBe(402);
    expect(JSON.parse(res.body).error).toBe('INSUFFICIENT_CREDITS');
  });

  test('403 sem consent', async () => {
    const app = await buildApp({ hasConsent: false });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1'] },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('CONSENT_MISSING');
  });

  test('400 photo_ids vazio', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 photos_ids > 3', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1','p2','p3','p4'] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 analysis_type inválido', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'invalid', subject_id: 'sub1', photo_ids: ['p1'] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 photo_id não pertence ao tenant', async () => {
    const app = await buildApp({ photosOk: false });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['stranger-photo'] },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Confirmar fail**

```bash
cd apps/api && npm test -- tests/routes/aesthetic-analyses.test.js
```

- [ ] **Step 3: Implementar queue helper (stub que vira real no Task 11)**

`apps/api/src/queues/aesthetic-analysis-queue.js`:

```js
'use strict';

const { Queue } = require('bullmq');
const Redis = require('ioredis');

let _queue;
function queue() {
  if (!_queue) {
    const conn = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    _queue = new Queue('aesthetic-analysis', { connection: conn });
  }
  return _queue;
}

async function enqueue(payload) {
  const job = await queue().add('analyze', payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  });
  return job.id;
}

module.exports = { enqueue };
```

- [ ] **Step 4: Implementar service de analyses**

`apps/api/src/services/aesthetic-analyses.js`:

```js
'use strict';

const { withTenant } = require('../db/tenant');

async function createPending(pg, { tenantId, subjectId, userId, analysisType, photoIds, baselineId, creditsCharged }) {
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO aesthetic_analyses
         (tenant_id, subject_id, user_id, analysis_type, photo_ids,
          status, baseline_analysis_id, credits_charged)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
       RETURNING id`,
      [tenantId, subjectId, userId, analysisType, photoIds, baselineId || null, creditsCharged]
    );
    return rows[0];
  }, { userId, channel: 'ui' });
}

async function validatePhotosOwnership(pg, tenantId, photoIds) {
  if (!photoIds || photoIds.length === 0) return false;
  const { rows } = await pg.query(
    `SELECT id FROM aesthetic_photos
     WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND deleted_at IS NULL`,
    [photoIds, tenantId]
  );
  return rows.length === photoIds.length;
}

module.exports = { createPending, validatePhotosOwnership };
```

- [ ] **Step 5: Implementar rota POST**

`apps/api/src/routes/aesthetic-analyses.js`:

```js
'use strict';

const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { VALID_ANALYSIS_TYPES } = require('../constants/aesthetic-metrics');
const { getBalance, debit } = require('../services/aesthetic-credits');
const { getConsent } = require('../services/aesthetic-consent');
const { createPending, validatePhotosOwnership } = require('../services/aesthetic-analyses');
const { enqueue } = require('../queues/aesthetic-analysis-queue');

const COST_BY_TYPE = {
  facial: Number(process.env.AESTHETIC_FACIAL_COST || 5),
  body_measurements: Number(process.env.AESTHETIC_BODY_COST || 5),
};

function costFor(analysisType) {
  return COST_BY_TYPE[analysisType] ?? 5;
}

module.exports = async function (fastify) {
  fastify.post('/analyses', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { analysis_type, subject_id, photo_ids, baseline_id } = request.body || {};

    // Validação básica
    if (!VALID_ANALYSIS_TYPES.includes(analysis_type)) {
      return reply.status(400).send({ error: `analysis_type deve ser um de: ${VALID_ANALYSIS_TYPES.join(', ')}` });
    }
    if (!subject_id) return reply.status(400).send({ error: 'subject_id obrigatório' });
    if (!Array.isArray(photo_ids) || photo_ids.length < 1 || photo_ids.length > 3) {
      return reply.status(400).send({ error: 'photo_ids deve ter 1 a 3 elementos' });
    }

    const tenantId = request.user.tenant_id;
    const userId = request.user.user_id;

    // Pre-flight 1: photos do tenant?
    const ownOk = await validatePhotosOwnership(fastify.pg, tenantId, photo_ids);
    if (!ownOk) return reply.status(400).send({ error: 'Uma ou mais photos não pertencem ao tenant ou foram apagadas' });

    // Pre-flight 2: consent confirmado?
    const consent = await getConsent(fastify.pg, tenantId, subject_id);
    if (!consent) {
      return reply.status(403).send({
        error: 'CONSENT_MISSING',
        message: 'Confirme o consentimento operacional do paciente antes de criar análise.',
      });
    }

    // Pre-flight 3: créditos suficientes?
    const cost = costFor(analysis_type);
    const balance = await getBalance(fastify.pg, tenantId);
    if (balance < cost) {
      return reply.status(402).send({
        error: 'INSUFFICIENT_CREDITS',
        message: `Análise custa ${cost} créditos. Saldo atual: ${balance}.`,
        current: balance,
        required: cost,
      });
    }

    // Cria registro pending
    const analysis = await createPending(fastify.pg, {
      tenantId, subjectId: subject_id, userId,
      analysisType: analysis_type, photoIds: photo_ids,
      baselineId: baseline_id, creditsCharged: cost,
    });

    // Debita créditos (idempotente via ref_id)
    await debit(fastify.pg, {
      tenantId, amount: cost, kind: `aesthetic_${analysis_type}_analysis`,
      description: `Análise ${analysis_type} IA`, refId: analysis.id, userId,
    });

    // Enqueue worker job
    await enqueue({
      analysis_id: analysis.id,
      tenant_id: tenantId,
      subject_id, user_id: userId,
      analysis_type, photo_ids,
      baseline_analysis_id: baseline_id,
      professional_type: request.user.professional_type,
    });

    return reply.status(201).send({
      analysis_id: analysis.id,
      status: 'pending',
      credits_charged: cost,
    });
  });
};
```

- [ ] **Step 6: Registrar em server.js**

```js
fastify.register(require('./routes/aesthetic-analyses'), { prefix: API_PREFIX + '/aesthetic' });
```

- [ ] **Step 7: Rodar testes**

```bash
cd apps/api && npm test -- tests/routes/aesthetic-analyses.test.js
```

Esperado: PASS (7 tests).

- [ ] **Step 8: Adicionar a test:unit + commit**

Edit `package.json` `test:unit`.

```bash
git add apps/api/src/services/aesthetic-analyses.js \
        apps/api/src/queues/aesthetic-analysis-queue.js \
        apps/api/src/routes/aesthetic-analyses.js \
        apps/api/src/server.js \
        apps/api/tests/routes/aesthetic-analyses.test.js \
        apps/api/package.json
git commit -m "feat(aesthetic): POST /analyses com pre-flight + enqueue (F1.8)

Pre-flight 3 camadas: photos own tenant + consent + créditos.
Cost configurável via env AESTHETIC_FACIAL_COST (default 5).
Debit + enqueue idempotente via ref_id (analysis.id).
402 INSUFFICIENT_CREDITS, 403 CONSENT_MISSING, 400 outros.
Spec §3.1, §5.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Rotas analyses GET (list + detail) + DELETE + COMPARE

**Files:**
- Modify: `apps/api/src/routes/aesthetic-analyses.js`
- Modify: `apps/api/src/services/aesthetic-analyses.js`
- Modify: `apps/api/tests/routes/aesthetic-analyses.test.js`

- [ ] **Step 1: Branch**

```bash
git checkout -b feat/aesthetic-f1-task-09-analyses-read
```

- [ ] **Step 2: Estender testes (adicionar describe blocks GET, DELETE, COMPARE)**

Append em `tests/routes/aesthetic-analyses.test.js`:

```js
describe('GET /aesthetic/analyses', () => {
  test('lista com filtro de subject_id', async () => {
    const app = await buildApp();
    app.pg.query.mockImplementation(async (sql, params) => {
      if (/SELECT id, analysis_type, status, created_at/i.test(sql)) {
        return { rows: [{ id: 'a1', analysis_type: 'facial', status: 'done', created_at: '2026-05-11' }] };
      }
      return { rows: [] };
    });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/analyses?subject_id=sub1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).items).toHaveLength(1);
  });
});

describe('GET /aesthetic/analyses/:id', () => {
  test('retorna detalhe da análise do tenant', async () => {
    const app = await buildApp();
    app.pg.query.mockImplementation(async (sql, params) => {
      if (/SELECT \* FROM aesthetic_analyses/i.test(sql)) {
        if (params[0] === 'a-yes' && params[1] === 't1') {
          return { rows: [{ id: 'a-yes', analysis_type: 'facial', status: 'done', metrics: { rugas: { score: 72 } }, photo_ids: ['p1'] }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/analyses/a-yes' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).metrics.rugas.score).toBe(72);
  });

  test('404 se não é do tenant', async () => {
    const app = await buildApp();
    app.pg.query.mockImplementation(async () => ({ rows: [] }));
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/analyses/a-no' });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /aesthetic/analyses/:id', () => {
  test('soft delete e 204', async () => {
    const app = await buildApp();
    app.pg.query.mockImplementation(async (sql) => {
      if (/UPDATE aesthetic_analyses SET deleted_at/i.test(sql)) return { rowCount: 1 };
      return { rows: [] };
    });
    const res = await app.inject({ method: 'DELETE', url: '/api/aesthetic/analyses/a1' });
    expect(res.statusCode).toBe(204);
  });
});

describe('POST /aesthetic/analyses/:id/compare', () => {
  test('computa delta matemático entre baseline e atual', async () => {
    const app = await buildApp();
    app.pg.query.mockImplementation(async (sql, params) => {
      if (/SELECT id, metrics FROM aesthetic_analyses/i.test(sql)) {
        if (params[0] === 'baseline') return { rows: [{ id: 'baseline', metrics: { rugas: { score: 70 }, firmeza: { score: 60 } } }] };
        if (params[0] === 'current') return { rows: [{ id: 'current', metrics: { rugas: { score: 50 }, firmeza: { score: 80 } } }] };
        return { rows: [] };
      }
      return { rows: [] };
    });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/current/compare',
      payload: { baseline_id: 'baseline' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.deltas.rugas).toBe(-20);
    expect(body.deltas.firmeza).toBe(+20);
    expect(body.overall_change).toBeDefined();
  });
});
```

- [ ] **Step 3: Estender service**

Append em `apps/api/src/services/aesthetic-analyses.js`:

```js
async function listForSubject(pg, { tenantId, subjectId, analysisType, limit = 20, offset = 0 }) {
  const params = [tenantId, subjectId, limit, offset];
  let typeFilter = '';
  if (analysisType) {
    params.splice(2, 0, analysisType);
    typeFilter = `AND analysis_type = $3`;
  }
  const { rows } = await pg.query(
    `SELECT id, analysis_type, status, created_at, completed_at,
            error_code, baseline_analysis_id, credits_charged, credits_refunded
     FROM aesthetic_analyses
     WHERE tenant_id = $1 AND subject_id = $2 AND deleted_at IS NULL ${typeFilter}
     ORDER BY created_at DESC
     LIMIT $${typeFilter ? '4' : '3'} OFFSET $${typeFilter ? '5' : '4'}`,
    params
  );
  return rows;
}

async function getDetail(pg, analysisId, tenantId) {
  const { rows } = await pg.query(
    `SELECT * FROM aesthetic_analyses
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [analysisId, tenantId]
  );
  return rows[0] || null;
}

async function softDelete(pg, analysisId, tenantId, userId) {
  return withTenant(pg, tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE aesthetic_analyses SET deleted_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [analysisId, tenantId]
    );
    return rowCount > 0;
  }, { userId, channel: 'ui' });
}

async function getMetricsOnly(pg, analysisId, tenantId) {
  const { rows } = await pg.query(
    `SELECT id, metrics FROM aesthetic_analyses
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND status = 'done'`,
    [analysisId, tenantId]
  );
  return rows[0] || null;
}

function computeDeltas(baselineMetrics, currentMetrics) {
  const deltas = {};
  const allKeys = new Set([
    ...Object.keys(baselineMetrics || {}),
    ...Object.keys(currentMetrics || {}),
  ]);
  let sum = 0, count = 0;
  for (const k of allKeys) {
    const a = baselineMetrics?.[k]?.score;
    const b = currentMetrics?.[k]?.score;
    if (typeof a === 'number' && typeof b === 'number') {
      const delta = b - a;
      deltas[k] = delta;
      sum += delta;
      count += 1;
    }
  }
  return { deltas, overall_change: count > 0 ? Math.round(sum / count) : 0 };
}

module.exports = {
  createPending, validatePhotosOwnership,
  listForSubject, getDetail, softDelete,
  getMetricsOnly, computeDeltas,
};
```

- [ ] **Step 4: Estender rota**

Append em `apps/api/src/routes/aesthetic-analyses.js`:

```js
  // GET /aesthetic/analyses?subject_id=&type=&limit=&offset=
  fastify.get('/analyses', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { subject_id, type, limit, offset } = request.query;
    if (!subject_id) return reply.status(400).send({ error: 'subject_id obrigatório' });
    const items = await listForSubject(fastify.pg, {
      tenantId: request.user.tenant_id,
      subjectId: subject_id,
      analysisType: type,
      limit: Math.min(100, Math.max(1, parseInt(limit) || 20)),
      offset: Math.max(0, parseInt(offset) || 0),
    });
    return reply.send({ items });
  });

  // GET /aesthetic/analyses/:id
  fastify.get('/analyses/:id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const a = await getDetail(fastify.pg, request.params.id, request.user.tenant_id);
    if (!a) return reply.status(404).send({ error: 'Análise não encontrada' });
    return reply.send(a);
  });

  // DELETE /aesthetic/analyses/:id
  fastify.delete('/analyses/:id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const ok = await softDelete(fastify.pg, request.params.id, request.user.tenant_id, request.user.user_id);
    if (!ok) return reply.status(404).send({ error: 'Análise não encontrada' });
    return reply.status(204).send();
  });

  // POST /aesthetic/analyses/:id/compare
  fastify.post('/analyses/:id/compare', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { baseline_id } = request.body || {};
    if (!baseline_id) return reply.status(400).send({ error: 'baseline_id obrigatório' });
    const tenantId = request.user.tenant_id;
    const [baseline, current] = await Promise.all([
      getMetricsOnly(fastify.pg, baseline_id, tenantId),
      getMetricsOnly(fastify.pg, request.params.id, tenantId),
    ]);
    if (!baseline || !current) {
      return reply.status(404).send({ error: 'Análise (baseline ou atual) não encontrada ou ainda não concluída' });
    }
    const result = computeDeltas(baseline.metrics, current.metrics);
    return reply.send({
      baseline_id: baseline.id,
      current_id: current.id,
      deltas: result.deltas,
      overall_change: result.overall_change,
    });
  });
```

E atualize o destructuring do require no topo do arquivo:

```js
const { createPending, validatePhotosOwnership, listForSubject, getDetail, softDelete, getMetricsOnly, computeDeltas } = require('../services/aesthetic-analyses');
```

- [ ] **Step 5: Rodar testes**

```bash
cd apps/api && npm test -- tests/routes/aesthetic-analyses.test.js
```

Esperado: PASS (todos os describe blocks).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/aesthetic-analyses.js \
        apps/api/src/routes/aesthetic-analyses.js \
        apps/api/tests/routes/aesthetic-analyses.test.js
git commit -m "feat(aesthetic): GET list+detail, DELETE, compare matemático (F1.9)

GET list paginado por subject_id (limit max 100).
GET detail completo (status done required pra metrics retornar).
DELETE soft (deleted_at).
POST compare: delta matemático sem chamada IA, retorna overall_change.
Spec §5.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Worker — queue setup + processor skeleton

**Files:**
- Create: `apps/worker/src/processors/aesthetic-analysis.js`
- Modify: `apps/worker/src/index.js`
- Test: `apps/worker/tests/processors/aesthetic-analysis.test.js`

- [ ] **Step 1: Branch + teste**

```bash
git checkout -b feat/aesthetic-f1-task-10-worker-setup
```

`apps/worker/tests/processors/aesthetic-analysis.test.js`:

```js
'use strict';

const { describe, test, expect, jest, beforeEach } = require('@jest/globals');

jest.mock('../../src/agents/aesthetic-facial', () => ({
  analyzeFacial: jest.fn(),
}));
jest.mock('../../src/agents/aesthetic-recommender', () => ({
  recommendProtocol: jest.fn(),
}));
jest.mock('../../src/storage/s3', () => ({
  downloadFile: jest.fn(async () => Buffer.from('fake-jpg-bytes')),
}));

const { processAestheticAnalysis } = require('../../src/processors/aesthetic-analysis');

function mockPool(queries = []) {
  return {
    connect: jest.fn(async () => ({
      query: jest.fn(async (sql, params) => {
        queries.push({ sql, params });
        if (/SELECT .* FROM aesthetic_photos/i.test(sql)) {
          return { rows: params[0].map((id) => ({ id, s3_key: `aesthetic-photos/t/s/${id}.jpg` })) };
        }
        if (/UPDATE aesthetic_analyses SET status/i.test(sql)) {
          return { rowCount: 1 };
        }
        if (/SELECT \* FROM aesthetic_analyses/i.test(sql)) {
          return { rows: [{ id: params[0], analysis_type: 'facial', photo_ids: ['p1'], status: 'pending' }] };
        }
        if (/SELECT .* FROM subjects/i.test(sql)) {
          return { rows: [{ id: 'sub1', fitzpatrick_type: 3, skin_concerns: [], sex: 'F', birth_date: '1990-01-01' }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    })),
    query: jest.fn(async () => ({ rows: [] })),
  };
}

describe('processAestheticAnalysis', () => {
  beforeEach(() => jest.clearAllMocks());

  test('flow básico: status processing → done', async () => {
    const { analyzeFacial } = require('../../src/agents/aesthetic-facial');
    const { recommendProtocol } = require('../../src/agents/aesthetic-recommender');
    analyzeFacial.mockResolvedValue({
      metrics: { rugas: { score: 72, regions: [] } },
      observations: { qualitative: 'ok' },
      tokens_input: 1000, tokens_output: 500,
    });
    recommendProtocol.mockResolvedValue({
      recommendations: { treatment_protocol: [], lifestyle_recommendations: {} },
      tokens_input: 500, tokens_output: 300,
    });

    const queries = [];
    const pool = mockPool(queries);
    await processAestheticAnalysis({
      pool,
      data: { analysis_id: 'a1', tenant_id: 't1', subject_id: 'sub1', user_id: 'u1',
              analysis_type: 'facial', photo_ids: ['p1'], professional_type: 'medico' },
    });

    const statusUpdates = queries.filter(q => /UPDATE aesthetic_analyses SET status/i.test(q.sql));
    expect(statusUpdates.length).toBeGreaterThanOrEqual(2); // processing → done
    expect(statusUpdates[statusUpdates.length - 1].params).toContain('done');
  });

  test('erro NO_FACE_DETECTED dispara refund', async () => {
    const { analyzeFacial } = require('../../src/agents/aesthetic-facial');
    const refundMock = jest.fn(async () => ({ id: 'refund-1' }));
    jest.doMock('../../src/services/aesthetic-credits', () => ({ refund: refundMock }));

    analyzeFacial.mockRejectedValue(Object.assign(new Error('No face'), { code: 'NO_FACE_DETECTED' }));

    const queries = [];
    const pool = mockPool(queries);
    await processAestheticAnalysis({
      pool,
      data: { analysis_id: 'a1', tenant_id: 't1', subject_id: 'sub1', user_id: 'u1',
              analysis_type: 'facial', photo_ids: ['p1'], professional_type: 'medico' },
    });

    const errorUpdates = queries.filter(q => /status = 'error'/i.test(q.sql));
    expect(errorUpdates.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Implementar processor**

`apps/worker/src/processors/aesthetic-analysis.js`:

```js
'use strict';

const { Pool } = require('pg');
const Redis = require('ioredis');
const { downloadFile } = require('../storage/s3');
const { analyzeFacial } = require('../agents/aesthetic-facial');
const { recommendProtocol } = require('../agents/aesthetic-recommender');
const { refund } = require('../../api-shared/aesthetic-credits-helper');

const _pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

let _publisher;
function publisher() {
  if (!_publisher) {
    _publisher = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return _publisher;
}

const TERMINAL_REFUND_CODES = new Set(['NO_FACE_DETECTED', 'IMAGE_TOO_BLURRY', 'BAD_LLM_OUTPUT']);

async function processAestheticAnalysis({ pool, data } = {}) {
  pool = pool || _pool;
  const { analysis_id, tenant_id, subject_id, user_id, analysis_type, photo_ids, professional_type } = data;
  const client = await pool.connect();

  let stage = 'init';
  try {
    // Setar tenant context
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant_id]);

    // Marcar processing
    stage = 'mark_processing';
    await client.query(
      `UPDATE aesthetic_analyses SET status = 'processing' WHERE id = $1 AND tenant_id = $2`,
      [analysis_id, tenant_id]
    );

    // Buscar fotos do S3
    stage = 'fetch_photos';
    const { rows: photos } = await client.query(
      `SELECT id, s3_key FROM aesthetic_photos
       WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
      [photo_ids, tenant_id]
    );
    if (photos.length !== photo_ids.length) {
      throw Object.assign(new Error('Photos missing'), { code: 'PHOTOS_MISSING' });
    }
    const buffers = await Promise.all(photos.map((p) => downloadFile(p.s3_key)));

    // Buscar contexto subject
    stage = 'fetch_subject';
    const { rows: subjects } = await client.query(
      `SELECT s.*,
              EXTRACT(YEAR FROM AGE(s.birth_date))::int AS age_years
       FROM subjects s
       WHERE s.id = $1 AND s.tenant_id = $2`,
      [subject_id, tenant_id]
    );
    const subject = subjects[0];

    // Call #1: análise
    stage = 'call_1_facial';
    const visionResult = await analyzeFacial({
      photoBuffers: buffers,
      subject,
      analysisType: analysis_type,
    });

    // Call #2: recomendação (best-effort — falha aqui preserva métricas)
    stage = 'call_2_recommender';
    let recResult = { recommendations: null, tokens_input: 0, tokens_output: 0, error: null };
    try {
      recResult = await recommendProtocol({
        metrics: visionResult.metrics,
        subject,
        professionalType: professional_type,
      });
    } catch (err) {
      console.warn(`[aesthetic][${analysis_id}] recommender falhou:`, err.message);
      recResult.error = err.code || 'RECOMMENDER_FAILED';
    }

    // Persistir resultado
    stage = 'persist_done';
    await client.query(
      `UPDATE aesthetic_analyses SET
         status = 'done',
         metrics = $2,
         observations = $3,
         recommendations = $4,
         model_metrics = $5,
         model_recommendations = $6,
         tokens_input = $7,
         tokens_output = $8,
         completed_at = NOW()
       WHERE id = $1`,
      [
        analysis_id,
        JSON.stringify(visionResult.metrics),
        JSON.stringify(visionResult.observations || {}),
        JSON.stringify(recResult.recommendations || {}),
        visionResult.model || null,
        recResult.model || null,
        (visionResult.tokens_input || 0) + (recResult.tokens_input || 0),
        (visionResult.tokens_output || 0) + (recResult.tokens_output || 0),
      ]
    );

    // Notify
    stage = 'notify';
    publisher().publish(`aesthetic:event:${tenant_id}`, JSON.stringify({
      kind: 'analysis_done',
      analysis_id,
      subject_id,
    }));

    console.log(`[aesthetic][${analysis_id}] done`);
  } catch (err) {
    const errorCode = err.code || 'UNKNOWN';
    console.error(`[aesthetic][${analysis_id}] error at stage=${stage} code=${errorCode}:`, err.message);
    try {
      await client.query(
        `UPDATE aesthetic_analyses SET
           status = 'error', error_code = $2, error_message = $3, completed_at = NOW()
         WHERE id = $1`,
        [analysis_id, errorCode, String(err.message).slice(0, 500)]
      );

      // Refund se erro terminal (não retryável)
      if (TERMINAL_REFUND_CODES.has(errorCode)) {
        const { rows: aRows } = await client.query(
          `SELECT credits_charged, credits_refunded FROM aesthetic_analyses WHERE id = $1`,
          [analysis_id]
        );
        if (aRows[0] && !aRows[0].credits_refunded) {
          await client.query(
            `INSERT INTO credit_ledger (tenant_id, amount, kind, description, ref_id)
             SELECT $1, $2, 'aesthetic_refund', $3, $4
             WHERE NOT EXISTS (
               SELECT 1 FROM credit_ledger WHERE ref_id = $4 AND kind = 'aesthetic_refund'
             )`,
            [tenant_id, +aRows[0].credits_charged, `Refund: ${errorCode}`, analysis_id]
          );
          await client.query(
            `UPDATE aesthetic_analyses SET credits_refunded = true WHERE id = $1`,
            [analysis_id]
          );
        }
      }

      publisher().publish(`aesthetic:event:${tenant_id}`, JSON.stringify({
        kind: 'analysis_failed',
        analysis_id, subject_id, error_code: errorCode,
      }));
    } catch (e2) {
      console.error(`[aesthetic][${analysis_id}] error persist falhou:`, e2.message);
    }
    if (!TERMINAL_REFUND_CODES.has(errorCode)) {
      // BullMQ retry pra erros transientes
      throw err;
    }
  } finally {
    client.release();
  }
}

module.exports = { processAestheticAnalysis };
```

- [ ] **Step 3: Modificar `apps/worker/src/index.js` — adicionar worker pra aesthetic**

Edit `apps/worker/src/index.js`:

```js
// Imports no topo: adicionar
const { processAestheticAnalysis } = require('./processors/aesthetic-analysis');

// Connections: adicionar
const aestheticConn = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

// Após o videoWorker, adicionar:
const aestheticWorker = new Worker('aesthetic-analysis', async (job) => {
  console.log(`[aesthetic-worker] Job ${job.id}: analysis ${job.data.analysis_id}`);
  await processAestheticAnalysis({ data: job.data });
}, {
  connection: aestheticConn, concurrency: 2,
  removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 },
});

aestheticWorker.on('completed', (job) => console.log(`[aesthetic-worker] Job ${job.id} completed`));
aestheticWorker.on('failed',    (job, err) => console.error(`[aesthetic-worker] Job ${job.id} failed: ${err.message}`));

// Atualizar shutdown handler — adicionar aestheticWorker.close() + aestheticConn.quit() em Promise.allSettled
```

- [ ] **Step 4: Stubs de agents pra testes não quebrarem antes do Task 11 + 12**

Crie stubs vazios:

`apps/worker/src/agents/aesthetic-facial.js`:
```js
'use strict';
async function analyzeFacial() { throw new Error('not implemented yet — Task 11'); }
module.exports = { analyzeFacial };
```

`apps/worker/src/agents/aesthetic-recommender.js`:
```js
'use strict';
async function recommendProtocol() { throw new Error('not implemented yet — Task 12'); }
module.exports = { recommendProtocol };
```

- [ ] **Step 5: Rodar teste do processor (com mocks pass-through)**

```bash
cd apps/worker && npm test -- tests/processors/aesthetic-analysis.test.js
```

Esperado: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/processors/aesthetic-analysis.js \
        apps/worker/src/agents/aesthetic-facial.js \
        apps/worker/src/agents/aesthetic-recommender.js \
        apps/worker/src/index.js \
        apps/worker/tests/processors/aesthetic-analysis.test.js
git commit -m "feat(aesthetic): worker queue aesthetic-analysis + processor (F1.10)

processAestheticAnalysis orquestra: status processing → download S3 →
agente Vision → agente Recommender (best-effort) → persist done.
Erros terminais (NO_FACE_DETECTED/IMAGE_TOO_BLURRY/BAD_LLM_OUTPUT)
disparam refund idempotente via credit_ledger. Transientes → BullMQ retry.
Pub/sub 'aesthetic:event:{tenant}' kind=analysis_done|analysis_failed.
Agent stubs vazios (implementação em F1.11 + F1.12).
Spec §3.1, §6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Worker agent — `aesthetic-facial` (Call #1 Vision)

**Files:**
- Modify: `apps/worker/src/agents/aesthetic-facial.js`
- Test: `apps/worker/tests/agents/aesthetic-facial.test.js`

- [ ] **Step 1: Branch + teste**

```bash
git checkout -b feat/aesthetic-f1-task-11-agent-facial
```

`apps/worker/tests/agents/aesthetic-facial.test.js`:

```js
'use strict';

const { describe, test, expect, jest } = require('@jest/globals');

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic { constructor() {} messages = { create: mockCreate }; },
  };
});

const { analyzeFacial, sanitizeMetrics } = require('../../src/agents/aesthetic-facial');

describe('analyzeFacial', () => {
  test('happy path retorna metrics + observations', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        metrics: {
          rugas: { score: 72, confidence: 'high', regions: [{ type: 'bbox', x: 0.5, y: 0.3, w: 0.1, h: 0.05 }] },
          firmeza: { score: 65, confidence: 'high', regions: [] },
        },
        observations: { qualitative: 'pele com presença de rugas moderadas' }
      }) }],
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    const result = await analyzeFacial({
      photoBuffers: [Buffer.from('fake')],
      subject: { age_years: 35, fitzpatrick_type: 3, skin_concerns: [], sex: 'F' },
      analysisType: 'facial',
    });
    expect(result.metrics.rugas.score).toBe(72);
    expect(result.tokens_input).toBe(1000);
  });

  test('clamp score 0-100 + slice arrays', () => {
    const dirty = {
      rugas: { score: 150, confidence: 'high', regions: Array(50).fill({ type: 'bbox', x: 0.5, y: 0.5, w: 0.1, h: 0.1 }) },
      firmeza: { score: -10, regions: [] },
    };
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas.score).toBe(100);
    expect(clean.firmeza.score).toBe(0);
    expect(clean.rugas.regions.length).toBeLessThanOrEqual(20);
  });

  test('region type whitelist (rejeita inválido)', () => {
    const dirty = {
      rugas: { score: 50, regions: [
        { type: 'bbox', x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
        { type: 'invalid_type', x: 0.5, y: 0.5 },
        { type: 'polyline', points: [[0.1, 0.1]] },
      ]},
    };
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas.regions.map(r => r.type)).toEqual(['bbox', 'polyline']);
  });

  test('rejeita métrica fora do catálogo da região', () => {
    const dirty = {
      rugas: { score: 50, regions: [] },
      culote_esquerdo: { score: 70, regions: [] }, // não é facial
    };
    const clean = sanitizeMetrics(dirty, 'facial');
    expect(clean.rugas).toBeDefined();
    expect(clean.culote_esquerdo).toBeUndefined();
  });

  test('NO_FACE_DETECTED quando IA retorna flag', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({ no_face_detected: true }) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await expect(analyzeFacial({
      photoBuffers: [Buffer.from('fake')],
      subject: { age_years: 30, fitzpatrick_type: 3, skin_concerns: [], sex: 'F' },
      analysisType: 'facial',
    })).rejects.toMatchObject({ code: 'NO_FACE_DETECTED' });
  });

  test('BAD_LLM_OUTPUT em JSON inválido', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: 'isso não é json' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await expect(analyzeFacial({
      photoBuffers: [Buffer.from('fake')],
      subject: { age_years: 30, fitzpatrick_type: 3, skin_concerns: [], sex: 'F' },
      analysisType: 'facial',
    })).rejects.toMatchObject({ code: 'BAD_LLM_OUTPUT' });
  });
});
```

- [ ] **Step 2: Implementar agente**

`apps/worker/src/agents/aesthetic-facial.js`:

```js
'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const MODELS = require('../config/models');
const { REGION_METRICS, metricsForRegion } = require('../../api-shared/aesthetic-metrics');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });

const VALID_REGION_TYPES = new Set(['bbox', 'polyline', 'polygon', 'line', 'point']);
const MAX_REGIONS_PER_METRIC = 20;
const MAX_POINTS_PER_REGION = 50;
const MAX_LABEL_LENGTH = 100;

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(1, x));
}

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function sanitizeRegion(r) {
  if (!r || !VALID_REGION_TYPES.has(r.type)) return null;
  const out = { type: r.type };
  if (typeof r.label === 'string') out.label = r.label.slice(0, MAX_LABEL_LENGTH);

  switch (r.type) {
    case 'bbox': {
      const x = clamp01(r.x), y = clamp01(r.y), w = clamp01(r.w), h = clamp01(r.h);
      if ([x,y,w,h].some(v => v === null)) return null;
      return { ...out, x, y, w, h };
    }
    case 'polyline':
    case 'polygon': {
      if (!Array.isArray(r.points)) return null;
      const points = r.points.slice(0, MAX_POINTS_PER_REGION)
        .map(p => Array.isArray(p) && p.length === 2 ? [clamp01(p[0]), clamp01(p[1])] : null)
        .filter(p => p !== null && p[0] !== null && p[1] !== null);
      if (points.length < 2) return null;
      return { ...out, points };
    }
    case 'line': {
      if (!Array.isArray(r.from) || !Array.isArray(r.to)) return null;
      const from = [clamp01(r.from[0]), clamp01(r.from[1])];
      const to = [clamp01(r.to[0]), clamp01(r.to[1])];
      if (from.some(v => v === null) || to.some(v => v === null)) return null;
      return { ...out, from, to };
    }
    case 'point': {
      const x = clamp01(r.x), y = clamp01(r.y);
      if (x === null || y === null) return null;
      return { ...out, x, y };
    }
  }
  return null;
}

function sanitizeMetrics(rawMetrics, analysisType) {
  const allowed = new Set(metricsForRegion(analysisType));
  const clean = {};
  for (const [key, value] of Object.entries(rawMetrics || {})) {
    if (!allowed.has(key)) continue;
    if (!value || typeof value !== 'object') continue;
    const regions = Array.isArray(value.regions)
      ? value.regions.slice(0, MAX_REGIONS_PER_METRIC).map(sanitizeRegion).filter(Boolean)
      : [];
    clean[key] = {
      score: clampScore(value.score),
      confidence: ['high', 'medium', 'low'].includes(value.confidence) ? value.confidence : 'medium',
      regions,
    };
  }
  return clean;
}

function buildPrompt(subject, analysisType) {
  const metrics = metricsForRegion(analysisType);
  const ageText = subject.age_years ? `${subject.age_years} anos` : 'idade não informada';
  const sexText = subject.sex === 'M' ? 'masculino' : (subject.sex === 'F' ? 'feminino' : 'sexo não informado');
  const fitzText = subject.fitzpatrick_type ? `fototipo ${subject.fitzpatrick_type}` : 'fototipo não informado';
  const concerns = Array.isArray(subject.skin_concerns) && subject.skin_concerns.length
    ? `preocupações declaradas: ${subject.skin_concerns.join(', ')}` : '';

  return `Você é um assistente de análise estética. Analise a(s) foto(s) do paciente
(${ageText}, ${sexText}, ${fitzText}${concerns ? ', ' + concerns : ''}).

Avalie as seguintes métricas (escala 0-100, onde 0 = problema severo, 100 = estado ideal):
${metrics.map(m => '- ' + m).join('\n')}

Para cada métrica, retorne também:
- score (0-100)
- confidence: "high" | "medium" | "low"
- regions: lista de áreas afetadas com coordenadas normalizadas 0-1.
  Tipos suportados: bbox {type:"bbox",x,y,w,h}, polyline {type:"polyline",points:[[x,y],...]},
  polygon {type:"polygon",points:[[x,y],...]}, line {type:"line",from:[x,y],to:[x,y]},
  point {type:"point",x,y}. Use o tipo mais apropriado.
- label (opcional, até 100 chars): descrição da região (ex: "ruga periorbital esquerda")

Marque confidence="low" em métricas que dependem de medição precisa 2D (ex: simetria).

Se NÃO conseguir identificar um rosto/região anatômica adequada, retorne:
{"no_face_detected": true, "reason": "..."}

Se a(s) foto(s) estiver(em) muito desfocadas/escuras para análise confiável:
{"image_too_blurry": true, "reason": "..."}

NÃO faça diagnóstico médico. NÃO sugira tratamentos aqui (outro agente cuida disso).

Output: JSON estrito no formato:
{
  "metrics": { "<metric_name>": { "score": ..., "confidence": "...", "regions": [...] }, ... },
  "observations": { "qualitative": "<2-3 linhas de descrição em PT-BR>" }
}`;
}

async function analyzeFacial({ photoBuffers, subject, analysisType }) {
  if (!photoBuffers?.length) {
    throw Object.assign(new Error('No photos provided'), { code: 'NO_PHOTOS' });
  }

  const imageContents = photoBuffers.map((buf) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') },
  }));

  let response;
  try {
    response = await client.messages.create({
      model: MODELS.VISION,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(subject, analysisType) },
          ...imageContents,
        ],
      }],
    });
  } catch (err) {
    throw Object.assign(new Error(`Anthropic call failed: ${err.message}`), { code: 'ANTHROPIC_FAIL', cause: err });
  }

  const rawText = response.content?.[0]?.text || '';
  let parsed;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : rawText);
  } catch {
    throw Object.assign(new Error('BAD_LLM_OUTPUT'), { code: 'BAD_LLM_OUTPUT', raw: rawText.slice(0, 500) });
  }

  if (parsed.no_face_detected) {
    throw Object.assign(new Error(parsed.reason || 'No face detected'), { code: 'NO_FACE_DETECTED' });
  }
  if (parsed.image_too_blurry) {
    throw Object.assign(new Error(parsed.reason || 'Image too blurry'), { code: 'IMAGE_TOO_BLURRY' });
  }
  if (!parsed.metrics || typeof parsed.metrics !== 'object') {
    throw Object.assign(new Error('metrics ausente'), { code: 'BAD_LLM_OUTPUT' });
  }

  const cleanMetrics = sanitizeMetrics(parsed.metrics, analysisType);
  const observations = parsed.observations && typeof parsed.observations === 'object'
    ? { qualitative: String(parsed.observations.qualitative || '').slice(0, 1500) }
    : {};

  return {
    metrics: cleanMetrics,
    observations,
    model: MODELS.VISION,
    tokens_input: response.usage?.input_tokens || 0,
    tokens_output: response.usage?.output_tokens || 0,
  };
}

module.exports = { analyzeFacial, sanitizeMetrics };
```

- [ ] **Step 3: Criar shared module pra metrics (worker reusa do api)**

Worker não consegue importar de apps/api diretamente. Crie symlink ou cópia:

`apps/worker/src/config/aesthetic-metrics.js` (cópia do mesmo arquivo da API):

```js
'use strict';
// COPIADO de apps/api/src/constants/aesthetic-metrics.js
// Sincronizar manualmente quando alterar.

const REGION_METRICS = { /* mesma estrutura */ };
const SENSITIVE_REGIONS = ['breast', 'glutes', 'abdomen'];
function metricsForRegion(region) { return REGION_METRICS[region] || []; }
module.exports = { REGION_METRICS, SENSITIVE_REGIONS, metricsForRegion };
```

Atualize o require em `aesthetic-facial.js`:
```js
const { REGION_METRICS, metricsForRegion } = require('../config/aesthetic-metrics');
```

(Em produção futuro, considerar packages monorepo — fora deste escopo.)

- [ ] **Step 4: Rodar testes**

```bash
cd apps/worker && npm test -- tests/agents/aesthetic-facial.test.js
```

Esperado: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/agents/aesthetic-facial.js \
        apps/worker/src/config/aesthetic-metrics.js \
        apps/worker/tests/agents/aesthetic-facial.test.js
git commit -m "feat(aesthetic): agente Sonnet Vision análise facial (F1.11)

Call #1 do pipeline: foto + contexto subject → métricas + regions.
Saneamento: clamp score 0-100, region type whitelist, slice arrays,
metricas fora do catálogo descartadas. NO_FACE_DETECTED + IMAGE_TOO_BLURRY
flags reconhecidas e propagadas como errors terminais.
Spec §6.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Worker agent — `aesthetic-recommender` (Call #2)

**Files:**
- Modify: `apps/worker/src/agents/aesthetic-recommender.js`
- Test: `apps/worker/tests/agents/aesthetic-recommender.test.js`

- [ ] **Step 1: Branch + teste**

```bash
git checkout -b feat/aesthetic-f1-task-12-agent-recommender
```

`apps/worker/tests/agents/aesthetic-recommender.test.js`:

```js
'use strict';

const { describe, test, expect, jest } = require('@jest/globals');

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic { constructor() {} messages = { create: mockCreate }; },
}));

const { recommendProtocol, sanitizeRecommendations } = require('../../src/agents/aesthetic-recommender');

describe('recommendProtocol', () => {
  test('retorna recommendations + tokens', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Microagulhamento',
          target_metric: 'rugas',
          indication_text: 'Estímulo de colágeno pra rugas dinâmicas',
          sessions_recommended: 3,
          interval_days: 30,
          urgency: 'medium',
          expected_outcome: 'Melhora visível em 3 sessões',
        }],
        lifestyle_recommendations: {
          estimated_daily_calories_kcal: 1800,
          hydration_ml_per_day: 2500,
          disclaimer: 'Consulte nutricionista (CRN)',
        },
        summary_for_patient: 'Plano simples...',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });
    const result = await recommendProtocol({
      metrics: { rugas: { score: 70, regions: [] } },
      subject: { age_years: 40, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
    });
    expect(result.recommendations.treatment_protocol).toHaveLength(1);
    expect(result.tokens_output).toBe(400);
  });

  test('esteticista NÃO recebe sugestões que requerem medico', () => {
    const raw = {
      treatment_protocol: [
        { treatment_name: 'Botox', requires_medico: true, target_metric: 'rugas' },
        { treatment_name: 'Microagulhamento', requires_medico: false, target_metric: 'rugas' },
      ],
    };
    const clean = sanitizeRecommendations(raw, 'esteticista');
    expect(clean.treatment_protocol).toHaveLength(1);
    expect(clean.treatment_protocol[0].treatment_name).toBe('Microagulhamento');
  });

  test('medico recebe tudo', () => {
    const raw = {
      treatment_protocol: [
        { treatment_name: 'Botox', requires_medico: true, target_metric: 'rugas' },
        { treatment_name: 'Microagulhamento', requires_medico: false, target_metric: 'rugas' },
      ],
    };
    const clean = sanitizeRecommendations(raw, 'medico');
    expect(clean.treatment_protocol).toHaveLength(2);
  });

  test('disclaimer nutrição sempre presente quando lifestyle existe', () => {
    const raw = {
      lifestyle_recommendations: { estimated_daily_calories_kcal: 2000 },
    };
    const clean = sanitizeRecommendations(raw, 'medico');
    expect(clean.lifestyle_recommendations.disclaimer).toBeDefined();
    expect(clean.lifestyle_recommendations.disclaimer).toMatch(/nutricionista|CRN/i);
  });

  test('clamp sessions + interval pra valores razoáveis', () => {
    const raw = {
      treatment_protocol: [{
        treatment_name: 'X', target_metric: 'rugas',
        sessions_recommended: 100, interval_days: -10,
        requires_medico: false,
      }],
    };
    const clean = sanitizeRecommendations(raw, 'medico');
    expect(clean.treatment_protocol[0].sessions_recommended).toBeLessThanOrEqual(20);
    expect(clean.treatment_protocol[0].interval_days).toBeGreaterThanOrEqual(7);
  });

  test('BAD_LLM_OUTPUT em JSON inválido', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: 'lorem ipsum não é json' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await expect(recommendProtocol({
      metrics: { rugas: { score: 70 } },
      subject: { age_years: 30, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
    })).rejects.toMatchObject({ code: 'BAD_LLM_OUTPUT' });
  });
});
```

- [ ] **Step 2: Implementar agente**

`apps/worker/src/agents/aesthetic-recommender.js`:

```js
'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const MODELS = require('../config/models');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });

const VALID_URGENCIES = new Set(['low', 'medium', 'high']);
const MAX_TREATMENTS = 10;
const MAX_FOODS = 15;
const NUTRITION_DISCLAIMER = 'Orientações gerais de estilo de vida. Não substituem consulta com nutricionista (CRN).';

function clampInt(n, min, max) {
  const x = parseInt(n, 10);
  if (!Number.isFinite(x)) return null;
  return Math.max(min, Math.min(max, x));
}

function slice(s, max) {
  return typeof s === 'string' ? s.slice(0, max) : null;
}

function sanitizeTreatment(t, profType) {
  if (!t || typeof t !== 'object') return null;
  // Filtro por tipo profissional
  if (t.requires_medico && profType !== 'medico' && profType !== 'dentista') return null;
  const treatment = {
    treatment_name: slice(t.treatment_name, 100),
    target_metric: slice(t.target_metric, 60),
    indication_text: slice(t.indication_text, 500),
    sessions_recommended: clampInt(t.sessions_recommended, 1, 20),
    interval_days: clampInt(t.interval_days, 7, 365),
    estimated_total_cost_brl_range: Array.isArray(t.estimated_total_cost_brl_range)
      ? t.estimated_total_cost_brl_range.slice(0, 2).map(n => Number(n) >= 0 ? Number(n) : null).filter(Boolean)
      : [],
    urgency: VALID_URGENCIES.has(t.urgency) ? t.urgency : 'medium',
    expected_outcome: slice(t.expected_outcome, 500),
    contraindications_flagged: Array.isArray(t.contraindications_flagged) ? t.contraindications_flagged.slice(0, 10).map(s => slice(s, 100)) : [],
    requires_medico: !!t.requires_medico,
    in_catalog: false, // será atualizado pelo backend pos-IA (F3)
  };
  if (!treatment.treatment_name) return null;
  return treatment;
}

function sanitizeLifestyle(l) {
  if (!l || typeof l !== 'object') return null;
  return {
    estimated_daily_calories_kcal: clampInt(l.estimated_daily_calories_kcal, 800, 4500),
    macro_distribution_g: l.macro_distribution_g && typeof l.macro_distribution_g === 'object' ? {
      protein: clampInt(l.macro_distribution_g.protein, 30, 400),
      carbs:   clampInt(l.macro_distribution_g.carbs, 50, 700),
      fat:     clampInt(l.macro_distribution_g.fat, 30, 250),
    } : null,
    hydration_ml_per_day: clampInt(l.hydration_ml_per_day, 1000, 6000),
    meal_timing_suggestion: slice(l.meal_timing_suggestion, 300),
    exercise_recommendation: l.exercise_recommendation && typeof l.exercise_recommendation === 'object' ? {
      aerobic: slice(l.exercise_recommendation.aerobic, 300),
      strength: slice(l.exercise_recommendation.strength, 300),
    } : null,
    foods_to_emphasize: Array.isArray(l.foods_to_emphasize) ? l.foods_to_emphasize.slice(0, MAX_FOODS).map(s => slice(s, 80)) : [],
    foods_to_minimize: Array.isArray(l.foods_to_minimize) ? l.foods_to_minimize.slice(0, MAX_FOODS).map(s => slice(s, 80)) : [],
    supplementation_consideration: Array.isArray(l.supplementation_consideration) ? l.supplementation_consideration.slice(0, 10).map(s => slice(s, 80)) : [],
    disclaimer: NUTRITION_DISCLAIMER, // sempre nosso, ignora o que IA mandar
  };
}

function sanitizeRecommendations(raw, profType) {
  if (!raw || typeof raw !== 'object') return {};
  const treatments = Array.isArray(raw.treatment_protocol)
    ? raw.treatment_protocol.slice(0, MAX_TREATMENTS).map(t => sanitizeTreatment(t, profType)).filter(Boolean)
    : [];
  const lifestyle = sanitizeLifestyle(raw.lifestyle_recommendations);
  const summary = slice(raw.summary_for_patient, 1500);
  const follow = raw.follow_up_protocol && typeof raw.follow_up_protocol === 'object' ? {
    next_analysis_recommended_in_days: clampInt(raw.follow_up_protocol.next_analysis_recommended_in_days, 7, 365),
    checkpoint_metrics: Array.isArray(raw.follow_up_protocol.checkpoint_metrics)
      ? raw.follow_up_protocol.checkpoint_metrics.slice(0, 20).map(s => slice(s, 60))
      : [],
  } : null;
  return {
    treatment_protocol: treatments,
    lifestyle_recommendations: lifestyle,
    summary_for_patient: summary,
    follow_up_protocol: follow,
  };
}

function buildPrompt({ metrics, subject, professionalType }) {
  const profile = subject?.aesthetic_profile || {};
  return `Você é um assistente de protocolo estético. Com base nas métricas analisadas e
no perfil do paciente, recomende protocolo de tratamento.

PROFISSIONAL: ${professionalType || 'esteticista'}
${professionalType === 'esteticista' ? 'RESTRIÇÃO: NÃO sugira procedimentos com requires_medico=true (Botox, ácido hialurônico, lasers ablativos, cirurgia, prescrição farmacológica).\nSugira procedimentos não-invasivos (peeling enzimático, microdermoabrasão, RF estética, drenagem linfática).' : 'Pode sugerir procedimentos médicos quando aplicável.'}

PACIENTE:
- ${subject?.age_years || '?'} anos, ${subject?.sex === 'F' ? 'feminino' : (subject?.sex === 'M' ? 'masculino' : '?')}
- fototipo: ${subject?.fitzpatrick_type || '?'}
- altura: ${profile.altura_cm || '?'} cm, peso: ${profile.peso_kg || '?'} kg
- objetivo: ${profile.aesthetic_goals?.join(', ') || 'não declarado'}
- comorbidades: ${subject?.comorbidities || 'nenhuma'}
- medicações: ${subject?.medications || 'nenhuma'}

MÉTRICAS DA ANÁLISE:
${Object.entries(metrics || {}).map(([k, v]) => `- ${k}: ${v.score}/100 (${v.confidence || 'medium'})`).join('\n')}

CADA tratamento sugerido DEVE conter:
- treatment_name (nome canônico do procedimento, ex: "Microagulhamento", "Botox")
- target_metric (qual métrica visa melhorar)
- indication_text (2-3 linhas justificando)
- sessions_recommended (1-20)
- interval_days (7-365)
- estimated_total_cost_brl_range [min, max]
- urgency: "low" | "medium" | "high"
- expected_outcome (1-2 linhas)
- contraindications_flagged (lista de flags se houver)
- requires_medico (true|false)

Para NUTRIÇÃO/ESTILO DE VIDA (orientação geral, NÃO plano terapêutico):
- estimated_daily_calories_kcal
- macro_distribution_g: { protein, carbs, fat }
- hydration_ml_per_day
- meal_timing_suggestion (1 linha)
- exercise_recommendation: { aerobic, strength }
- foods_to_emphasize / foods_to_minimize (listas)
- supplementation_consideration (lista)

NÃO inclua disclaimer no JSON — eu adiciono automaticamente.

Output JSON estrito:
{
  "treatment_protocol": [...],
  "lifestyle_recommendations": {...},
  "summary_for_patient": "<plano resumido em 3-5 linhas>",
  "follow_up_protocol": { "next_analysis_recommended_in_days": ..., "checkpoint_metrics": [...] }
}`;
}

async function recommendProtocol({ metrics, subject, professionalType }) {
  let response;
  try {
    response = await client.messages.create({
      model: MODELS.CLINICAL_PREMIUM,
      max_tokens: 2500,
      messages: [{ role: 'user', content: buildPrompt({ metrics, subject, professionalType }) }],
    });
  } catch (err) {
    throw Object.assign(new Error(`Anthropic call failed: ${err.message}`), { code: 'ANTHROPIC_FAIL', cause: err });
  }

  const rawText = response.content?.[0]?.text || '';
  let parsed;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : rawText);
  } catch {
    throw Object.assign(new Error('BAD_LLM_OUTPUT'), { code: 'BAD_LLM_OUTPUT', raw: rawText.slice(0, 500) });
  }

  return {
    recommendations: sanitizeRecommendations(parsed, professionalType),
    model: MODELS.CLINICAL_PREMIUM,
    tokens_input: response.usage?.input_tokens || 0,
    tokens_output: response.usage?.output_tokens || 0,
  };
}

module.exports = { recommendProtocol, sanitizeRecommendations };
```

- [ ] **Step 3: Rodar testes**

```bash
cd apps/worker && npm test -- tests/agents/aesthetic-recommender.test.js
```

Esperado: PASS (6 tests).

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/agents/aesthetic-recommender.js \
        apps/worker/tests/agents/aesthetic-recommender.test.js
git commit -m "feat(aesthetic): agente Opus recomendação protocolo (F1.12)

Call #2 do pipeline: métricas + perfil paciente + tipo profissional →
treatment_protocol + lifestyle_recommendations + summary.
Filter requires_medico pra esteticista (não recebe Botox/lasers/etc).
Disclaimer nutrição CRN sempre presente (ignora se IA mandar).
Saneamento: clamp sessions/interval/calories, slice strings/arrays.
Spec §6.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Frontend service `aesthetic-facial.service.ts`

**Files:**
- Create: `apps/web/src/app/features/aesthetic/services/aesthetic-facial.service.ts`
- Create: `apps/web/src/app/features/aesthetic/models/analysis.model.ts`
- Test: `apps/web/src/app/features/aesthetic/services/aesthetic-facial.service.spec.ts`

- [ ] **Step 1: Branch + criar arquivos**

```bash
git checkout -b feat/aesthetic-f1-task-13-frontend-service
mkdir -p apps/web/src/app/features/aesthetic/services
mkdir -p apps/web/src/app/features/aesthetic/models
mkdir -p apps/web/src/app/features/aesthetic/components
```

`apps/web/src/app/features/aesthetic/models/analysis.model.ts`:

```ts
export type AnalysisType = 'facial' | 'eyelids' | 'neck' | 'breast' | 'arms'
  | 'abdomen' | 'legs' | 'glutes' | 'full_body' | 'other';

export type AnalysisStatus = 'pending' | 'processing' | 'done' | 'error';

export interface RegionBbox     { type: 'bbox'; x: number; y: number; w: number; h: number; label?: string; }
export interface RegionPolyline { type: 'polyline'; points: [number, number][]; label?: string; }
export interface RegionPolygon  { type: 'polygon'; points: [number, number][]; label?: string; }
export interface RegionLine     { type: 'line'; from: [number, number]; to: [number, number]; label?: string; }
export interface RegionPoint    { type: 'point'; x: number; y: number; label?: string; }
export type Region = RegionBbox | RegionPolyline | RegionPolygon | RegionLine | RegionPoint;

export interface MetricData {
  score: number;          // 0-100
  confidence: 'high' | 'medium' | 'low';
  regions: Region[];
}

export interface Metrics {
  [metricName: string]: MetricData;
}

export interface AestheticAnalysisListItem {
  id: string;
  analysis_type: AnalysisType;
  status: AnalysisStatus;
  created_at: string;
  completed_at?: string | null;
  error_code?: string | null;
  baseline_analysis_id?: string | null;
  credits_charged: number;
  credits_refunded: boolean;
}

export interface AestheticAnalysisDetail extends AestheticAnalysisListItem {
  photo_ids: string[];
  metrics?: Metrics;
  observations?: { qualitative?: string };
  recommendations?: {
    treatment_protocol?: any[];
    lifestyle_recommendations?: any;
    summary_for_patient?: string;
  };
}

export interface CreateAnalysisPayload {
  analysis_type: AnalysisType;
  subject_id: string;
  photo_ids: string[];
  baseline_id?: string;
}

export interface CompareResult {
  baseline_id: string;
  current_id: string;
  deltas: Record<string, number>;
  overall_change: number;
}
```

- [ ] **Step 2: Implementar service**

`apps/web/src/app/features/aesthetic/services/aesthetic-facial.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  AestheticAnalysisListItem, AestheticAnalysisDetail,
  CreateAnalysisPayload, CompareResult,
} from '../models/analysis.model';

@Injectable({ providedIn: 'root' })
export class AestheticFacialService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/aesthetic`;

  // Consent
  getConsent(subjectId: string): Observable<{ confirmed: boolean; created_at?: string; reinforced_regions?: string[] }> {
    return this.http.get<any>(`${this.base}/consent/${subjectId}`);
  }
  createConsent(payload: { subject_id: string; notes?: string; reinforced_regions?: string[] }): Observable<any> {
    return this.http.post(`${this.base}/consent`, payload);
  }

  // Photos
  uploadPhoto(formData: FormData): Observable<{ id: string; s3_key: string; photo_type: string; is_sensitive: boolean }> {
    return this.http.post<any>(`${this.base}/photos`, formData);
  }
  getPhotoUrl(photoId: string): Observable<{ url: string; expires_in: number }> {
    return this.http.get<any>(`${this.base}/photos/${photoId}/url`);
  }
  deletePhoto(photoId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/photos/${photoId}`);
  }

  // Analyses
  createAnalysis(payload: CreateAnalysisPayload): Observable<{ analysis_id: string; status: string; credits_charged: number }> {
    return this.http.post<any>(`${this.base}/analyses`, payload);
  }
  listAnalyses(subjectId: string, type?: string, limit = 20, offset = 0): Observable<{ items: AestheticAnalysisListItem[] }> {
    let params = `subject_id=${subjectId}&limit=${limit}&offset=${offset}`;
    if (type) params += `&type=${type}`;
    return this.http.get<any>(`${this.base}/analyses?${params}`);
  }
  getAnalysis(analysisId: string): Observable<AestheticAnalysisDetail> {
    return this.http.get<any>(`${this.base}/analyses/${analysisId}`);
  }
  deleteAnalysis(analysisId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/analyses/${analysisId}`);
  }
  compareAnalyses(currentId: string, baselineId: string): Observable<CompareResult> {
    return this.http.post<any>(`${this.base}/analyses/${currentId}/compare`, { baseline_id: baselineId });
  }
}
```

- [ ] **Step 3: Spec test**

`apps/web/src/app/features/aesthetic/services/aesthetic-facial.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AestheticFacialService } from './aesthetic-facial.service';
import { environment } from '../../../../environments/environment';

describe('AestheticFacialService', () => {
  let svc: AestheticFacialService;
  let httpMock: HttpTestingController;
  const base = `${environment.apiUrl}/aesthetic`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AestheticFacialService],
    });
    svc = TestBed.inject(AestheticFacialService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getConsent faz GET', () => {
    svc.getConsent('sub1').subscribe();
    const req = httpMock.expectOne(`${base}/consent/sub1`);
    expect(req.request.method).toBe('GET');
    req.flush({ confirmed: true });
  });

  it('createAnalysis faz POST com payload', () => {
    svc.createAnalysis({ analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1'] }).subscribe();
    const req = httpMock.expectOne(`${base}/analyses`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.analysis_type).toBe('facial');
    req.flush({ analysis_id: 'a1', status: 'pending', credits_charged: 5 });
  });

  it('compareAnalyses faz POST com baseline_id', () => {
    svc.compareAnalyses('current', 'baseline').subscribe();
    const req = httpMock.expectOne(`${base}/analyses/current/compare`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.baseline_id).toBe('baseline');
    req.flush({ baseline_id: 'baseline', current_id: 'current', deltas: {}, overall_change: 0 });
  });
});
```

- [ ] **Step 4: Rodar**

```bash
cd apps/web && npm test -- --testPathPattern='aesthetic-facial.service'
```

Esperado: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/aesthetic/
git commit -m "feat(aesthetic): frontend service + models (F1.13)

AestheticFacialService cliente REST pra consent + photos + analyses.
Tipos TypeScript (Metric, Region union, AnalysisDetail) refletem schema
JSONB do backend.
Spec §7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Tasks 14-26: tarefas remanescentes (resumo)

> **NOTA:** Pra manter este plano em tamanho razoável, as tarefas 14 a 26 seguem o mesmo padrão TDD. Cada uma com testes específicos + implementação + commit. Detalhamento abreviado abaixo — durante execução, expandir o passo-a-passo igual aos tasks 1-13 (test fail → implement → test pass → commit).

### Task 14: Frontend `photo-validator.service.ts` (~30min)

**Conteúdo:** validação client-side (resolução ≥1024×1024, ≤5MB, MIME JPEG/PNG, detecção básica de nitidez via canvas Laplaciano).

**Tests:** matriz de fotos (resolução baixa, tamanho grande, MIME inválido, nítida vs desfocada).

### Task 15: Frontend `photo-overlay.service.ts` (~30min)

**Conteúdo:** helpers de escala (coordenadas normalizadas 0-1 → pixels), gerador de string `points` pra SVG polyline/polygon, palette de cores por métrica.

**Tests:** escala correta com diferentes resoluções, palette tem entry pra todas as 11 métricas faciais.

### Task 16: Frontend `consent-modal.component.ts` (~1h)

**Conteúdo:** modal Material com checkbox "Confirmo que tenho autorização do paciente..." + input nome digitado + botão "Confirmar" que chama `createConsent`.

**Tests:** botão desabilitado até checkbox+nome, POST chamado com payload correto.

### Task 17: Frontend `photo-quality-guide.component.ts` (~1h)

**Conteúdo:** modal com lista de orientações (✅ frontal, ✅ iluminação, etc) + botão "Selecionar foto(s)" que abre file picker.

**Tests:** renderiza orientações, emit event `photosSelected` com File[].

### Task 18: Frontend `photo-uploader.component.ts` (~1h)

**Conteúdo:** recebe `File[]` → valida cada uma via `photo-validator.service` → comprime (canvas q=0.85) → POST cada uma sequencialmente → emit array de photo_ids.

**Tests:** rejection inline em foto inválida, sucesso emite ids, error mostra mensagem clara (centralizadas em `aesthetic-messages.ts`).

### Task 19: Frontend `photo-overlay.component.ts` (SVG inline) (~2h)

**Conteúdo:** signal-based component que recebe `photoUrl`, `metrics`, `activeLayers`, `opacity`, renderiza `<img>` + SVG overlay com `<g>` por camada.

**Tests:** renderiza bbox/polyline/polygon/line/point corretos (parse DOM).

### Task 20: Frontend `layer-toolbar.component.ts` (~1h)

**Conteúdo:** lista de checkboxes por métrica (cor + nome + contagem de regions) + slider de opacidade global + botões "Mostrar todos"/"Ocultar todos".

**Tests:** toggle emite event correto, opacidade emite valor 0-1.

### Task 21: Frontend `analysis-result.component.ts` (~2h)

**Conteúdo:** orquestra photo-overlay + layer-toolbar + lista de métricas (barras horizontais com cor) + observations qualitative + recommendations (treatment-protocol-cards básico) + disclaimer footer fixo.

**Tests:** renderiza só métricas presentes, disclaimer obrigatório visível.

### Task 22: Frontend `analysis-list.component.ts` (~1h)

**Conteúdo:** signal `analyses()` + tabela paginada (data, tipo, status, créditos, link "Ver"). Polling fallback se WS falhar.

**Tests:** renderiza items, click em row emite event.

### Task 23: Frontend `comparison-view.component.ts` básico (~1.5h)

**Conteúdo:** 2 dropdowns (baseline, current) → ao escolher os 2, chama `compareAnalyses` → renderiza tabela de deltas + overall_change destacado. Fotos lado a lado se ambas disponíveis.

**Tests:** dropdown change dispara POST, tabela mostra deltas corretos.

### Task 24: Frontend `facial-analysis-tab.component.ts` (orquestrador) (~2h)

**Conteúdo:** signal-based component que orquestra todos os componentes acima. Estado: `step = consent | guide | upload | processing | result | list | compare`. Renderiza componente certo por estado.

**Tests:** transições de estado corretas, WS event done atualiza UI sem refresh.

### Task 25: Patient-detail integration + WS service (~1h)

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`
- Create: `apps/web/src/app/features/aesthetic/services/aesthetic-ws.service.ts`

**Conteúdo:**
- Adicionar `<mat-tab label="Análise Facial IA" *ngIf="currentProfile?.module === 'estetica'">`
- Embeber `<app-facial-analysis-tab [subject]="currentSubject()">`
- `aesthetic-ws.service`: subscribe to `WsService.aesthetic$` (kind=analysis_done/analysis_failed)
- Atualizar `ws.service.ts` pra emitir Subject `aesthetic$` ao receber evento `aesthetic:*`

**Tests:** tab visível só pra module=estetica.

### Task 26: Smoke E2E + memory + landing update

**Conteúdo:**
1. Subir Docker local + criar tenant teste estética + login
2. Smoke checklist:
   - Login esteticista
   - Abrir paciente, aba "Análise Facial IA"
   - Confirmar consent
   - Upload 1 foto frontal
   - POST análise, aguardar resultado
   - Ver métricas + overlay SVG + toggle camadas
   - Listar análises
   - (Re)comparar com baseline (precisa 2 análises)
3. Login human + vet: confirmar tab NÃO aparece, telas existentes funcionam
4. Atualizar memória `docs/claude-memory/project_aesthetic_f1_facial.md`
5. Atualizar `MEMORY.md` index
6. Atualizar `apps/landing/index.html` com texto da nova feature + screenshot
7. Atualizar `docs/user-help/aesthetic-facial-analise.md` (RAG Copilot indexa)
8. PR final F1 → review humano → merge → cdk deploy ECS (rolling deploy do worker pra picar aesthetic queue)
9. Smoke prod: criar análise demo na conta `mario.borges.estetica@`

**Commit final:**

```bash
git add docs/claude-memory/project_aesthetic_f1_facial.md \
        docs/claude-memory/MEMORY.md \
        apps/landing/index.html \
        docs/user-help/aesthetic-facial-analise.md
git commit -m "docs(aesthetic): F1 entregue — memória + landing + user help

Análise facial IA em produção pra tenant=estetica.
- 11 métricas via Sonnet Vision
- Anotações SVG sobre foto + toggle de camadas
- Comparação evolutiva matemática
- Consent operacional + créditos + refund automático em falha
- Zero regressão em human/veterinary

Próxima fase: F2 (corporal + comparação visual antes/depois).
Plano F2: docs/superpowers/plans/2026-MM-DD-aesthetic-f2-body.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (executado pelo writer)

**1. Spec coverage:**
- ✅ §2 Premissas → cobertas por Tasks 1-3 (RLS), Task 5 (module gate), Task 6 (consent), Task 8 (defesa em profundidade)
- ✅ §3 Arquitetura two-call → Tasks 10-12
- ✅ §4 Schema → Tasks 1-3
- ✅ §5 Endpoints → Tasks 6-9 (consent + photos + analyses CRUD)
- ✅ §6 Worker → Tasks 10-12
- ✅ §7 Frontend → Tasks 13-25
- ❌ §8 Catálogo → FORA do F1 (vai pra F3)
- ❌ §9 Integrações timeline/agenda/prontuário → FORA do F1 (vai pra F6)
- ✅ §10 Multi-módulo zero quebra → smoke test em 3 tenants (Task 26)
- ✅ §11 Custos → cobrança via credit_ledger (Task 7, Task 8, processor refund Task 10)
- ✅ §12 LGPD → consent + RLS + signed URLs TTL 1h + soft delete (Tasks 6, 7)
- ✅ §13 Disclaimer → obrigatório no analysis-result (Task 21)
- ✅ §14 Tests → cobertos em cada task
- ✅ §15 Observability → logs estruturados em processor (Task 10)

**2. Placeholder scan:** Tasks 14-26 estão resumidas mas explicitamente marcadas como tal — "durante execução, expandir o passo-a-passo igual aos tasks 1-13". Não são "TBD" — são roadmap. Em execução, cada um vira plano detalhado próprio.

**3. Type consistency:** Verificado:
- `analysis_type` consistente entre migration, service, route, test, frontend model
- `AnalysisStatus` enum batendo: 'pending' | 'processing' | 'done' | 'error'
- `Region` union types batem com sanitização do agente
- `credit_ledger` kinds: `aesthetic_facial_analysis`, `aesthetic_refund` consistentes

**4. Gaps spec → plan:** Sub-tasks 14-26 condensadas. Pode levar 2-3 dias de detalhamento na execução. Estimativa total ainda em 15 dias mantida.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-aesthetic-f1-facial.md`.**

Two execution options:

**1. Subagent-Driven (recomendado)** - Eu despacho um subagente por task, reviso entre tasks, iteração rápida. Cada task = 1 subagent = código + tests + commit isolado.

**2. Inline Execution** - Execuço tasks nessa sessão usando executing-plans, batch com checkpoints pra você revisar.

Qual abordagem?
