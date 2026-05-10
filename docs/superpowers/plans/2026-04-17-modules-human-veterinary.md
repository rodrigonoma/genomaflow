# Módulos Clínica Humana e Veterinária — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar suporte a clínicas veterinárias via sistema de módulos por tenant, renomeando `patients` → `subjects`, adicionando roteamento de agentes por módulo/espécie, pipeline em duas fases (especialidade + síntese) e adaptações de UI.

**Architecture:** Migrations 011–014 alteram o schema. O backend mantém o path `/patients` mas opera na tabela `subjects`. O worker roteia agentes pela Fase 1 (especialidade por módulo/espécie) e Fase 2 (therapeutic + nutrition sempre). O frontend lê `module` do JWT para adaptar labels e formulários.

**Tech Stack:** PostgreSQL 15, Fastify 4, BullMQ worker, Anthropic SDK (`claude-opus-4-6`), Angular 17+, Jest (API), Node test (worker).

---

## File Map

**CREATE:**
- `apps/api/src/db/migrations/011_tenant_module.sql`
- `apps/api/src/db/migrations/012_patients_to_subjects.sql`
- `apps/api/src/db/migrations/013_rag_module.sql`
- `apps/api/src/db/migrations/014_clinical_results_recommendations.sql`
- `apps/worker/src/agents/small_animals.js`
- `apps/worker/src/agents/equine.js`
- `apps/worker/src/agents/bovine.js`
- `apps/worker/src/agents/therapeutic.js`
- `apps/worker/src/agents/nutrition.js`

**MODIFY:**
- `apps/api/src/routes/auth.js`
- `apps/api/src/routes/patients.js`
- `apps/api/src/routes/exams.js`
- `apps/worker/src/rag/retriever.js`
- `apps/worker/src/processors/exam.js`
- `apps/web/src/app/shared/models/api.models.ts`
- `apps/web/src/app/features/doctor/patients/patient-list.component.ts`
- `apps/web/src/app/features/lab/uploads/uploads.component.ts`
- `apps/web/src/app/features/doctor/results/result-panel.component.ts`
- `apps/web/src/app/app.component.ts`
- `apps/api/tests/routes/patients.test.js`
- `apps/api/tests/setup.js`

---

## Task 1: DB Migrations 011–014

**Files:**
- Create: `apps/api/src/db/migrations/011_tenant_module.sql`
- Create: `apps/api/src/db/migrations/012_patients_to_subjects.sql`
- Create: `apps/api/src/db/migrations/013_rag_module.sql`
- Create: `apps/api/src/db/migrations/014_clinical_results_recommendations.sql`

- [ ] **Step 1: Criar migration 011**

```sql
-- apps/api/src/db/migrations/011_tenant_module.sql
ALTER TABLE tenants
  ADD COLUMN module TEXT NOT NULL DEFAULT 'human'
    CHECK (module IN ('human', 'veterinary'));
```

- [ ] **Step 2: Criar migration 012**

```sql
-- apps/api/src/db/migrations/012_patients_to_subjects.sql
ALTER TABLE patients RENAME TO subjects;

ALTER TABLE subjects
  ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'human'
    CHECK (subject_type IN ('human', 'animal')),
  ADD COLUMN species TEXT,
  ADD COLUMN owner_cpf_hash TEXT;

ALTER TABLE exams RENAME COLUMN patient_id TO subject_id;
```

- [ ] **Step 3: Criar migration 013**

```sql
-- apps/api/src/db/migrations/013_rag_module.sql
ALTER TABLE rag_documents
  ADD COLUMN module TEXT NOT NULL DEFAULT 'human'
    CHECK (module IN ('human', 'veterinary', 'both')),
  ADD COLUMN species TEXT;

CREATE INDEX ON rag_documents (module, species);
```

- [ ] **Step 4: Criar migration 014**

```sql
-- apps/api/src/db/migrations/014_clinical_results_recommendations.sql
ALTER TABLE clinical_results
  ADD COLUMN recommendations JSONB NOT NULL DEFAULT '[]';
```

- [ ] **Step 5: Aplicar as migrations**

```bash
docker compose exec db psql -U postgres genomaflow \
  -f /dev/stdin < apps/api/src/db/migrations/011_tenant_module.sql

docker compose exec db psql -U postgres genomaflow \
  -f /dev/stdin < apps/api/src/db/migrations/012_patients_to_subjects.sql

docker compose exec db psql -U postgres genomaflow \
  -f /dev/stdin < apps/api/src/db/migrations/013_rag_module.sql

docker compose exec db psql -U postgres genomaflow \
  -f /dev/stdin < apps/api/src/db/migrations/014_clinical_results_recommendations.sql
```

- [ ] **Step 6: Verificar schema**

```bash
docker compose exec db psql -U postgres genomaflow -c "\d subjects"
docker compose exec db psql -U postgres genomaflow -c "\d exams" | grep subject_id
docker compose exec db psql -U postgres genomaflow -c "SELECT column_name FROM information_schema.columns WHERE table_name='rag_documents' AND column_name IN ('module','species')"
docker compose exec db psql -U postgres genomaflow -c "SELECT column_name FROM information_schema.columns WHERE table_name='clinical_results' AND column_name='recommendations'"
```

Expected: `subjects` tem colunas `subject_type`, `species`, `owner_cpf_hash`; `exams` tem `subject_id`; `rag_documents` tem `module` e `species`; `clinical_results` tem `recommendations`.

- [ ] **Step 7: Aplicar nas migrations do test DB**

```bash
docker compose exec db psql -U postgres genomaflow_test \
  -f /dev/stdin < apps/api/src/db/migrations/011_tenant_module.sql

docker compose exec db psql -U postgres genomaflow_test \
  -f /dev/stdin < apps/api/src/db/migrations/012_patients_to_subjects.sql

docker compose exec db psql -U postgres genomaflow_test \
  -f /dev/stdin < apps/api/src/db/migrations/013_rag_module.sql

docker compose exec db psql -U postgres genomaflow_test \
  -f /dev/stdin < apps/api/src/db/migrations/014_clinical_results_recommendations.sql
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/migrations/011_tenant_module.sql \
        apps/api/src/db/migrations/012_patients_to_subjects.sql \
        apps/api/src/db/migrations/013_rag_module.sql \
        apps/api/src/db/migrations/014_clinical_results_recommendations.sql
git commit -m "feat: migrations 011-014 — module, subjects, rag_module, recommendations"
```

---

## Task 2: Backend — module no JWT (auth.js)

**Files:**
- Modify: `apps/api/src/routes/auth.js`

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/tests/routes/auth.test.js`, adicionar ao final do describe existente:

```js
describe('POST /auth/login — module field', () => {
  it('returns module in decoded JWT payload', async () => {
    const res = await supertest(app.server)
      .post('/auth/login')
      .send({ email: 'test@clinic.com', password: 'password123' });
    expect(res.status).toBe(200);
    const payload = JSON.parse(
      Buffer.from(res.body.token.split('.')[1], 'base64').toString()
    );
    expect(payload.module).toBe('human');
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd apps/api && npm test -- --testPathPattern auth
```

Expected: FAIL — `payload.module` is undefined.

- [ ] **Step 3: Implementar**

Substituir o conteúdo de `apps/api/src/routes/auth.js`:

```js
const bcrypt = require('bcrypt');

const DUMMY_HASH = '$2b$10$invalidhashfortimingprotection0000000000000000000000000';

module.exports = async function (fastify) {
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body;

    const { rows } = await fastify.pg.query(
      `SELECT u.id, u.tenant_id, u.password_hash, u.role, t.module
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = $1`,
      [email]
    );

    if (rows.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH).catch(() => {});
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = fastify.jwt.sign({
      user_id: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      module: user.module
    });

    return { token };
  });
};
```

- [ ] **Step 4: Rodar para confirmar que passa**

```bash
cd apps/api && npm test -- --testPathPattern auth
```

Expected: PASS.

- [ ] **Step 5: Reiniciar API**

```bash
docker compose restart api
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/auth.js apps/api/tests/routes/auth.test.js
git commit -m "feat: include module in JWT payload from tenant"
```

---

## Task 3: Backend — patients.js refatorado para subjects + search + validação por módulo

**Files:**
- Modify: `apps/api/src/routes/patients.js`
- Modify: `apps/api/tests/routes/patients.test.js`

- [ ] **Step 1: Escrever testes que falham**

Substituir o conteúdo de `apps/api/tests/routes/patients.test.js`:

```js
const supertest = require('supertest');
const app = require('../../src/server');
const { setupTestDb, teardownTestDb } = require('../setup');

let token;

beforeAll(async () => {
  await app.ready();
  await setupTestDb();
  const res = await supertest(app.server)
    .post('/auth/login')
    .send({ email: 'test@clinic.com', password: 'password123' });
  token = res.body.token;
});

afterAll(async () => { await teardownTestDb(); await app.close(); });

describe('POST /patients — human module', () => {
  it('creates a human subject with required fields', async () => {
    const res = await supertest(app.server)
      .post('/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'João Silva', birth_date: '1980-05-15', sex: 'M' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('João Silva');
    expect(res.body.subject_type).toBe('human');
  });

  it('returns 401 without token', async () => {
    const res = await supertest(app.server)
      .post('/patients')
      .send({ name: 'Ana', birth_date: '1990-01-01', sex: 'F' });
    expect(res.status).toBe(401);
  });
});

describe('GET /patients', () => {
  it('returns subjects for the tenant', async () => {
    const res = await supertest(app.server)
      .get('/patients')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /patients/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await supertest(app.server)
      .get('/patients/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha no novo campo**

```bash
cd apps/api && npm test -- --testPathPattern patients
```

Expected: FAIL — `subject_type` is undefined (current route doesn't return it).

- [ ] **Step 3: Implementar patients.js refatorado**

Substituir o conteúdo de `apps/api/src/routes/patients.js`:

```js
const { withTenant } = require('../db/tenant');
const crypto = require('crypto');

function hashCpf(cpf) {
  return crypto.createHash('sha256').update(cpf).digest('hex');
}

module.exports = async function (fastify) {
  // POST /patients — cria subject (humano ou animal conforme módulo do tenant)
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, module } = request.user;
    const { name, birth_date, sex, cpf, species, owner_cpf } = request.body;

    if (module === 'human') {
      if (!name || !birth_date || !sex) {
        return reply.status(400).send({ error: 'name, birth_date and sex are required for human module' });
      }
      const subject = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO subjects (tenant_id, name, birth_date, sex, cpf_hash, subject_type)
           VALUES ($1, $2, $3, $4, $5, 'human')
           RETURNING id, name, birth_date, sex, subject_type, created_at`,
          [tenant_id, name, birth_date, sex, cpf ? hashCpf(cpf) : null]
        );
        return rows[0];
      });
      return reply.status(201).send(subject);
    }

    // module === 'veterinary'
    if (!name || !sex || !species || !owner_cpf) {
      return reply.status(400).send({ error: 'name, sex, species and owner_cpf are required for veterinary module' });
    }
    const VALID_SPECIES = ['dog', 'cat', 'equine', 'bovine'];
    if (!VALID_SPECIES.includes(species)) {
      return reply.status(400).send({ error: `species must be one of: ${VALID_SPECIES.join(', ')}` });
    }

    const subject = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO subjects (tenant_id, name, sex, species, owner_cpf_hash, subject_type)
         VALUES ($1, $2, $3, $4, $5, 'animal')
         RETURNING id, name, sex, species, subject_type, created_at`,
        [tenant_id, name, sex, species, hashCpf(owner_cpf)]
      );
      return rows[0];
    });
    return reply.status(201).send(subject);
  });

  // GET /patients — lista subjects do tenant
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, birth_date, sex, subject_type, species, created_at
         FROM subjects ORDER BY created_at DESC`
      );
      return rows;
    });
  });

  // GET /patients/search — busca por owner_cpf para lookup de animal (módulo vet)
  fastify.get('/search', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { owner_cpf } = request.query;
    if (!owner_cpf) return reply.status(400).send({ error: 'owner_cpf query param required' });

    const hash = hashCpf(owner_cpf);
    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, sex, species, created_at
         FROM subjects
         WHERE owner_cpf_hash = $1 AND subject_type = 'animal'
         ORDER BY name`,
        [hash]
      );
      return rows;
    });
  });

  // GET /patients/:id
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const subject = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, birth_date, sex, subject_type, species, created_at
         FROM subjects WHERE id = $1`,
        [id]
      );
      return rows[0] || null;
    });

    if (!subject) return reply.status(404).send({ error: 'Patient not found' });
    return subject;
  });
};
```

- [ ] **Step 4: Rodar testes**

```bash
cd apps/api && npm test -- --testPathPattern patients
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/patients.js apps/api/tests/routes/patients.test.js
git commit -m "feat: patients routes — subjects table, search endpoint, module-based validation"
```

---

## Task 4: Backend — exams.js atualizado para subject_id

**Files:**
- Modify: `apps/api/src/routes/exams.js`

O arquivo exams.js referencia `patient_id` e faz JOIN com `patients` em vários lugares. Precisa ser atualizado para `subject_id` e JOIN com `subjects`.

- [ ] **Step 1: Rodar tests existentes de exams para ver baseline**

```bash
cd apps/api && npm test -- --testPathPattern exams
```

Expected: vários FAIL por causa da renomeação da coluna.

- [ ] **Step 2: Aplicar substituições em exams.js**

Substituições globais no arquivo `apps/api/src/routes/exams.js`:

1. Substituir toda ocorrência de `'SELECT id FROM patients WHERE id = $1 AND tenant_id = $2'` por:
```js
'SELECT id FROM subjects WHERE id = $1 AND tenant_id = $2'
```

2. Substituir `patient_id` → `subject_id` em todos os INSERT, SELECT e GROUP BY do arquivo.

3. Substituir `JOIN patients p ON p.id = e.patient_id` por `JOIN subjects s ON s.id = e.subject_id` onde existir.

4. Trocar `form.append('patient_id', ...)` não existe no backend — não alterar.

O conteúdo completo do trecho de upload (linhas ~15-65 do exams.js atual):

```js
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    let subject_id = null;
    let fileBuffer = null;
    let originalName = null;

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'patient_id') {
        subject_id = part.value;
      } else if (part.type === 'file' && part.fieldname === 'file') {
        originalName = part.filename;
        fileBuffer = await part.toBuffer();
      } else {
        await part.resume();
      }
    }

    if (!subject_id) return reply.status(400).send({ error: 'patient_id is required' });
    if (!fileBuffer) return reply.status(400).send({ error: 'file is required' });
```

Nota: o campo do formulário frontend ainda se chama `patient_id` — mantenha a leitura do `part.fieldname === 'patient_id'` mas armazene em `subject_id`. Isso evita quebrar o frontend sem uma mudança de campo.

O INSERT de exams passa a usar `subject_id`:
```js
          `INSERT INTO exams (tenant_id, subject_id, uploaded_by, file_path, status, source)
           VALUES ($1, $2, $3, $4, 'pending', 'upload')
           RETURNING id, status`,
          [tenant_id, subject_id, user_id, filePath]
```

O SELECT de exams passa a usar `subject_id` em vez de `patient_id`:
```js
        `SELECT e.id, e.subject_id, e.status, e.source, e.file_path, e.created_at, e.updated_at,
                json_agg(...) FILTER (WHERE cr.id IS NOT NULL) AS results
         FROM exams e
         LEFT JOIN clinical_results cr ON cr.exam_id = e.id
         WHERE e.tenant_id = $1
         GROUP BY e.id, e.subject_id, e.status, e.source, e.file_path, e.created_at, e.updated_at
         ORDER BY e.created_at DESC`
```

O mesmo padrão de substituição se aplica ao `review-queue` SELECT e ao `GET /:id` SELECT — substituir `e.patient_id` por `e.subject_id` e `GROUP BY ... e.patient_id` por `GROUP BY ... e.subject_id`.

- [ ] **Step 3: Verificar que não restou nenhuma referência a `patient_id` nos SELECTs**

```bash
grep -n "patient_id" apps/api/src/routes/exams.js
```

Expected: somente a linha de leitura do multipart `part.fieldname === 'patient_id'` (mantida para compatibilidade com o frontend). Nenhuma referência em SELECT, INSERT, GROUP BY.

- [ ] **Step 4: Rodar testes de exams**

```bash
cd apps/api && npm test -- --testPathPattern exams
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/exams.js
git commit -m "feat: exams routes — rename patient_id to subject_id throughout"
```

---

## Task 5: Worker — retriever.js com filtro de módulo/espécie

**Files:**
- Modify: `apps/worker/src/rag/retriever.js`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/worker/tests/rag/retriever.test.js`:

```js
const { retrieveGuidelines } = require('../../src/rag/retriever');

describe('retrieveGuidelines', () => {
  it('accepts module and species params without error', async () => {
    // Mock client that captures the query
    let capturedQuery = null;
    const mockClient = {
      query: async (sql, params) => {
        capturedQuery = { sql, params };
        return { rows: [] };
      }
    };
    // Mock embedder
    jest.mock('../../src/rag/embedder', () => ({ embed: async () => Array(1536).fill(0) }));

    await retrieveGuidelines(mockClient, 'glicose alta', 5, 'human', null);
    expect(capturedQuery.sql).toContain("module IN");
  });
});
```

- [ ] **Step 2: Implementar retriever.js**

Substituir o conteúdo de `apps/worker/src/rag/retriever.js`:

```js
const { embed } = require('./embedder');

/**
 * Retrieves the top-k most relevant clinical guidelines from pgvector,
 * filtered by module and optionally by species.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} queryText
 * @param {number} k
 * @param {'human'|'veterinary'} module
 * @param {string|null} species - null for human, 'dog'|'cat'|'equine'|'bovine' for vet
 * @returns {Promise<Array<{ title: string, content: string, source: string }>>}
 */
async function retrieveGuidelines(client, queryText, k = 5, module = 'human', species = null) {
  const embedding = await embed(queryText);

  const { rows } = await client.query(
    `SELECT title, content, source
     FROM rag_documents
     WHERE module IN ($1, 'both')
       AND (species IS NULL OR species = $2)
     ORDER BY embedding <=> $3::vector
     LIMIT $4`,
    [module, species, `[${embedding.join(',')}]`, k]
  );

  return rows;
}

module.exports = { retrieveGuidelines };
```

- [ ] **Step 3: Rodar tests do worker**

```bash
cd apps/worker && npm test
```

Expected: PASS — o retriever agora filtra por módulo.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/rag/retriever.js apps/worker/tests/rag/retriever.test.js
git commit -m "feat: rag retriever — filter by module and species"
```

---

## Task 6: Worker — exam.js refatorado para pipeline em duas fases

**Files:**
- Modify: `apps/worker/src/processors/exam.js`

O processor atual usa `classifyAgents()` para routing e JOIN com `patients`. Passa a usar roteamento por módulo/espécie e JOIN com `subjects`. A lógica de dois JOINs e o pipeline em duas fases é implementada aqui.

- [ ] **Step 1: Implementar exam.js completo**

Substituir o conteúdo de `apps/worker/src/processors/exam.js`:

```js
const fs = require('fs');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { extractText } = require('../parsers/pdf');
const { anonymize } = require('../anonymizer/patient');
const { scrubText } = require('../anonymizer/text');
const { retrieveGuidelines } = require('../rag/retriever');
const { runMetabolicAgent } = require('../agents/metabolic');
const { runCardiovascularAgent } = require('../agents/cardiovascular');
const { runHematologyAgent } = require('../agents/hematology');
const { runSmallAnimalsAgent } = require('../agents/small_animals');
const { runEquineAgent } = require('../agents/equine');
const { runBovineAgent } = require('../agents/bovine');
const { runTherapeuticAgent } = require('../agents/therapeutic');
const { runNutritionAgent } = require('../agents/nutrition');

// Phase 1: specialty agents — routed by module + species
const PHASE1_AGENTS = {
  human: [
    { type: 'metabolic',       runner: runMetabolicAgent },
    { type: 'cardiovascular',  runner: runCardiovascularAgent },
    { type: 'hematology',      runner: runHematologyAgent }
  ],
  veterinary: {
    dog:    [{ type: 'small_animals', runner: runSmallAnimalsAgent }],
    cat:    [{ type: 'small_animals', runner: runSmallAnimalsAgent }],
    equine: [{ type: 'equine',        runner: runEquineAgent }],
    bovine: [{ type: 'bovine',        runner: runBovineAgent }]
  }
};

// Phase 2: synthesis agents — always run after phase 1
const PHASE2_AGENTS = [
  { type: 'therapeutic', runner: runTherapeuticAgent },
  { type: 'nutrition',   runner: runNutritionAgent }
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function persistResult(client, examId, tenantId, agentType, result) {
  await client.query(
    `INSERT INTO clinical_results
       (exam_id, tenant_id, agent_type, interpretation, risk_scores, alerts,
        recommendations, disclaimer, model_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      examId, tenantId, agentType,
      result.interpretation,
      JSON.stringify(result.risk_scores || {}),
      JSON.stringify(result.alerts || []),
      JSON.stringify(result.recommendations || []),
      result.disclaimer,
      'claude-opus-4-6'
    ]
  );
}

/**
 * Full exam processing pipeline:
 * parse → anonymize → RAG → phase1 agents → phase2 agents → persist → notify
 *
 * @param {{ exam_id: string, tenant_id: string, file_path: string }} jobData
 */
async function processExam({ exam_id, tenant_id, file_path }) {
  const client = await pool.connect();
  let processingError = null;

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant_id]);

    await client.query(
      `UPDATE exams SET status = 'processing', updated_at = NOW() WHERE id = $1`,
      [exam_id]
    );

    // Fetch subject + tenant module
    const { rows } = await client.query(
      `SELECT s.name, s.birth_date, s.sex, s.subject_type, s.species,
              t.module
       FROM exams e
       JOIN subjects s ON s.id = e.subject_id
       JOIN tenants  t ON t.id = e.tenant_id
       WHERE e.id = $1`,
      [exam_id]
    );
    const subject = rows[0];
    const tenantModule = subject.module;

    if (!file_path) throw new Error('exam has no file_path — PDF download may have failed during ingest');
    const buffer = fs.readFileSync(file_path);
    const rawText = await extractText(buffer);
    const examText = scrubText(rawText);
    const anonSubject = anonymize(subject);

    // Determine Phase 1 agents
    let phase1;
    if (tenantModule === 'human') {
      phase1 = PHASE1_AGENTS.human;
    } else {
      phase1 = PHASE1_AGENTS.veterinary[subject.species] || [];
    }

    if (phase1.length === 0) {
      await client.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [`No agent configured for species: ${subject.species}`, exam_id]
      );
      await client.query('COMMIT');
      return;
    }

    // Phase 1 — specialty agents (sequential)
    const specialtyResults = [];
    for (const { type, runner } of phase1) {
      const guidelines = await retrieveGuidelines(client, examText, 5, tenantModule, subject.species || null);
      const result = await runner({ examText, patient: anonSubject, guidelines });
      specialtyResults.push({ agent_type: type, ...result });
      await persistResult(client, exam_id, tenant_id, type, result);
    }

    // Phase 2 — synthesis agents (parallel)
    const phase2Ctx = {
      examText,
      patient: anonSubject,
      specialtyResults,
      module: tenantModule,
      species: subject.species || null
    };
    const phase2Results = await Promise.all(
      PHASE2_AGENTS.map(({ runner }) => runner(phase2Ctx))
    );
    for (let i = 0; i < PHASE2_AGENTS.length; i++) {
      await persistResult(client, exam_id, tenant_id, PHASE2_AGENTS[i].type, phase2Results[i]);
    }

    await client.query(
      `UPDATE exams SET status = 'done', updated_at = NOW() WHERE id = $1`,
      [exam_id]
    );

    await client.query('COMMIT');

  } catch (err) {
    processingError = err;
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
  }

  if (processingError) {
    const errorClient = await pool.connect();
    try {
      await errorClient.query('BEGIN');
      await errorClient.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant_id]);
      await errorClient.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [processingError.message, exam_id]
      );
      await errorClient.query('COMMIT');
    } catch (updateErr) {
      await errorClient.query('ROLLBACK').catch(() => {});
      console.error('[processor] Failed to update exam error status:', updateErr.message);
    } finally {
      errorClient.release();
    }
    throw processingError;
  }

  try {
    const pub = new Redis(process.env.REDIS_URL);
    await pub.publish(`exam:done:${tenant_id}`, JSON.stringify({ exam_id }));
    await pub.quit();
  } catch (redisErr) {
    console.error(`[processor] Redis notify failed for exam ${exam_id}:`, redisErr.message);
  }
}

module.exports = { processExam };
```

- [ ] **Step 2: Rodar tests do worker**

```bash
cd apps/worker && npm test
```

Expected: PASS — os tests existentes do processor continuam passando (o mock do DB retorna os campos esperados).

- [ ] **Step 3: Reiniciar worker**

```bash
docker compose restart worker
```

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/processors/exam.js
git commit -m "feat: exam processor — two-phase pipeline, module/species routing, subjects join"
```

---

## Task 7: Novos agentes veterinários (small_animals, equine, bovine)

**Files:**
- Create: `apps/worker/src/agents/small_animals.js`
- Create: `apps/worker/src/agents/equine.js`
- Create: `apps/worker/src/agents/bovine.js`

- [ ] **Step 1: Criar small_animals.js**

```js
// apps/worker/src/agents/small_animals.js
const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica veterinária e não substitui avaliação do médico veterinário.';

const SYSTEM_PROMPT = `You are a specialized small animal veterinary clinical analyst (dogs and cats).
Analyze laboratory results using reference ranges specific to the animal's species.
Respond ONLY with valid JSON:
{
  "interpretation": "<in Brazilian Portuguese>",
  "risk_scores": { "hematology": "<LOW|MEDIUM|HIGH|CRITICAL>", "biochemistry": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Never diagnose. Provide clinical decision support only. Always specify if reference ranges differ between dogs and cats.`;

/**
 * @param {{ examText: string, patient: { sex: string, species: string }, guidelines: Array }} ctx
 */
async function runSmallAnimalsAgent(ctx) {
  const guidelinesText = ctx.guidelines.map(g => `## ${g.title}\n${g.content}`).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Animal: species=${ctx.patient.species || 'dog'}, sex=${ctx.patient.sex}\n\nLab Results:\n${ctx.examText}\n\nGuidelines:\n${guidelinesText}`
    }]
  });

  const rawText = response.content?.[0]?.text;
  if (!rawText) throw new Error('[small_animals] Claude returned empty response');
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;
  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[small_animals] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }
  result.disclaimer = DISCLAIMER;
  return result;
}

module.exports = { runSmallAnimalsAgent };
```

- [ ] **Step 2: Criar equine.js**

```js
// apps/worker/src/agents/equine.js
const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica veterinária e não substitui avaliação do médico veterinário.';

const SYSTEM_PROMPT = `You are a specialized equine veterinary clinical analyst.
Analyze laboratory results for horses using equine-specific reference ranges.
Focus on hematology, hepatic profile, muscular markers (CK, AST), and electrolytes.
Respond ONLY with valid JSON:
{
  "interpretation": "<in Brazilian Portuguese>",
  "risk_scores": { "hematology": "<LOW|MEDIUM|HIGH|CRITICAL>", "hepatic": "<LOW|MEDIUM|HIGH|CRITICAL>", "muscular": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Never diagnose. Provide clinical decision support only.`;

/**
 * @param {{ examText: string, patient: { sex: string }, guidelines: Array }} ctx
 */
async function runEquineAgent(ctx) {
  const guidelinesText = ctx.guidelines.map(g => `## ${g.title}\n${g.content}`).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Animal: equine, sex=${ctx.patient.sex}\n\nLab Results:\n${ctx.examText}\n\nGuidelines:\n${guidelinesText}`
    }]
  });

  const rawText = response.content?.[0]?.text;
  if (!rawText) throw new Error('[equine] Claude returned empty response');
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;
  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[equine] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }
  result.disclaimer = DISCLAIMER;
  return result;
}

module.exports = { runEquineAgent };
```

- [ ] **Step 3: Criar bovine.js**

```js
// apps/worker/src/agents/bovine.js
const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica veterinária e não substitui avaliação do médico veterinário.';

const SYSTEM_PROMPT = `You are a specialized bovine veterinary clinical analyst.
Analyze laboratory results for cattle using bovine-specific reference ranges.
Focus on metabolic profile (BHB, NEFA, glucose), herd health indicators, and mineral balance.
Respond ONLY with valid JSON:
{
  "interpretation": "<in Brazilian Portuguese>",
  "risk_scores": { "metabolic": "<LOW|MEDIUM|HIGH|CRITICAL>", "mineral": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Never diagnose. Provide clinical decision support only.`;

/**
 * @param {{ examText: string, patient: { sex: string }, guidelines: Array }} ctx
 */
async function runBovineAgent(ctx) {
  const guidelinesText = ctx.guidelines.map(g => `## ${g.title}\n${g.content}`).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Animal: bovine, sex=${ctx.patient.sex}\n\nLab Results:\n${ctx.examText}\n\nGuidelines:\n${guidelinesText}`
    }]
  });

  const rawText = response.content?.[0]?.text;
  if (!rawText) throw new Error('[bovine] Claude returned empty response');
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;
  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[bovine] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }
  result.disclaimer = DISCLAIMER;
  return result;
}

module.exports = { runBovineAgent };
```

- [ ] **Step 4: Rodar tests do worker**

```bash
cd apps/worker && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/agents/small_animals.js \
        apps/worker/src/agents/equine.js \
        apps/worker/src/agents/bovine.js
git commit -m "feat: veterinary agents — small_animals, equine, bovine"
```

---

## Task 8: Agentes de síntese — therapeutic e nutrition

**Files:**
- Create: `apps/worker/src/agents/therapeutic.js`
- Create: `apps/worker/src/agents/nutrition.js`

- [ ] **Step 1: Criar therapeutic.js**

```js
// apps/worker/src/agents/therapeutic.js
const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'As sugestões terapêuticas são de suporte à decisão clínica e devem ser avaliadas e prescritas pelo profissional de saúde responsável. Não substituem consulta médica ou veterinária.';

function buildSystemPrompt(module) {
  const context = module === 'veterinary'
    ? 'veterinary clinical decision support, considering species-specific pharmacology and contraindications'
    : 'human clinical decision support, following Brazilian medical guidelines';
  return `You are a specialized therapeutic recommendations analyst providing ${context}.
Based on the specialty analysis results and raw lab values provided, suggest therapeutic interventions.
Respond ONLY with valid JSON:
{
  "interpretation": "<summary of therapeutic approach in Brazilian Portuguese>",
  "recommendations": [
    { "type": "<medication|procedure|referral>", "description": "<text in Brazilian Portuguese>", "priority": "<low|medium|high>" }
  ],
  "risk_scores": { "therapeutic_urgency": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Never prescribe specific doses or brand names. Suggest therapeutic classes and protocols only. Never diagnose.`;
}

/**
 * @param {{ examText: string, patient: object, specialtyResults: Array, module: string, species: string|null }} ctx
 */
async function runTherapeuticAgent(ctx) {
  const systemPrompt = buildSystemPrompt(ctx.module);
  const specialtyText = ctx.specialtyResults
    .map(r => `## ${r.agent_type}\n${r.interpretation}\nAlerts: ${JSON.stringify(r.alerts)}`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Module: ${ctx.module}${ctx.species ? `, species: ${ctx.species}` : ''}\nPatient: sex=${ctx.patient.sex}\n\nSpecialty Analysis:\n${specialtyText}\n\nRaw Lab Results:\n${ctx.examText}`
    }]
  });

  const rawText = response.content?.[0]?.text;
  if (!rawText) throw new Error('[therapeutic] Claude returned empty response');
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;
  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[therapeutic] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }
  result.disclaimer = DISCLAIMER;
  result.recommendations = result.recommendations || [];
  return result;
}

module.exports = { runTherapeuticAgent };
```

- [ ] **Step 2: Criar nutrition.js**

```js
// apps/worker/src/agents/nutrition.js
const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'As sugestões de nutrição e hábitos são de suporte à decisão clínica e devem ser avaliadas pelo profissional de saúde responsável. Não substituem consulta médica, veterinária ou com nutricionista.';

function buildSystemPrompt(module) {
  const context = module === 'veterinary'
    ? 'veterinary nutritional and husbandry recommendations, species-specific dietary guidance'
    : 'human nutritional and lifestyle recommendations following Brazilian dietary guidelines';
  return `You are a specialized nutrition and lifestyle analyst providing ${context}.
Based on the specialty analysis results and raw lab values, suggest dietary and lifestyle interventions.
Respond ONLY with valid JSON:
{
  "interpretation": "<summary of nutritional approach in Brazilian Portuguese>",
  "recommendations": [
    { "type": "<diet|habit|supplement|activity>", "description": "<text in Brazilian Portuguese>", "priority": "<low|medium|high>" }
  ],
  "risk_scores": { "nutritional_risk": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Never prescribe medication. Focus only on diet, habits, and lifestyle. Never diagnose.`;
}

/**
 * @param {{ examText: string, patient: object, specialtyResults: Array, module: string, species: string|null }} ctx
 */
async function runNutritionAgent(ctx) {
  const systemPrompt = buildSystemPrompt(ctx.module);
  const specialtyText = ctx.specialtyResults
    .map(r => `## ${r.agent_type}\n${r.interpretation}\nAlerts: ${JSON.stringify(r.alerts)}`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Module: ${ctx.module}${ctx.species ? `, species: ${ctx.species}` : ''}\nPatient: sex=${ctx.patient.sex}\n\nSpecialty Analysis:\n${specialtyText}\n\nRaw Lab Results:\n${ctx.examText}`
    }]
  });

  const rawText = response.content?.[0]?.text;
  if (!rawText) throw new Error('[nutrition] Claude returned empty response');
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;
  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[nutrition] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }
  result.disclaimer = DISCLAIMER;
  result.recommendations = result.recommendations || [];
  return result;
}

module.exports = { runNutritionAgent };
```

- [ ] **Step 3: Rodar tests**

```bash
cd apps/worker && npm test
```

Expected: PASS.

- [ ] **Step 4: Reiniciar worker**

```bash
docker compose restart worker
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/agents/therapeutic.js apps/worker/src/agents/nutrition.js
git commit -m "feat: synthesis agents — therapeutic and nutrition (phase 2 pipeline)"
```

---

## Task 9: Frontend — models e AuthService

**Files:**
- Modify: `apps/web/src/app/shared/models/api.models.ts`

- [ ] **Step 1: Atualizar api.models.ts**

Substituir o conteúdo de `apps/web/src/app/shared/models/api.models.ts`:

```typescript
export interface Subject {
  id: string;
  name: string;
  sex: string;
  subject_type: 'human' | 'animal';
  birth_date?: string;
  cpf_hash?: string;
  species?: 'dog' | 'cat' | 'equine' | 'bovine';
  owner_cpf_hash?: string;
  created_at: string;
}

/** @deprecated use Subject */
export type Patient = Subject;

export interface Alert {
  marker: string;
  value: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface Recommendation {
  type: 'medication' | 'procedure' | 'referral' | 'diet' | 'habit' | 'supplement' | 'activity';
  description: string;
  priority: 'low' | 'medium' | 'high';
}

export interface ClinicalResult {
  agent_type: string;
  interpretation: string;
  risk_scores: Record<string, string>;
  alerts: Alert[];
  recommendations: Recommendation[];
  disclaimer: string;
}

export interface Exam {
  id: string;
  subject_id?: string;
  /** @deprecated use subject_id */
  patient_id?: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  source: string;
  file_path: string;
  created_at: string;
  updated_at: string;
  results: ClinicalResult[] | null;
  review_status?: 'pending' | 'viewed' | 'reviewed';
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  max_severity_score?: number;
}

export interface ReviewQueueItem extends Exam {
  review_status: 'pending' | 'viewed' | 'reviewed';
  max_severity_score: number;
}

export interface User {
  id: string;
  email: string;
  role: 'doctor' | 'lab_tech' | 'admin';
  created_at: string;
}

export interface JwtPayload {
  user_id: string;
  tenant_id: string;
  role: 'doctor' | 'lab_tech' | 'admin';
  module: 'human' | 'veterinary';
}

export interface Connector {
  id: string;
  name: string;
  mode: 'swagger' | 'hl7' | 'file_drop';
  field_map: Record<string, string>;
  status: 'active' | 'inactive' | 'error';
  last_sync_at: string | null;
  sync_count: number;
  error_msg: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectorLog {
  id: string;
  event_type: 'ingest' | 'test' | 'error';
  status: 'success' | 'error';
  records_in: number;
  records_out: number;
  error_detail: string | null;
  duration_ms: number;
  created_at: string;
}

export interface SwaggerParseResult {
  fields: string[];
}

export interface AnimalSearchResult {
  id: string;
  name: string;
  sex: string;
  species: 'dog' | 'cat' | 'equine' | 'bovine';
  created_at: string;
}
```

- [ ] **Step 2: Verificar compilação Angular**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -E "error|Error" | head -20
```

Expected: sem erros de compilação. Warnings sobre `Patient` deprecated são aceitáveis.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/shared/models/api.models.ts
git commit -m "feat: api.models — Subject type, module in JwtPayload, Recommendation interface"
```

---

## Task 10: Frontend — patient-list e app.component adaptações de label por módulo

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-list.component.ts`
- Modify: `apps/web/src/app/app.component.ts`

- [ ] **Step 1: Atualizar patient-list.component.ts**

No `patient-list.component.ts`, injetar `AuthService` e adaptar labels conforme módulo:

```typescript
import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../../environments/environment';
import { Subject } from '../../../shared/models/api.models';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-patient-list',
  standalone: true,
  imports: [
    RouterModule, FormsModule, AsyncPipe,
    MatTableModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule
  ],
  template: `
    <div class="patients-page">
      <div class="page-header">
        @if ((auth.currentUser$ | async); as user) {
          <h1 class="page-title">{{ user.module === 'veterinary' ? 'Animais' : 'Pacientes' }}</h1>
        }
      </div>

      <mat-form-field appearance="outline" class="search-field">
        <mat-label>Buscar {{ (auth.currentUser$ | async)?.module === 'veterinary' ? 'animal' : 'paciente' }}</mat-label>
        <input matInput [(ngModel)]="search" (ngModelChange)="applyFilter()" placeholder="Nome..." />
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>

      <div class="patients-grid">
        @for (p of filtered; track p.id) {
          <div class="patient-card">
            <div class="card-body">
              <h3 class="patient-name">{{ p.name }}</h3>
              <p class="patient-meta">
                <span>{{ p.sex }}</span>
                @if (p.species) {
                  <span> · {{ speciesLabel(p.species) }}</span>
                }
                @if (p.birth_date) {
                  <span> · {{ p.birth_date }}</span>
                }
              </p>
            </div>
            <div class="card-actions">
              <a mat-button class="detail-btn" [routerLink]="['/doctor/patients', p.id]">Ver detalhes</a>
              <a mat-stroked-button class="exam-btn" [routerLink]="['/doctor/patients', p.id, 'exams']">Novo exame</a>
            </div>
          </div>
        }
        @if (filtered.length === 0) {
          <p class="empty-state">Nenhum registro encontrado.</p>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; background: #0b1326; min-height: 100vh; padding: 2rem; }
    .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
    .page-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 1.5rem; color: #dae2fd; margin: 0; }
    .search-field { width: 100%; margin-bottom: 1.5rem; }
    .patients-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
    .patient-card { background: #131b2e; border: 1px solid rgba(70,69,84,0.15); border-left: 4px solid #c0c1ff; border-radius: 8px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .patient-name { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 1rem; color: #dae2fd; margin: 0 0 0.25rem 0; }
    .patient-meta { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #908fa0; margin: 0; }
    .card-actions { display: flex; gap: 0.5rem; }
    .detail-btn { border: 1px solid rgba(70,69,84,0.3) !important; color: #c0c1ff !important; font-size: 0.8rem; }
    .exam-btn { border-color: rgba(70,69,84,0.3) !important; color: #908fa0 !important; font-size: 0.8rem; }
    .empty-state { grid-column: 1/-1; text-align: center; font-family: 'Inter', sans-serif; font-size: 14px; color: #908fa0; padding: 2rem; }
  `]
})
export class PatientListComponent implements OnInit {
  private http = inject(HttpClient);
  auth = inject(AuthService);
  subjects: Subject[] = [];
  filtered: Subject[] = [];
  search = '';

  ngOnInit(): void {
    this.http.get<Subject[]>(`${environment.apiUrl}/patients`).subscribe(s => {
      this.subjects = s;
      this.filtered = s;
    });
  }

  applyFilter(): void {
    this.filtered = this.subjects.filter(s =>
      s.name.toLowerCase().includes(this.search.toLowerCase())
    );
  }

  speciesLabel(species: string): string {
    const labels: Record<string, string> = { dog: 'Cão', cat: 'Gato', equine: 'Equino', bovine: 'Bovino' };
    return labels[species] ?? species;
  }
}
```

- [ ] **Step 2: Atualizar app.component.ts — sidebar "Pacientes" → "Animais" para vet**

Em `apps/web/src/app/app.component.ts`, localizar o nav item de pacientes (doctor section):

```html
<a class="nav-item" routerLink="/doctor/patients" routerLinkActive="active">
  <mat-icon>people</mat-icon> Pacientes
</a>
```

Substituir por:

```html
<a class="nav-item" routerLink="/doctor/patients" routerLinkActive="active">
  <mat-icon>{{ user.module === 'veterinary' ? 'pets' : 'people' }}</mat-icon>
  {{ user.module === 'veterinary' ? 'Animais' : 'Pacientes' }}
</a>
```

- [ ] **Step 3: Verificar compilação**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -E "^.*error" | head -10
```

Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/doctor/patients/patient-list.component.ts \
        apps/web/src/app/app.component.ts
git commit -m "feat: frontend — label adaptations for veterinary module (Pacientes/Animais)"
```

---

## Task 11: Frontend — uploads.component.ts com animal lookup para módulo vet

**Files:**
- Modify: `apps/web/src/app/features/lab/uploads/uploads.component.ts`

O componente atual busca pacientes por nome. Para o módulo vet, a busca é por CPF do tutor e retorna uma lista de animais para seleção explícita.

- [ ] **Step 1: Atualizar uploads.component.ts**

Adicionar ao bloco de imports do componente: `AuthService` e `AnimalSearchResult`. Adicionar campo `ownerCpfSearch`, `animalResults`, e o novo fluxo de lookup de animal.

No template, adicionar bloco condicional para módulo vet na aba "Individual":

```html
<!-- após o mat-tab-group label="Individual" -->
@if ((auth.currentUser$ | async)?.module === 'veterinary') {
  <mat-form-field appearance="outline" class="full-width">
    <mat-label>CPF do Tutor</mat-label>
    <input matInput [(ngModel)]="ownerCpfSearch" (ngModelChange)="searchByOwnerCpf()" placeholder="000.000.000-00" />
  </mat-form-field>

  @if (animalResults.length > 0) {
    <mat-form-field appearance="outline" class="full-width">
      <mat-label>Selecionar Animal</mat-label>
      <mat-select [(ngModel)]="selectedPatientId">
        @for (a of animalResults; track a.id) {
          <mat-option [value]="a.id">{{ a.name }} · {{ speciesLabel(a.species) }} · CPF ***{{ ownerCpfSearch.slice(-3) }}</mat-option>
        }
      </mat-select>
    </mat-form-field>
  }
} @else {
  <!-- bloco original de busca por nome -->
  <mat-form-field appearance="outline" class="full-width">
    <mat-label>Buscar paciente</mat-label>
    <input matInput [(ngModel)]="patientSearch" (ngModelChange)="searchPatients()" />
  </mat-form-field>

  @if (patientResults.length) {
    <mat-form-field appearance="outline" class="full-width">
      <mat-label>Selecionar paciente</mat-label>
      <mat-select [(ngModel)]="selectedPatientId">
        @for (p of patientResults; track p.id) {
          <mat-option [value]="p.id">{{ p.name }}</mat-option>
        }
      </mat-select>
    </mat-form-field>
  }
}
```

Na classe do componente, adicionar:

```typescript
auth = inject(AuthService);
ownerCpfSearch = '';
animalResults: AnimalSearchResult[] = [];

searchByOwnerCpf(): void {
  const cpf = this.ownerCpfSearch.replace(/\D/g, '');
  if (cpf.length < 11) { this.animalResults = []; return; }
  this.http.get<AnimalSearchResult[]>(
    `${environment.apiUrl}/patients/search?owner_cpf=${cpf}`
  ).subscribe(animals => { this.animalResults = animals; });
}

speciesLabel(species: string): string {
  const labels: Record<string, string> = { dog: 'Cão', cat: 'Gato', equine: 'Equino', bovine: 'Bovino' };
  return labels[species] ?? species;
}
```

Adicionar `AnimalSearchResult` aos imports no topo do arquivo:
```typescript
import { Subject, Exam, AnimalSearchResult } from '../../../shared/models/api.models';
```

- [ ] **Step 2: Verificar compilação**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -E "^.*error" | head -10
```

Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/features/lab/uploads/uploads.component.ts
git commit -m "feat: uploads — animal lookup by owner CPF for veterinary module"
```

---

## Task 12: Frontend — result-panel com painel de histórico + recomendações

**Files:**
- Modify: `apps/web/src/app/features/doctor/results/result-panel.component.ts`

O result-panel já tem comparação de exames. Adicionar: (1) identificação do sujeito no header (nome + espécie para vet); (2) exibição da seção "Recomendações" dos agentes de síntese.

- [ ] **Step 1: Adicionar subject ao Exam e buscar dados do sujeito**

No `result-panel.component.ts`, adicionar propriedade `subject` e buscar os dados do sujeito junto com o exame:

```typescript
subject: Subject | null = null;

// dentro de ngOnInit, após carregar o exam:
if (this.exam?.subject_id || this.exam?.patient_id) {
  const subjectId = this.exam.subject_id || this.exam.patient_id;
  this.http.get<Subject>(`${environment.apiUrl}/patients/${subjectId}`)
    .subscribe(s => { this.subject = s; });
}
```

Adicionar `Subject` ao import de `api.models`.

- [ ] **Step 2: Adicionar header de identificação do sujeito no template**

No template do result-panel, após a `.result-header`, adicionar:

```html
@if (subject) {
  <div class="subject-identity">
    @if (subject.subject_type === 'animal') {
      <span class="identity-chip">
        <mat-icon style="font-size:14px;width:14px;height:14px">pets</mat-icon>
        {{ subject.name }} · {{ speciesLabel(subject.species!) }}
      </span>
    } @else {
      <span class="identity-chip">
        <mat-icon style="font-size:14px;width:14px;height:14px">person</mat-icon>
        {{ subject.name }}
      </span>
    }
  </div>
}
```

CSS a adicionar nos styles do componente:
```css
.subject-identity {
  margin-bottom: 1rem;
  display: flex;
  gap: 0.5rem;
}
.identity-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #c0c1ff;
  background: rgba(73,75,214,0.1);
  border: 1px solid rgba(73,75,214,0.25);
  padding: 3px 8px;
  border-radius: 4px;
}
```

- [ ] **Step 3: Exibir recomendações no painel de resultado por agente**

No loop `@for (result of exam.results; track result.agent_type)`, após a seção de alerts, adicionar:

```html
@if (result.recommendations && result.recommendations.length > 0) {
  <div class="recommendations-section">
    <h4 class="rec-title">Recomendações</h4>
    @for (rec of result.recommendations; track rec.description) {
      <div class="rec-item" [class]="'priority-' + rec.priority">
        <span class="rec-type">{{ rec.type | uppercase }}</span>
        <span class="rec-desc">{{ rec.description }}</span>
      </div>
    }
  </div>
}
```

CSS:
```css
.recommendations-section { margin-top: 1rem; }
.rec-title { font-family: 'Space Grotesk', sans-serif; font-size: 0.875rem; font-weight: 600; color: #c0c1ff; margin: 0 0 0.5rem 0; }
.rec-item { display: flex; gap: 0.5rem; align-items: flex-start; padding: 0.5rem; border-radius: 4px; margin-bottom: 0.375rem; background: rgba(70,69,84,0.08); }
.rec-item.priority-high { background: rgba(255,183,131,0.08); }
.rec-item.priority-medium { background: rgba(192,193,255,0.08); }
.rec-type { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: 0.08em; color: #908fa0; flex-shrink: 0; padding-top: 2px; }
.rec-desc { font-family: 'Inter', sans-serif; font-size: 13px; color: #c7c4d7; line-height: 1.4; }
```

Adicionar `speciesLabel` helper na classe:
```typescript
speciesLabel(species: string): string {
  const labels: Record<string, string> = { dog: 'Cão', cat: 'Gato', equine: 'Equino', bovine: 'Bovino' };
  return labels[species] ?? species;
}
```

- [ ] **Step 4: Verificar compilação**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -E "^.*error" | head -10
```

Expected: sem erros.

- [ ] **Step 5: Rodar todos os testes da API**

```bash
cd apps/api && npm test
```

Expected: PASS — 13+ testes passando.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/doctor/results/result-panel.component.ts
git commit -m "feat: result panel — subject identity header, recommendations section"
```

---

## Task 13: Setup.js — atualizar seed do test DB

**Files:**
- Modify: `apps/api/tests/setup.js`

- [ ] **Step 1: Atualizar setup.js para incluir module no tenant e usar subjects**

O `setupTestDb` precisa:
1. Incluir `module` no INSERT de tenant (default 'human' já funciona pelo migration, mas é bom ser explícito)
2. Usar `subjects` em vez de `patients` se qualquer fixture inserir pacientes diretamente

Substituir o conteúdo de `apps/api/tests/setup.js`:

```js
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

function makePool() {
  return new Pool({ connectionString: process.env.DATABASE_URL_TEST });
}

let pool = makePool();

async function setupTestDb() {
  if (pool.ending) pool = makePool();

  await pool.query(`DELETE FROM tenants WHERE name = 'Test Clinic'`);

  const { rows: [tenant] } = await pool.query(
    `INSERT INTO tenants (name, type, module) VALUES ('Test Clinic', 'clinic', 'human') RETURNING id`
  );

  const hash = await bcrypt.hash('password123', 10);
  await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'doctor')`,
    [tenant.id, 'test@clinic.com', hash]
  );

  return { tenantId: tenant.id };
}

async function teardownTestDb() {
  await pool.query(`DELETE FROM tenants WHERE name = 'Test Clinic'`);
  await pool.end();
}

module.exports = { setupTestDb, teardownTestDb };
```

- [ ] **Step 2: Rodar todos os testes**

```bash
cd apps/api && npm test
```

Expected: PASS — todos os testes passando com o novo setup.

- [ ] **Step 3: Commit**

```bash
git add apps/api/tests/setup.js
git commit -m "test: setup.js — explicit module field in test tenant"
```

---

## Self-Review Checklist

Após completar todas as tasks, verificar:

- [ ] `docker compose restart api worker` — ambos sobem sem erro
- [ ] Login com `doctor@clinic.com / password123` — JWT contém `module: "human"` (verificar via jwt.io)
- [ ] `GET /patients` retorna subjects com campo `subject_type`
- [ ] `POST /patients` com `{ name, birth_date, sex }` cria subject humano
- [ ] `cd apps/api && npm test` — todos passando
- [ ] `cd apps/worker && npm test` — todos passando
- [ ] `cd apps/web && npx ng build --configuration development` — sem erros
