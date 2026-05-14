# GenomaFlow Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete GenomaFlow backend: multi-tenant Fastify API, async BullMQ exam processing worker, Claude-powered clinical agents, and pgvector RAG guideline retrieval.

**Architecture:** Modular Fastify monolith (API) + separate BullMQ worker process. The API accepts PDF uploads, enqueues analysis jobs to Redis, and never calls Claude directly. The worker parses PDFs, anonymizes patient data (LGPD), retrieves clinical guidelines from pgvector, calls Claude for interpretation, persists results, and notifies the frontend via WebSocket. RLS at the PostgreSQL level enforces tenant isolation on every query.

**Tech Stack:** Node.js 20, Fastify 4, PostgreSQL 15 + pgvector, Redis, BullMQ, pdf-parse, @anthropic-ai/sdk, openai (embeddings), Jest, Supertest, Docker Alpine

---

> **Note:** The Angular frontend is a separate plan. This plan delivers a fully functional, tested backend API + worker.

---

## File Map

**apps/api/src/**
- `server.js` — modify: register plugins, routes, WebSocket
- `plugins/postgres.js` — create: pg pool, expose as `fastify.pg`
- `plugins/redis.js` — create: ioredis client, expose as `fastify.redis`
- `plugins/auth.js` — create: @fastify/jwt setup + `authenticate` decorator
- `plugins/pubsub.js` — create: Redis pub/sub → WebSocket bridge
- `routes/auth.js` — create: POST /auth/login
- `routes/patients.js` — create: CRUD /patients
- `routes/exams.js` — create: POST /exams, GET /exams/:id, WS /exams/subscribe
- `routes/alerts.js` — create: GET /alerts
- `db/migrate.js` — create: migration runner
- `db/tenant.js` — create: `withTenant(pg, tenantId, fn)` helper
- `db/migrations/000_extensions.sql`
- `db/migrations/001_tenants.sql`
- `db/migrations/002_users.sql`
- `db/migrations/003_patients.sql`
- `db/migrations/004_exams.sql`
- `db/migrations/005_clinical_results.sql`
- `db/migrations/006_rag_documents.sql`
- `db/migrations/007_rls_policies.sql`
- `db/seed-rag.js` — create: seed clinical guidelines into pgvector
- `package.json` — modify: add dependencies

**apps/worker/src/**
- `index.js` — create: BullMQ worker entry point
- `processors/exam.js` — create: full pipeline orchestrator
- `parsers/pdf.js` — create: PDF text extraction
- `anonymizer/patient.js` — create: strip PII (LGPD)
- `classifier/markers.js` — create: map exam text → agent names
- `rag/embedder.js` — create: generate embeddings via OpenAI
- `rag/retriever.js` — create: pgvector similarity search
- `agents/metabolic.js` — create: metabolic Claude agent
- `agents/cardiovascular.js` — create: cardiovascular Claude agent
- `agents/hematology.js` — create: hematology Claude agent
- `package.json` — create
- `Dockerfile` — create

**Infrastructure**
- `docker-compose.yml` — modify: pgvector image, worker service, upload volume
- `.env.example` — create
- `apps/agents/` — delete (replaced by worker/src/agents/)

**Tests**
- `apps/api/tests/setup.js`
- `apps/api/tests/routes/auth.test.js`
- `apps/api/tests/routes/patients.test.js`
- `apps/api/tests/routes/exams.test.js`
- `apps/api/tests/routes/alerts.test.js`
- `apps/worker/tests/parsers/pdf.test.js`
- `apps/worker/tests/anonymizer/patient.test.js`
- `apps/worker/tests/classifier/markers.test.js`
- `apps/worker/tests/agents/metabolic.test.js`
- `apps/worker/tests/agents/cardiovascular.test.js`
- `apps/worker/tests/agents/hematology.test.js`
- `apps/worker/tests/processors/exam.test.js`

---

### Task 1: Infrastructure Setup

**Files:**
- Modify: `docker-compose.yml`
- Create: `apps/worker/Dockerfile`
- Modify: `apps/api/package.json`
- Create: `apps/worker/package.json`
- Create: `.env.example`

- [ ] **Step 1: Replace docker-compose.yml**

```yaml
version: "3.9"

services:
  api:
    build: ./apps/api
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    volumes:
      - uploads:/tmp/uploads

  worker:
    build: ./apps/worker
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    volumes:
      - uploads:/tmp/uploads

  db:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: genomaflow
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:alpine

volumes:
  pgdata:
  uploads:
```

- [ ] **Step 2: Create apps/worker/Dockerfile**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY src ./src
CMD ["node", "src/index.js"]
```

- [ ] **Step 3: Replace apps/api/package.json**

```json
{
  "name": "genomaflow-api",
  "version": "1.0.0",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "migrate": "node src/db/migrate.js",
    "seed:rag": "node src/db/seed-rag.js",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "@fastify/jwt": "^8.0.1",
    "@fastify/multipart": "^8.3.0",
    "@fastify/websocket": "^8.3.1",
    "bcrypt": "^5.1.1",
    "bullmq": "^5.7.0",
    "fastify": "^4.27.0",
    "fastify-plugin": "^4.5.1",
    "ioredis": "^5.3.2",
    "pg": "^8.12.0"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 4: Create apps/worker/package.json**

```json
{
  "name": "genomaflow-worker",
  "version": "1.0.0",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.26.0",
    "bullmq": "^5.7.0",
    "ioredis": "^5.3.2",
    "openai": "^4.52.0",
    "pdf-parse": "^1.1.1",
    "pg": "^8.12.0"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

- [ ] **Step 5: Create .env.example**

```
DATABASE_URL=postgres://postgres:postgres@db:5432/genomaflow
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test
REDIS_URL=redis://redis:6379
JWT_SECRET=change_me_in_production
ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
OPENAI_API_KEY=sk-YOUR_OPENAI_KEY_HERE
UPLOADS_DIR=/tmp/uploads
```

- [ ] **Step 6: Copy .env.example and fill in real API keys**

```bash
cp .env.example .env
# Edit .env and fill in ANTHROPIC_API_KEY and OPENAI_API_KEY
```

- [ ] **Step 7: Install dependencies**

```bash
cd apps/api && npm install
cd ../worker && npm install
```

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml apps/worker/Dockerfile apps/api/package.json apps/worker/package.json .env.example
git commit -m "chore: infrastructure setup — pgvector, worker service, upload volume"
```

---

### Task 2: Database Migrations

**Files:**
- Create: `apps/api/src/db/migrations/000_extensions.sql`
- Create: `apps/api/src/db/migrations/001_tenants.sql`
- Create: `apps/api/src/db/migrations/002_users.sql`
- Create: `apps/api/src/db/migrations/003_patients.sql`
- Create: `apps/api/src/db/migrations/004_exams.sql`
- Create: `apps/api/src/db/migrations/005_clinical_results.sql`
- Create: `apps/api/src/db/migrations/006_rag_documents.sql`
- Create: `apps/api/src/db/migrations/007_rls_policies.sql`

- [ ] **Step 1: Create 000_extensions.sql**

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 2: Create 001_tenants.sql**

```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('clinic', 'lab', 'hospital')),
  plan TEXT NOT NULL DEFAULT 'starter',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 3: Create 002_users.sql**

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('doctor', 'lab_tech', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 4: Create 003_patients.sql**

```sql
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  birth_date DATE NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('M', 'F', 'other')),
  cpf_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 5: Create 004_exams.sql**

```sql
CREATE TABLE exams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'error')),
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'hl7', 'fhir')),
  file_path TEXT,
  raw_data JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 6: Create 005_clinical_results.sql**

```sql
CREATE TABLE clinical_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  interpretation TEXT NOT NULL,
  risk_scores JSONB NOT NULL DEFAULT '{}',
  alerts JSONB NOT NULL DEFAULT '[]',
  disclaimer TEXT NOT NULL DEFAULT 'Esta análise é um suporte à decisão clínica e não substitui avaliação médica profissional.',
  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 7: Create 006_rag_documents.sql**

```sql
CREATE TABLE rag_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON rag_documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

- [ ] **Step 8: Create 007_rls_policies.sql**

```sql
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON patients
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON exams
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON clinical_results
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/db/migrations/
git commit -m "feat: database schema with RLS tenant isolation and pgvector"
```

---

### Task 3: Migration Runner

**Files:**
- Create: `apps/api/src/db/migrate.js`

- [ ] **Step 1: Create apps/api/src/db/migrate.js**

```javascript
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT filename FROM _migrations WHERE filename = $1', [file]
      );
      if (rows.length > 0) { console.log(`[skip] ${file}`); continue; }

      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      console.log(`[apply] ${file}`);
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
    }

    console.log('Migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
```

- [ ] **Step 2: Create the test database and run migrations**

```bash
createdb -U postgres genomaflow_test 2>/dev/null || true
DATABASE_URL=postgres://postgres:postgres@localhost:5432/genomaflow node apps/api/src/db/migrate.js
DATABASE_URL=postgres://postgres:postgres@localhost:5432/genomaflow_test node apps/api/src/db/migrate.js
```

Expected: Each file logged as `[apply] 000_extensions.sql` etc., then "Migrations complete."

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/db/migrate.js
git commit -m "feat: database migration runner"
```

---

### Task 4: API Plugins and Server

**Files:**
- Create: `apps/api/src/plugins/postgres.js`
- Create: `apps/api/src/plugins/redis.js`
- Create: `apps/api/src/plugins/auth.js`
- Create: `apps/api/src/db/tenant.js`
- Modify: `apps/api/src/server.js`

- [ ] **Step 1: Create apps/api/src/plugins/postgres.js**

```javascript
const fp = require('fastify-plugin');
const { Pool } = require('pg');

module.exports = fp(async function (fastify) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  fastify.decorate('pg', pool);
  fastify.addHook('onClose', async () => pool.end());
});
```

- [ ] **Step 2: Create apps/api/src/plugins/redis.js**

```javascript
const fp = require('fastify-plugin');
const Redis = require('ioredis');

module.exports = fp(async function (fastify) {
  const redis = new Redis(process.env.REDIS_URL);
  fastify.decorate('redis', redis);
  fastify.addHook('onClose', async () => redis.quit());
});
```

- [ ] **Step 3: Create apps/api/src/plugins/auth.js**

```javascript
const fp = require('fastify-plugin');
const jwt = require('@fastify/jwt');

module.exports = fp(async function (fastify) {
  fastify.register(jwt, { secret: process.env.JWT_SECRET });

  fastify.decorate('authenticate', async function (request, reply) {
    await request.jwtVerify();
  });
});
```

- [ ] **Step 4: Create apps/api/src/db/tenant.js**

```javascript
/**
 * Executes fn(client) within a transaction with RLS tenant context set.
 * Commits on success, rolls back on error.
 *
 * @param {import('pg').Pool} pg
 * @param {string} tenantId
 * @param {function} fn - async (client) => result
 * @returns {Promise<any>}
 */
async function withTenant(pg, tenantId, fn) {
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.tenant_id = $1', [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withTenant };
```

- [ ] **Step 5: Replace apps/api/src/server.js**

```javascript
require('dotenv').config();
const Fastify = require('fastify');

const app = Fastify({ logger: true });

app.register(require('./plugins/postgres'));
app.register(require('./plugins/redis'));
app.register(require('./plugins/auth'));
app.register(require('@fastify/multipart'), {
  limits: { fileSize: 20 * 1024 * 1024 }
});
app.register(require('@fastify/websocket'));
app.register(require('./plugins/pubsub'));

app.register(require('./routes/auth'), { prefix: '/auth' });
app.register(require('./routes/patients'), { prefix: '/patients' });
app.register(require('./routes/exams'), { prefix: '/exams' });
app.register(require('./routes/alerts'), { prefix: '/alerts' });

if (require.main === module) {
  app.listen({ port: 3000, host: '0.0.0.0' });
}

module.exports = app;
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/plugins/ apps/api/src/db/tenant.js apps/api/src/server.js
git commit -m "feat: API plugins (postgres, redis, jwt) and withTenant helper"
```

---

### Task 5: Auth Route

**Files:**
- Create: `apps/api/tests/setup.js`
- Create: `apps/api/src/routes/auth.js`
- Create: `apps/api/tests/routes/auth.test.js`

- [ ] **Step 1: Create apps/api/tests/setup.js**

```javascript
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });

async function setupTestDb() {
  await pool.query(`DELETE FROM users WHERE email = 'test@clinic.com'`);
  await pool.query(`DELETE FROM tenants WHERE name = 'Test Clinic'`);

  const { rows: [tenant] } = await pool.query(
    `INSERT INTO tenants (name, type) VALUES ('Test Clinic', 'clinic') RETURNING id`
  );

  const hash = await bcrypt.hash('password123', 10);
  await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'doctor')`,
    [tenant.id, 'test@clinic.com', hash]
  );

  return { tenantId: tenant.id };
}

async function teardownTestDb() {
  await pool.query(`DELETE FROM users WHERE email = 'test@clinic.com'`);
  await pool.query(`DELETE FROM tenants WHERE name = 'Test Clinic'`);
  await pool.end();
}

module.exports = { setupTestDb, teardownTestDb };
```

- [ ] **Step 2: Create apps/api/tests/routes/auth.test.js**

```javascript
const supertest = require('supertest');
const app = require('../../src/server');
const { setupTestDb, teardownTestDb } = require('../setup');

beforeAll(async () => { await app.ready(); await setupTestDb(); });
afterAll(async () => { await teardownTestDb(); await app.close(); });

describe('POST /auth/login', () => {
  it('returns JWT for valid credentials', async () => {
    const res = await supertest(app.server)
      .post('/auth/login')
      .send({ email: 'test@clinic.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
  });

  it('returns 401 for wrong password', async () => {
    const res = await supertest(app.server)
      .post('/auth/login')
      .send({ email: 'test@clinic.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for unknown email', async () => {
    const res = await supertest(app.server)
      .post('/auth/login')
      .send({ email: 'nobody@test.com', password: 'password123' });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/auth.test.js --verbose
```

Expected: FAIL — "Cannot find module './routes/auth'" or route not found

- [ ] **Step 4: Create apps/api/src/routes/auth.js**

```javascript
const bcrypt = require('bcrypt');

module.exports = async function (fastify) {
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body;

    const { rows } = await fastify.pg.query(
      'SELECT id, tenant_id, password_hash, role FROM users WHERE email = $1',
      [email]
    );

    if (rows.length === 0) {
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
      role: user.role
    });

    return { token };
  });
};
```

- [ ] **Step 5: Create placeholder plugins/pubsub.js so server.js loads**

```javascript
const fp = require('fastify-plugin');
module.exports = fp(async function () {}); // filled in Task 14
```

- [ ] **Step 6: Create placeholder route files so server.js loads**

Create `apps/api/src/routes/patients.js`:
```javascript
module.exports = async function (fastify) {};
```

Create `apps/api/src/routes/exams.js`:
```javascript
module.exports = async function (fastify) {};
```

Create `apps/api/src/routes/alerts.js`:
```javascript
module.exports = async function (fastify) {};
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/auth.test.js --verbose
```

Expected: PASS (3 tests)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/ apps/api/src/plugins/pubsub.js apps/api/tests/
git commit -m "feat: POST /auth/login with JWT + bcrypt"
```

---

### Task 6: Patients Route

**Files:**
- Modify: `apps/api/src/routes/patients.js`
- Create: `apps/api/tests/routes/patients.test.js`

- [ ] **Step 1: Create apps/api/tests/routes/patients.test.js**

```javascript
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

describe('POST /patients', () => {
  it('creates a patient scoped to tenant', async () => {
    const res = await supertest(app.server)
      .post('/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'João Silva', birth_date: '1980-05-15', sex: 'M' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('João Silva');
  });

  it('returns 401 without token', async () => {
    const res = await supertest(app.server)
      .post('/patients')
      .send({ name: 'Ana', birth_date: '1990-01-01', sex: 'F' });
    expect(res.status).toBe(401);
  });
});

describe('GET /patients', () => {
  it('returns patients for the tenant', async () => {
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

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/patients.test.js --verbose
```

Expected: FAIL — routes return empty/404

- [ ] **Step 3: Replace apps/api/src/routes/patients.js**

```javascript
const { withTenant } = require('../db/tenant');

module.exports = async function (fastify) {
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { name, birth_date, sex, cpf_hash } = request.body;

    const patient = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO patients (tenant_id, name, birth_date, sex, cpf_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, birth_date, sex, created_at`,
        [tenant_id, name, birth_date, sex, cpf_hash || null]
      );
      return rows[0];
    });

    return reply.status(201).send(patient);
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, birth_date, sex, created_at FROM patients ORDER BY created_at DESC`
      );
      return rows;
    });
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const patient = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, birth_date, sex, created_at FROM patients WHERE id = $1`,
        [id]
      );
      return rows[0] || null;
    });

    if (!patient) return reply.status(404).send({ error: 'Patient not found' });
    return patient;
  });
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/patients.test.js --verbose
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/patients.js apps/api/tests/routes/patients.test.js
git commit -m "feat: patients CRUD with RLS tenant scoping"
```

---

### Task 7: Exams Route

**Files:**
- Modify: `apps/api/src/routes/exams.js`
- Create: `apps/api/tests/routes/exams.test.js`

- [ ] **Step 1: Create apps/api/tests/routes/exams.test.js**

```javascript
const supertest = require('supertest');
const path = require('path');
const fs = require('fs');
const app = require('../../src/server');
const { setupTestDb, teardownTestDb } = require('../setup');

let token;
let patientId;

beforeAll(async () => {
  await app.ready();
  await setupTestDb();

  const loginRes = await supertest(app.server)
    .post('/auth/login')
    .send({ email: 'test@clinic.com', password: 'password123' });
  token = loginRes.body.token;

  const patientRes = await supertest(app.server)
    .post('/patients')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Maria Teste', birth_date: '1975-03-20', sex: 'F' });
  patientId = patientRes.body.id;

  // Create fixture PDF file
  const fixturePath = path.join(__dirname, 'fixtures', 'test-exam.pdf');
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, '%PDF-1.4 Glicemia: 126 mg/dL');
});

afterAll(async () => { await teardownTestDb(); await app.close(); });

describe('POST /exams', () => {
  it('uploads exam PDF and returns pending status', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'test-exam.pdf');
    const res = await supertest(app.server)
      .post('/exams')
      .set('Authorization', `Bearer ${token}`)
      .field('patient_id', patientId)
      .attach('file', fixturePath);

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('exam_id');
    expect(res.body.status).toBe('pending');
  });

  it('returns 401 without token', async () => {
    const res = await supertest(app.server).post('/exams');
    expect(res.status).toBe(401);
  });
});

describe('GET /exams/:id', () => {
  it('returns exam status and id', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'test-exam.pdf');
    const uploadRes = await supertest(app.server)
      .post('/exams')
      .set('Authorization', `Bearer ${token}`)
      .field('patient_id', patientId)
      .attach('file', fixturePath);

    const res = await supertest(app.server)
      .get(`/exams/${uploadRes.body.exam_id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(uploadRes.body.exam_id);
    expect(['pending', 'processing', 'done', 'error']).toContain(res.body.status);
  });

  it('returns 404 for unknown exam', async () => {
    const res = await supertest(app.server)
      .get('/exams/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/exams.test.js --verbose
```

Expected: FAIL — routes return empty

- [ ] **Step 3: Replace apps/api/src/routes/exams.js**

```javascript
const path = require('path');
const fs = require('fs');
const { Queue } = require('bullmq');
const { withTenant } = require('../db/tenant');

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/uploads';

module.exports = async function (fastify) {
  const examQueue = new Queue('exam-processing', { connection: fastify.redis });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const parts = request.parts();

    let patient_id = null;
    let fileData = null;

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'patient_id') {
        patient_id = part.value;
      } else if (part.type === 'file' && part.fieldname === 'file') {
        fileData = part;
        break;
      }
    }

    if (!patient_id) return reply.status(400).send({ error: 'patient_id is required' });
    if (!fileData) return reply.status(400).send({ error: 'file is required' });

    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const filename = `${Date.now()}-${fileData.filename}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(filePath);
      fileData.file.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
    });

    const exam = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO exams (tenant_id, patient_id, uploaded_by, file_path, status, source)
         VALUES ($1, $2, $3, $4, 'pending', 'upload')
         RETURNING id, status`,
        [tenant_id, patient_id, user_id, filePath]
      );
      return rows[0];
    });

    await examQueue.add('process-exam', {
      exam_id: exam.id,
      tenant_id,
      file_path: filePath
    });

    return reply.status(202).send({ exam_id: exam.id, status: 'pending' });
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const exam = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT e.id, e.status, e.created_at, e.updated_at,
                json_agg(
                  json_build_object(
                    'agent_type', cr.agent_type,
                    'interpretation', cr.interpretation,
                    'risk_scores', cr.risk_scores,
                    'alerts', cr.alerts,
                    'disclaimer', cr.disclaimer
                  )
                ) FILTER (WHERE cr.id IS NOT NULL) AS results
         FROM exams e
         LEFT JOIN clinical_results cr ON cr.exam_id = e.id
         WHERE e.id = $1
         GROUP BY e.id`,
        [id]
      );
      return rows[0] || null;
    });

    if (!exam) return reply.status(404).send({ error: 'Exam not found' });
    return exam;
  });

  // WebSocket: subscribe to real-time exam updates for the authenticated tenant
  fastify.get('/subscribe', {
    websocket: true,
    preHandler: [fastify.authenticate]
  }, (connection, request) => {
    const { tenant_id } = request.user;
    fastify.registerWsClient(tenant_id, connection.socket);
  });
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/exams.test.js --verbose
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/exams.js apps/api/tests/routes/exams.test.js
git commit -m "feat: POST /exams upload + enqueue, GET /exams/:id status and results"
```

---

### Task 8: Alerts Route

**Files:**
- Modify: `apps/api/src/routes/alerts.js`
- Create: `apps/api/tests/routes/alerts.test.js`

- [ ] **Step 1: Create apps/api/tests/routes/alerts.test.js**

```javascript
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

describe('GET /alerts', () => {
  it('returns an array for authenticated tenant', async () => {
    const res = await supertest(app.server)
      .get('/alerts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 401 without token', async () => {
    const res = await supertest(app.server).get('/alerts');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/alerts.test.js --verbose
```

Expected: FAIL

- [ ] **Step 3: Replace apps/api/src/routes/alerts.js**

```javascript
const { withTenant } = require('../db/tenant');

module.exports = async function (fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    const { patient_id, severity } = request.query;

    return withTenant(fastify.pg, tenant_id, async (client) => {
      let query = `
        SELECT cr.alerts, cr.agent_type, cr.created_at,
               e.patient_id, p.name AS patient_name, cr.exam_id
        FROM clinical_results cr
        JOIN exams e ON e.id = cr.exam_id
        JOIN patients p ON p.id = e.patient_id
        WHERE cr.tenant_id = $1
      `;
      const params = [tenant_id];

      if (patient_id) {
        params.push(patient_id);
        query += ` AND e.patient_id = $${params.length}`;
      }

      query += ' ORDER BY cr.created_at DESC LIMIT 100';
      const { rows } = await client.query(query, params);

      return rows
        .flatMap(row =>
          (row.alerts || []).map(alert => ({
            ...alert,
            exam_id: row.exam_id,
            patient_id: row.patient_id,
            patient_name: row.patient_name,
            agent_type: row.agent_type,
            created_at: row.created_at
          }))
        )
        .filter(a => !severity || a.severity === severity);
    });
  });
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/alerts.test.js --verbose
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/alerts.js apps/api/tests/routes/alerts.test.js
git commit -m "feat: GET /alerts with tenant scoping and optional patient/severity filter"
```

---

### Task 9: WebSocket PubSub Plugin

**Files:**
- Modify: `apps/api/src/plugins/pubsub.js`

- [ ] **Step 1: Replace the placeholder apps/api/src/plugins/pubsub.js**

```javascript
const fp = require('fastify-plugin');
const Redis = require('ioredis');

module.exports = fp(async function (fastify) {
  const subscriber = new Redis(process.env.REDIS_URL);

  // tenantId → Set of open WebSocket connections
  const connections = new Map();

  fastify.decorate('registerWsClient', (tenantId, ws) => {
    if (!connections.has(tenantId)) connections.set(tenantId, new Set());
    connections.get(tenantId).add(ws);
    ws.on('close', () => connections.get(tenantId)?.delete(ws));
  });

  fastify.decorate('notifyTenant', (tenantId, data) => {
    const clients = connections.get(tenantId);
    if (!clients) return;
    const message = JSON.stringify(data);
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(message);
    }
  });

  // Worker publishes to `exam:done:<tenant_id>` after processing
  subscriber.psubscribe('exam:done:*', (err) => {
    if (err) fastify.log.error('Redis psubscribe error:', err);
  });

  subscriber.on('pmessage', (_pattern, channel, message) => {
    const tenantId = channel.replace('exam:done:', '');
    fastify.notifyTenant(tenantId, { event: 'exam:done', ...JSON.parse(message) });
  });

  fastify.addHook('onClose', async () => subscriber.quit());
});
```

- [ ] **Step 2: Run all API tests to confirm nothing broke**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest --verbose
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/plugins/pubsub.js
git commit -m "feat: Redis pub/sub to WebSocket bridge for real-time exam notifications"
```

---

### Task 10: Worker Foundation

**Files:**
- Create: `apps/worker/src/index.js`

- [ ] **Step 1: Create apps/worker/src/index.js**

```javascript
require('dotenv').config();
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { processExam } = require('./processors/exam');

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null
});

const worker = new Worker('exam-processing', async (job) => {
  console.log(`[worker] Processing job ${job.id}: exam ${job.data.exam_id}`);
  await processExam(job.data);
}, { connection, concurrency: 3 });

worker.on('completed', (job) => {
  console.log(`[worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job.id} failed: ${err.message}`);
});

console.log('[worker] Listening for exam-processing jobs...');
```

- [ ] **Step 2: Commit**

```bash
git add apps/worker/src/index.js
git commit -m "feat: BullMQ worker entry point"
```

---

### Task 11: PDF Parser

**Files:**
- Create: `apps/worker/src/parsers/pdf.js`
- Create: `apps/worker/tests/parsers/pdf.test.js`

- [ ] **Step 1: Create apps/worker/tests/parsers/pdf.test.js**

```javascript
jest.mock('pdf-parse', () => async (buf) => {
  if (buf.length === 0) return { text: '' };
  return { text: 'Glicemia: 126 mg/dL\nTSH: 5.2 mUI/L' };
});

const { extractText } = require('../../src/parsers/pdf');

describe('extractText', () => {
  it('returns text from a non-empty PDF buffer', async () => {
    const text = await extractText(Buffer.from('%PDF-1.4'));
    expect(typeof text).toBe('string');
    expect(text).toContain('Glicemia');
  });

  it('throws for an empty buffer', async () => {
    await expect(extractText(Buffer.alloc(0))).rejects.toThrow('Empty PDF content');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/worker && npx jest tests/parsers/pdf.test.js --verbose
```

Expected: FAIL — "Cannot find module '../../src/parsers/pdf'"

- [ ] **Step 3: Create apps/worker/src/parsers/pdf.js**

```javascript
const pdfParse = require('pdf-parse');

/**
 * Extracts raw text from a PDF buffer.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractText(buffer) {
  const result = await pdfParse(buffer);
  if (!result.text || result.text.trim().length === 0) {
    throw new Error('Empty PDF content');
  }
  return result.text;
}

module.exports = { extractText };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && npx jest tests/parsers/pdf.test.js --verbose
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/parsers/pdf.js apps/worker/tests/parsers/pdf.test.js
git commit -m "feat: PDF text extractor"
```

---

### Task 12: Patient Anonymizer

**Files:**
- Create: `apps/worker/src/anonymizer/patient.js`
- Create: `apps/worker/tests/anonymizer/patient.test.js`

- [ ] **Step 1: Create apps/worker/tests/anonymizer/patient.test.js**

```javascript
const { anonymize } = require('../../src/anonymizer/patient');

describe('anonymize', () => {
  const patient = { name: 'Maria da Silva', cpf_hash: 'abc123', birth_date: '1975-03-20', sex: 'F' };

  it('removes name and cpf_hash', () => {
    const result = anonymize(patient);
    expect(result.name).toBeUndefined();
    expect(result.cpf_hash).toBeUndefined();
  });

  it('replaces birth_date with age_range', () => {
    const result = anonymize(patient);
    expect(result.birth_date).toBeUndefined();
    expect(result.age_range).toMatch(/^\d{2}-\d{2}$/);
  });

  it('preserves sex', () => {
    expect(anonymize(patient).sex).toBe('F');
  });

  it('returns decade-based age_range', () => {
    // born 1975 → ~50 years old in 2026 → age_range = '50-59'
    expect(anonymize(patient).age_range).toBe('50-59');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/worker && npx jest tests/anonymizer/patient.test.js --verbose
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create apps/worker/src/anonymizer/patient.js**

```javascript
/**
 * Strips PII from patient data before sending to Claude (LGPD compliance).
 * Removes name, CPF. Replaces birth_date with decade-based age_range.
 *
 * @param {{ name?: string, cpf_hash?: string, birth_date?: string, sex?: string }} patient
 * @returns {{ sex: string, age_range: string }}
 */
function anonymize(patient) {
  const result = { sex: patient.sex };

  if (patient.birth_date) {
    const age = new Date().getFullYear() - new Date(patient.birth_date).getFullYear();
    const decade = Math.floor(age / 10) * 10;
    result.age_range = `${decade}-${decade + 9}`;
  }

  return result;
}

module.exports = { anonymize };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && npx jest tests/anonymizer/patient.test.js --verbose
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/anonymizer/patient.js apps/worker/tests/anonymizer/patient.test.js
git commit -m "feat: patient anonymizer for LGPD compliance"
```

---

### Task 13: Marker Classifier

**Files:**
- Create: `apps/worker/src/classifier/markers.js`
- Create: `apps/worker/tests/classifier/markers.test.js`

- [ ] **Step 1: Create apps/worker/tests/classifier/markers.test.js**

```javascript
const { classifyAgents } = require('../../src/classifier/markers');

describe('classifyAgents', () => {
  it('detects metabolic markers', () => {
    expect(classifyAgents('Glicemia: 126 mg/dL\nTSH: 5.2')).toContain('metabolic');
  });

  it('detects cardiovascular markers', () => {
    expect(classifyAgents('Colesterol Total: 240\nLDL: 180\nHDL: 38')).toContain('cardiovascular');
  });

  it('detects hematology markers', () => {
    expect(classifyAgents('Hemoglobina: 11.2 g/dL\nLeucócitos: 9800')).toContain('hematology');
  });

  it('returns multiple agents for mixed exam', () => {
    const agents = classifyAgents('Glicemia: 126\nColesterol: 230\nHemoglobina: 12');
    expect(agents.length).toBeGreaterThan(1);
  });

  it('returns empty array for unrecognized text', () => {
    expect(classifyAgents('texto sem marcadores reconhecidos')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/worker && npx jest tests/classifier/markers.test.js --verbose
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create apps/worker/src/classifier/markers.js**

```javascript
const AGENT_MARKERS = {
  metabolic: [
    /glicemia/i, /glicose/i, /hba1c/i, /hemoglobina\s+glicada/i,
    /insulina/i, /tsh/i, /t4/i, /tireoide/i
  ],
  cardiovascular: [
    /colesterol/i, /ldl/i, /hdl/i, /vldl/i,
    /triglicér/i, /trigliceri/i, /pcr/i, /proteína\s+c\s+reativa/i
  ],
  hematology: [
    /hemoglobina/i, /hematócrito/i, /eritrócitos/i, /leucócitos/i,
    /plaquetas/i, /neutrófilos/i, /linfócitos/i, /hemograma/i
  ]
};

/**
 * Returns which clinical agents should analyze the given exam text.
 * @param {string} text
 * @returns {string[]} e.g. ['metabolic', 'cardiovascular']
 */
function classifyAgents(text) {
  return Object.entries(AGENT_MARKERS)
    .filter(([, patterns]) => patterns.some(p => p.test(text)))
    .map(([agent]) => agent);
}

module.exports = { classifyAgents };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && npx jest tests/classifier/markers.test.js --verbose
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/classifier/markers.js apps/worker/tests/classifier/markers.test.js
git commit -m "feat: marker classifier — routes exam text to specialized agents"
```

---

### Task 14: RAG Embedder and Retriever

**Files:**
- Create: `apps/worker/src/rag/embedder.js`
- Create: `apps/worker/src/rag/retriever.js`

- [ ] **Step 1: Create apps/worker/src/rag/embedder.js**

```javascript
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Generates a 1536-dimensional embedding using text-embedding-3-small.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embed(text) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000)
  });
  return response.data[0].embedding;
}

module.exports = { embed };
```

- [ ] **Step 2: Create apps/worker/src/rag/retriever.js**

```javascript
const { embed } = require('./embedder');

/**
 * Retrieves the top-k most relevant clinical guidelines from pgvector.
 *
 * @param {import('pg').PoolClient} client - DB client with tenant context set
 * @param {string} queryText - Exam markers as text
 * @param {number} k - Number of results (default 5)
 * @returns {Promise<Array<{ title: string, content: string, source: string }>>}
 */
async function retrieveGuidelines(client, queryText, k = 5) {
  const embedding = await embed(queryText);

  const { rows } = await client.query(
    `SELECT title, content, source
     FROM rag_documents
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [`[${embedding.join(',')}]`, k]
  );

  return rows;
}

module.exports = { retrieveGuidelines };
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/rag/
git commit -m "feat: RAG embedder (OpenAI) and pgvector retriever"
```

---

### Task 15: Metabolic Agent

**Files:**
- Create: `apps/worker/src/agents/metabolic.js`
- Create: `apps/worker/tests/agents/metabolic.test.js`

- [ ] **Step 1: Create apps/worker/tests/agents/metabolic.test.js**

```javascript
jest.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      get messages() {
        return {
          create: async () => ({
            content: [{ text: JSON.stringify({
              interpretation: 'Glicemia elevada sugere resistência à insulina.',
              risk_scores: { metabolic: 'HIGH' },
              alerts: [{ marker: 'Glicemia', value: '126 mg/dL', severity: 'medium' }],
              disclaimer: 'Esta análise não substitui avaliação médica.'
            }) }]
          })
        };
      }
    }
  };
});

const { runMetabolicAgent } = require('../../src/agents/metabolic');

const ctx = {
  examText: 'Glicemia: 126 mg/dL\nTSH: 5.2 mUI/L',
  patient: { sex: 'M', age_range: '40-49' },
  guidelines: [{ title: 'ADA 2024', content: 'Fasting glucose ≥126 = diabetes', source: 'ADA' }]
};

describe('runMetabolicAgent', () => {
  it('returns interpretation string', async () => {
    const result = await runMetabolicAgent(ctx);
    expect(typeof result.interpretation).toBe('string');
    expect(result.interpretation.length).toBeGreaterThan(0);
  });

  it('returns risk_scores object', async () => {
    const result = await runMetabolicAgent(ctx);
    expect(typeof result.risk_scores).toBe('object');
  });

  it('returns alerts array', async () => {
    const result = await runMetabolicAgent(ctx);
    expect(Array.isArray(result.alerts)).toBe(true);
  });

  it('always sets the mandatory disclaimer', async () => {
    const result = await runMetabolicAgent(ctx);
    expect(result.disclaimer).toContain('não substitui avaliação médica');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/worker && npx jest tests/agents/metabolic.test.js --verbose
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create apps/worker/src/agents/metabolic.js**

```javascript
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica e não substitui avaliação médica profissional.';

const SYSTEM_PROMPT = `You are a specialized metabolic and endocrinology clinical analyst.
Analyze laboratory results for glucose metabolism, thyroid function, and hormones.
Respond ONLY with valid JSON:
{
  "interpretation": "<in Brazilian Portuguese>",
  "risk_scores": { "metabolic": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Never diagnose. Provide clinical decision support only.`;

/**
 * @param {{ examText: string, patient: { sex: string, age_range: string }, guidelines: Array }} ctx
 */
async function runMetabolicAgent(ctx) {
  const guidelinesText = ctx.guidelines.map(g => `## ${g.title}\n${g.content}`).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Patient: sex=${ctx.patient.sex}, age_range=${ctx.patient.age_range}\n\nLab Results:\n${ctx.examText}\n\nGuidelines:\n${guidelinesText}`
    }]
  });

  const result = JSON.parse(response.content[0].text);
  result.disclaimer = DISCLAIMER;
  return result;
}

module.exports = { runMetabolicAgent };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && npx jest tests/agents/metabolic.test.js --verbose
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/agents/metabolic.js apps/worker/tests/agents/metabolic.test.js
git commit -m "feat: metabolic clinical agent with Claude integration"
```

---

### Task 16: Cardiovascular Agent

**Files:**
- Create: `apps/worker/src/agents/cardiovascular.js`
- Create: `apps/worker/tests/agents/cardiovascular.test.js`

- [ ] **Step 1: Create apps/worker/tests/agents/cardiovascular.test.js**

```javascript
jest.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      get messages() {
        return {
          create: async () => ({
            content: [{ text: JSON.stringify({
              interpretation: 'LDL elevado com risco cardiovascular aumentado.',
              risk_scores: { cardiovascular: 'HIGH' },
              alerts: [{ marker: 'LDL', value: '195 mg/dL', severity: 'high' }],
              disclaimer: 'Esta análise não substitui avaliação médica.'
            }) }]
          })
        };
      }
    }
  };
});

const { runCardiovascularAgent } = require('../../src/agents/cardiovascular');

const ctx = {
  examText: 'Colesterol Total: 260 mg/dL\nLDL: 195 mg/dL\nHDL: 35 mg/dL',
  patient: { sex: 'M', age_range: '50-59' },
  guidelines: [{ title: 'SBC 2023', content: 'LDL >160 = alto risco', source: 'SBC' }]
};

describe('runCardiovascularAgent', () => {
  it('returns interpretation string', async () => {
    expect(typeof (await runCardiovascularAgent(ctx)).interpretation).toBe('string');
  });

  it('returns cardiovascular risk score', async () => {
    expect((await runCardiovascularAgent(ctx)).risk_scores).toHaveProperty('cardiovascular');
  });

  it('returns alerts array', async () => {
    expect(Array.isArray((await runCardiovascularAgent(ctx)).alerts)).toBe(true);
  });

  it('always sets the mandatory disclaimer', async () => {
    expect((await runCardiovascularAgent(ctx)).disclaimer).toContain('não substitui avaliação médica');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/worker && npx jest tests/agents/cardiovascular.test.js --verbose
```

Expected: FAIL

- [ ] **Step 3: Create apps/worker/src/agents/cardiovascular.js**

```javascript
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica e não substitui avaliação médica profissional.';

const SYSTEM_PROMPT = `You are a specialized cardiovascular clinical analyst.
Analyze lipid profile and cardiovascular risk markers.
Respond ONLY with valid JSON:
{
  "interpretation": "<in Brazilian Portuguese>",
  "risk_scores": { "cardiovascular": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Never diagnose. Provide clinical decision support only.`;

/**
 * @param {{ examText: string, patient: { sex: string, age_range: string }, guidelines: Array }} ctx
 */
async function runCardiovascularAgent(ctx) {
  const guidelinesText = ctx.guidelines.map(g => `## ${g.title}\n${g.content}`).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Patient: sex=${ctx.patient.sex}, age_range=${ctx.patient.age_range}\n\nLab Results:\n${ctx.examText}\n\nGuidelines:\n${guidelinesText}`
    }]
  });

  const result = JSON.parse(response.content[0].text);
  result.disclaimer = DISCLAIMER;
  return result;
}

module.exports = { runCardiovascularAgent };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && npx jest tests/agents/cardiovascular.test.js --verbose
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/agents/cardiovascular.js apps/worker/tests/agents/cardiovascular.test.js
git commit -m "feat: cardiovascular clinical agent with Claude integration"
```

---

### Task 17: Hematology Agent

**Files:**
- Create: `apps/worker/src/agents/hematology.js`
- Create: `apps/worker/tests/agents/hematology.test.js`

- [ ] **Step 1: Create apps/worker/tests/agents/hematology.test.js**

```javascript
jest.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      get messages() {
        return {
          create: async () => ({
            content: [{ text: JSON.stringify({
              interpretation: 'Anemia microcítica sugestiva de deficiência de ferro.',
              risk_scores: { hematology: 'MEDIUM' },
              alerts: [{ marker: 'Hemoglobina', value: '10.5 g/dL', severity: 'medium' }],
              disclaimer: 'Esta análise não substitui avaliação médica.'
            }) }]
          })
        };
      }
    }
  };
});

const { runHematologyAgent } = require('../../src/agents/hematology');

const ctx = {
  examText: 'Hemoglobina: 10.5 g/dL\nHematócrito: 31%\nLeucócitos: 7500/mm³',
  patient: { sex: 'F', age_range: '30-39' },
  guidelines: [{ title: 'OMS Anemia', content: 'Hb <12 g/dL em mulheres = anemia', source: 'WHO' }]
};

describe('runHematologyAgent', () => {
  it('returns interpretation string', async () => {
    expect(typeof (await runHematologyAgent(ctx)).interpretation).toBe('string');
  });

  it('returns hematology risk score', async () => {
    expect((await runHematologyAgent(ctx)).risk_scores).toHaveProperty('hematology');
  });

  it('returns alerts array', async () => {
    expect(Array.isArray((await runHematologyAgent(ctx)).alerts)).toBe(true);
  });

  it('always sets the mandatory disclaimer', async () => {
    expect((await runHematologyAgent(ctx)).disclaimer).toContain('não substitui avaliação médica');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/worker && npx jest tests/agents/hematology.test.js --verbose
```

Expected: FAIL

- [ ] **Step 3: Create apps/worker/src/agents/hematology.js**

```javascript
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica e não substitui avaliação médica profissional.';

const SYSTEM_PROMPT = `You are a specialized hematology clinical analyst.
Analyze complete blood count and hematological markers.
Respond ONLY with valid JSON:
{
  "interpretation": "<in Brazilian Portuguese>",
  "risk_scores": { "hematology": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Never diagnose. Provide clinical decision support only.`;

/**
 * @param {{ examText: string, patient: { sex: string, age_range: string }, guidelines: Array }} ctx
 */
async function runHematologyAgent(ctx) {
  const guidelinesText = ctx.guidelines.map(g => `## ${g.title}\n${g.content}`).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Patient: sex=${ctx.patient.sex}, age_range=${ctx.patient.age_range}\n\nLab Results:\n${ctx.examText}\n\nGuidelines:\n${guidelinesText}`
    }]
  });

  const result = JSON.parse(response.content[0].text);
  result.disclaimer = DISCLAIMER;
  return result;
}

module.exports = { runHematologyAgent };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && npx jest tests/agents/hematology.test.js --verbose
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/agents/hematology.js apps/worker/tests/agents/hematology.test.js
git commit -m "feat: hematology clinical agent with Claude integration"
```

---

### Task 18: Exam Processor Pipeline

**Files:**
- Create: `apps/worker/src/processors/exam.js`
- Create: `apps/worker/tests/processors/exam.test.js`

- [ ] **Step 1: Create apps/worker/tests/processors/exam.test.js**

```javascript
jest.mock('pg', () => {
  const client = {
    query: jest.fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // SET LOCAL app.tenant_id
      .mockResolvedValueOnce({}) // UPDATE status = processing
      .mockResolvedValue({ rows: [{ name: 'Maria', birth_date: '1975-03-20', sex: 'F' }] }),
    release: jest.fn()
  };
  return { Pool: jest.fn(() => ({ connect: jest.fn().mockResolvedValue(client), query: jest.fn() })) };
});

jest.mock('fs', () => ({ readFileSync: jest.fn().mockReturnValue(Buffer.from('%PDF')) }));
jest.mock('../../src/parsers/pdf', () => ({ extractText: jest.fn().mockResolvedValue('Glicemia: 126 mg/dL') }));
jest.mock('../../src/classifier/markers', () => ({ classifyAgents: jest.fn().mockReturnValue(['metabolic']) }));
jest.mock('../../src/rag/retriever', () => ({ retrieveGuidelines: jest.fn().mockResolvedValue([{ title: 'ADA', content: '...', source: 'ADA' }]) }));
jest.mock('../../src/agents/metabolic', () => ({
  runMetabolicAgent: jest.fn().mockResolvedValue({
    interpretation: 'Glicemia elevada.',
    risk_scores: { metabolic: 'HIGH' },
    alerts: [],
    disclaimer: 'Esta análise não substitui avaliação médica.'
  })
}));
jest.mock('ioredis', () => jest.fn(() => ({ publish: jest.fn().mockResolvedValue(1), quit: jest.fn() })));

const { processExam } = require('../../src/processors/exam');

describe('processExam', () => {
  it('completes without throwing for a valid job', async () => {
    await expect(processExam({
      exam_id: 'exam-uuid',
      tenant_id: 'tenant-uuid',
      file_path: '/tmp/test.pdf'
    })).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/worker && npx jest tests/processors/exam.test.js --verbose
```

Expected: FAIL — "Cannot find module '../../src/processors/exam'"

- [ ] **Step 3: Create apps/worker/src/processors/exam.js**

```javascript
const fs = require('fs');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { extractText } = require('../parsers/pdf');
const { anonymize } = require('../anonymizer/patient');
const { classifyAgents } = require('../classifier/markers');
const { retrieveGuidelines } = require('../rag/retriever');
const { runMetabolicAgent } = require('../agents/metabolic');
const { runCardiovascularAgent } = require('../agents/cardiovascular');
const { runHematologyAgent } = require('../agents/hematology');

const AGENT_RUNNERS = {
  metabolic: runMetabolicAgent,
  cardiovascular: runCardiovascularAgent,
  hematology: runHematologyAgent
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Full exam processing pipeline:
 * parse → anonymize → classify → RAG → agents → persist → notify
 *
 * @param {{ exam_id: string, tenant_id: string, file_path: string }} jobData
 */
async function processExam({ exam_id, tenant_id, file_path }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.tenant_id = $1', [tenant_id]);

    await client.query(
      `UPDATE exams SET status = 'processing', updated_at = NOW() WHERE id = $1`,
      [exam_id]
    );

    const { rows } = await client.query(
      `SELECT p.name, p.birth_date, p.sex
       FROM exams e JOIN patients p ON p.id = e.patient_id
       WHERE e.id = $1`,
      [exam_id]
    );
    const patient = rows[0];

    const buffer = fs.readFileSync(file_path);
    const examText = await extractText(buffer);
    const anonPatient = anonymize(patient);
    const agentNames = classifyAgents(examText);

    if (agentNames.length === 0) {
      await client.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        ['No recognized clinical markers found', exam_id]
      );
      await client.query('COMMIT');
      return;
    }

    for (const agentName of agentNames) {
      const runner = AGENT_RUNNERS[agentName];
      if (!runner) continue;

      const guidelines = await retrieveGuidelines(client, examText);
      const result = await runner({ examText, patient: anonPatient, guidelines });

      await client.query(
        `INSERT INTO clinical_results
           (exam_id, tenant_id, agent_type, interpretation, risk_scores, alerts, disclaimer, model_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          exam_id, tenant_id, agentName,
          result.interpretation,
          JSON.stringify(result.risk_scores),
          JSON.stringify(result.alerts),
          result.disclaimer,
          'claude-sonnet-4-6'
        ]
      );
    }

    await client.query(
      `UPDATE exams SET status = 'done', updated_at = NOW() WHERE id = $1`,
      [exam_id]
    );

    await client.query('COMMIT');

    // Notify API via Redis pub/sub → WebSocket
    const pub = new Redis(process.env.REDIS_URL);
    await pub.publish(`exam:done:${tenant_id}`, JSON.stringify({ exam_id }));
    await pub.quit();

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await pool.query(
      `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
      [err.message, exam_id]
    );
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { processExam };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && npx jest tests/processors/exam.test.js --verbose
```

Expected: PASS (1 test)

- [ ] **Step 5: Run all worker tests**

```bash
cd apps/worker && npx jest --verbose
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/processors/exam.js apps/worker/tests/processors/exam.test.js
git commit -m "feat: exam processor pipeline — parse, anonymize, classify, RAG, agents, notify"
```

---

### Task 19: RAG Seed Script

**Files:**
- Create: `apps/api/src/db/seed-rag.js`

- [ ] **Step 1: Create apps/api/src/db/seed-rag.js**

```javascript
require('dotenv').config();
const { Pool } = require('pg');
const OpenAI = require('openai');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const GUIDELINES = [
  {
    source: 'ADA 2024',
    title: 'Diagnóstico de Diabetes Mellitus',
    content: 'Glicemia de jejum ≥126 mg/dL em duas ocasiões = DM. 100-125 = pré-diabetes. HbA1c ≥6,5% = DM. 5,7-6,4% = pré-diabetes.'
  },
  {
    source: 'ADA 2024',
    title: 'Avaliação da Função Tireoidiana',
    content: 'TSH normal: 0,4-4,0 mUI/L. TSH >4,0 = hipotireoidismo. TSH <0,4 = hipertireoidismo. T4 livre normal: 0,8-1,8 ng/dL.'
  },
  {
    source: 'SBC 2023',
    title: 'Dislipidemias e Risco Cardiovascular',
    content: 'LDL <100 = ótimo. 130-159 = limítrofe. ≥160 = alto. HDL <40 (H) / <50 (M) = baixo. Triglicerídeos >150 = limítrofe. >500 = risco de pancreatite.'
  },
  {
    source: 'SBC 2023',
    title: 'Colesterol Total',
    content: 'Colesterol total <170 = desejável. 170-199 = limítrofe. ≥200 = elevado.'
  },
  {
    source: 'WHO 2011',
    title: 'Definição de Anemia',
    content: 'Anemia: Hb <13 g/dL (homens), <12 g/dL (mulheres). Anemia grave: Hb <8 g/dL. Microcítica: VCM <80 fL (sugere deficiência de ferro).'
  },
  {
    source: 'SBH 2021',
    title: 'Interpretação do Hemograma',
    content: 'Leucócitos normais: 4.000-11.000/mm³. Leucocitose >11.000 sugere infecção. Leucopenia <4.000 sugere imunossupressão. Plaquetas normais: 150.000-400.000/mm³.'
  }
];

async function seedRag() {
  console.log('Seeding RAG knowledge base...');

  for (const doc of GUIDELINES) {
    const { data } = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: `${doc.title}: ${doc.content}`
    });
    const embedding = data[0].embedding;

    await pool.query(
      `INSERT INTO rag_documents (source, title, content, embedding)
       VALUES ($1, $2, $3, $4::vector)
       ON CONFLICT DO NOTHING`,
      [doc.source, doc.title, doc.content, `[${embedding.join(',')}]`]
    );

    console.log(`[seeded] ${doc.title}`);
  }

  console.log('Done.');
  await pool.end();
}

seedRag().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run the seed script**

```bash
cd apps/api && node src/db/seed-rag.js
```

Expected: Each guideline logged as `[seeded] <title>`, then "Done."

- [ ] **Step 3: Remove old agents directory**

```bash
git rm -r apps/agents/
```

- [ ] **Step 4: Run all tests one final time**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest --verbose
cd apps/worker && npx jest --verbose
```

Expected: All tests PASS across both packages.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/seed-rag.js
git commit -m "feat: RAG seed with 6 clinical guidelines; remove legacy apps/agents"
```

---

## Spec Coverage Check

| Spec Requirement | Task(s) |
|-----------------|---------|
| Multi-tenant RLS from day one | 2, 4 |
| JWT auth + tenant context in every request | 4, 5 |
| PDF upload → BullMQ enqueue | 7 |
| Async worker (never blocks API) | 10, 18 |
| PDF parsing | 11 |
| LGPD anonymization before Claude | 12 |
| Marker → agent classification | 13 |
| RAG with pgvector (OpenAI embeddings) | 14 |
| Metabolic agent (Claude) | 15 |
| Cardiovascular agent (Claude) | 16 |
| Hematology agent (Claude) | 17 |
| Full pipeline orchestration | 18 |
| WebSocket real-time notifications | 9 |
| Mandatory disclaimer on every result | 15, 16, 17 |
| Patients CRUD | 6 |
| Alerts endpoint | 8 |
| Docker with pgvector + worker | 1 |
| RAG guidelines seeded | 19 |

All 19 tasks cover every spec requirement. No placeholders. Function names consistent throughout (`runMetabolicAgent`, `runCardiovascularAgent`, `runHematologyAgent`, `withTenant`, `processExam`, `classifyAgents`, `extractText`, `anonymize`, `retrieveGuidelines`).

---

> **Angular frontend plan:** After this backend is complete and running, run `/superpowers:brainstorming` focused on the Angular SPA (doctor dashboard, lab portal, clinic management) to produce a separate frontend plan.
