# Integration Studio — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Integration Studio Phase 1 — REST/Swagger Connect mode with a 4-step wizard UI and webhook ingest, enabling admins to connect any Swagger-documented legacy system in under 15 minutes.

**Architecture:** Backend adds two new tables (`integration_connectors`, `integration_logs`) with full RLS, a Fastify route module for connector CRUD + swagger parsing + webhook ingest, and a standalone swagger parser service. Frontend adds an Angular 18 standalone integrations list page and a 4-step wizard (mode → configure → map fields → activate) using Angular Material Stepper, consistent with the Clinical Sentinel design system.

**Tech Stack:** Node.js 20 (built-in `fetch`), Fastify 4, PostgreSQL with RLS, BullMQ, Angular 18 standalone, Angular Material Stepper, `crypto` (Node built-in for HMAC)

**Scope:** Phase 1 only — REST/Swagger Connect. HL7 and File Drop are independent subsystems with separate plans.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/api/src/db/migrations/009_integration_studio.sql` | Create | Tables + RLS for connectors and logs |
| `apps/api/src/services/swagger-parser.js` | Create | Fetch OpenAPI 2/3 JSON and extract field names |
| `apps/api/src/routes/integrations.js` | Create | CRUD + swagger parse + webhook ingest routes |
| `apps/api/src/server.js` | Modify | Register integrations route |
| `apps/api/tests/routes/integrations.test.js` | Create | Supertest integration tests |
| `apps/web/src/app/shared/models/api.models.ts` | Modify | Add Connector + ConnectorLog + SwaggerField types |
| `apps/web/src/app/features/clinic/integrations/integrations.component.ts` | Create | Connector list page |
| `apps/web/src/app/features/clinic/integrations/wizard/wizard.component.ts` | Create | 4-step wizard (new connector) |
| `apps/web/src/app/features/clinic/clinic.routes.ts` | Modify | Add integrations + wizard routes |
| `apps/web/src/app/app.component.ts` | Modify | Add "Integrações" nav item for admin |

---

## Task 1: DB Migration — integration_connectors + integration_logs

**Files:**
- Create: `apps/api/src/db/migrations/009_integration_studio.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- apps/api/src/db/migrations/009_integration_studio.sql

-- Allow integration-sourced exams
ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_source_check;
ALTER TABLE exams ADD CONSTRAINT exams_source_check
  CHECK (source IN ('upload', 'hl7', 'fhir', 'integration'));

-- Connector registry
CREATE TABLE integration_connectors (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('swagger', 'hl7', 'file_drop')),
  config       JSONB NOT NULL DEFAULT '{}',
  field_map    JSONB NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'inactive'
                 CHECK (status IN ('active', 'inactive', 'error')),
  last_sync_at TIMESTAMPTZ,
  sync_count   INTEGER DEFAULT 0,
  error_msg    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_connectors_tenant ON integration_connectors(tenant_id);

CREATE TRIGGER trg_integration_connectors_updated_at
  BEFORE UPDATE ON integration_connectors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sync/ingest logs
CREATE TABLE integration_logs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connector_id   UUID NOT NULL REFERENCES integration_connectors(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL,
  event_type     TEXT NOT NULL CHECK (event_type IN ('ingest', 'test', 'error')),
  status         TEXT NOT NULL CHECK (status IN ('success', 'error')),
  records_in     INTEGER DEFAULT 0,
  records_out    INTEGER DEFAULT 0,
  error_detail   TEXT,
  duration_ms    INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_logs_connector ON integration_logs(connector_id);

-- RLS
ALTER TABLE integration_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connectors FORCE ROW LEVEL SECURITY;
ALTER TABLE integration_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON integration_connectors
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_write ON integration_connectors
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_update ON integration_connectors
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_delete ON integration_connectors
  FOR DELETE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON integration_logs
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_write ON integration_logs
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

- [ ] **Step 2: Run migration**

```bash
cd apps/api
node src/db/migrate.js
```

Expected output:
```
[apply] 009_integration_studio.sql
Migrations complete.
```

- [ ] **Step 3: Verify tables exist**

```bash
psql $DATABASE_URL -c "\d integration_connectors"
```

Expected: table listed with all columns.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/009_integration_studio.sql
git commit -m "feat: add integration_connectors and integration_logs tables with RLS"
```

---

## Task 2: Swagger Parser Service

**Files:**
- Create: `apps/api/src/services/swagger-parser.js`

The parser fetches a Swagger/OpenAPI URL and extracts a flat list of field paths from the schemas. It handles both OpenAPI 2 (`definitions`) and OpenAPI 3 (`components.schemas`).

- [ ] **Step 1: Write the parser service**

```javascript
// apps/api/src/services/swagger-parser.js
'use strict';

/**
 * Recursively extract field paths from a JSON Schema object.
 * Returns flat list like ['nome_completo', 'dt_nascimento', 'laudo.arquivo_url']
 */
function extractFields(schema, prefix = '') {
  const fields = [];
  if (!schema || schema.type !== 'object' || !schema.properties) {
    if (prefix) fields.push(prefix);
    return fields;
  }
  for (const [key, val] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val.type === 'object' && val.properties) {
      fields.push(...extractFields(val, path));
    } else {
      fields.push(path);
    }
  }
  return fields;
}

/**
 * Fetch and parse a Swagger/OpenAPI URL.
 * Returns: { fields: string[], rawSchema: object }
 * Throws on network error or non-JSON response.
 */
async function fetchAndParseSwagger(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Failed to fetch swagger: ${res.status} ${res.statusText}`);

  let spec;
  try {
    spec = await res.json();
  } catch {
    throw new Error('Swagger URL did not return valid JSON');
  }

  const schemas = {};

  // OpenAPI 3.x
  if (spec.openapi && spec.components?.schemas) {
    Object.assign(schemas, spec.components.schemas);
  }
  // Swagger 2.x
  if (spec.swagger && spec.definitions) {
    Object.assign(schemas, spec.definitions);
  }

  const fields = new Set();
  for (const schema of Object.values(schemas)) {
    for (const f of extractFields(schema)) {
      fields.add(f);
    }
  }

  return { fields: Array.from(fields).sort(), rawSchema: spec };
}

/**
 * Given field_map (GenomaFlow key → source path like "$.paciente.nome"),
 * resolve actual values from a source payload.
 */
function resolveFieldMap(fieldMap, payload) {
  const result = {};
  for (const [target, sourcePath] of Object.entries(fieldMap)) {
    const parts = sourcePath.replace(/^\$\.?/, '').split('.');
    let val = payload;
    for (const p of parts) {
      val = val?.[p];
      if (val === undefined) break;
    }
    result[target] = val ?? null;
  }
  return result;
}

module.exports = { fetchAndParseSwagger, resolveFieldMap };
```

- [ ] **Step 2: Quick smoke test in Node REPL**

```bash
cd apps/api
node -e "
const { fetchAndParseSwagger } = require('./src/services/swagger-parser');
fetchAndParseSwagger('https://petstore.swagger.io/v2/swagger.json')
  .then(r => console.log('fields:', r.fields.slice(0, 10)))
  .catch(console.error);
"
```

Expected: prints 10 field names from petstore schema.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/swagger-parser.js
git commit -m "feat: swagger parser service — fetch OpenAPI 2/3 and extract field paths"
```

---

## Task 3: Integrations API Routes + Server Registration

**Files:**
- Create: `apps/api/src/routes/integrations.js`
- Modify: `apps/api/src/server.js`

- [ ] **Step 1: Create the integrations route module**

```javascript
// apps/api/src/routes/integrations.js
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { Queue } = require('bullmq');
const { withTenant } = require('../db/tenant');
const { fetchAndParseSwagger, resolveFieldMap } = require('../services/swagger-parser');

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/uploads';

/** Download a file from URL and save to dest path. Returns promise. */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    protocol.get(url, res => {
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

/** Verify HMAC-SHA256 webhook signature. */
function verifySignature(secret, body, header) {
  if (!header) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    return false;
  }
}

module.exports = async function (fastify) {
  const examQueue = new Queue('exam-processing', { connection: fastify.redis });

  // ----- Swagger parse (no auth needed for parse — just a utility) -----

  fastify.post('/swagger/parse', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { url } = request.body;
    if (!url) return reply.status(400).send({ error: 'url is required' });
    try {
      const { fields } = await fetchAndParseSwagger(url);
      return { fields };
    } catch (err) {
      return reply.status(422).send({ error: err.message });
    }
  });

  // ----- CRUD -----

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { name, mode, config = {}, field_map = {} } = request.body;

    if (!name) return reply.status(400).send({ error: 'name is required' });
    if (!['swagger', 'hl7', 'file_drop'].includes(mode))
      return reply.status(400).send({ error: 'mode must be swagger, hl7, or file_drop' });

    // Generate webhook_secret for swagger mode
    const fullConfig = mode === 'swagger'
      ? { ...config, webhook_secret: config.webhook_secret || crypto.randomBytes(32).toString('hex') }
      : config;

    const connector = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO integration_connectors (tenant_id, name, mode, config, field_map)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, mode, field_map, status, created_at`,
        [tenant_id, name, mode, JSON.stringify(fullConfig), JSON.stringify(field_map)]
      );
      return rows[0];
    });

    return reply.status(201).send(connector);
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, mode, field_map, status, last_sync_at, sync_count, error_msg, created_at, updated_at
         FROM integration_connectors
         ORDER BY created_at DESC`
      );
      return rows;
    });
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const connector = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, mode, field_map, status, last_sync_at, sync_count, error_msg, created_at, updated_at
         FROM integration_connectors WHERE id = $1`,
        [id]
      );
      return rows[0] || null;
    });
    if (!connector) return reply.status(404).send({ error: 'Connector not found' });
    return connector;
  });

  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const { name, config, field_map, status } = request.body;

    const connector = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE integration_connectors
         SET name = COALESCE($2, name),
             config = COALESCE($3::jsonb, config),
             field_map = COALESCE($4::jsonb, field_map),
             status = COALESCE($5, status),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, mode, field_map, status, last_sync_at, sync_count, error_msg, updated_at`,
        [id, name || null, config ? JSON.stringify(config) : null,
         field_map ? JSON.stringify(field_map) : null, status || null]
      );
      return rows[0] || null;
    });
    if (!connector) return reply.status(404).send({ error: 'Connector not found' });
    return connector;
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    await withTenant(fastify.pg, tenant_id, async (client) => {
      await client.query('DELETE FROM integration_connectors WHERE id = $1', [id]);
    });
    return reply.status(204).send();
  });

  // ----- Test connection -----

  fastify.post('/:id/test', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const start = Date.now();

    const connector = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, mode, config FROM integration_connectors WHERE id = $1`, [id]
      );
      return rows[0] || null;
    });
    if (!connector) return reply.status(404).send({ error: 'Connector not found' });

    try {
      if (connector.mode === 'swagger') {
        const { swagger_url } = connector.config;
        if (!swagger_url) return reply.status(422).send({ error: 'swagger_url not configured' });
        const { fields } = await fetchAndParseSwagger(swagger_url);
        const duration_ms = Date.now() - start;
        await withTenant(fastify.pg, tenant_id, async (client) => {
          await client.query(
            `INSERT INTO integration_logs (connector_id, tenant_id, event_type, status, duration_ms)
             VALUES ($1, $2, 'test', 'success', $3)`,
            [id, tenant_id, duration_ms]
          );
        });
        return { ok: true, fields_discovered: fields.length, duration_ms };
      }
      return reply.status(422).send({ error: `Test not supported for mode: ${connector.mode}` });
    } catch (err) {
      await withTenant(fastify.pg, tenant_id, async (client) => {
        await client.query(
          `INSERT INTO integration_logs (connector_id, tenant_id, event_type, status, error_detail, duration_ms)
           VALUES ($1, $2, 'error', 'error', $3, $4)`,
          [id, tenant_id, err.message, Date.now() - start]
        );
      });
      return reply.status(422).send({ ok: false, error: err.message });
    }
  });

  // ----- Logs -----

  fastify.get('/:id/logs', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const limit = Math.min(Number(request.query.limit) || 50, 200);

    const logs = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, event_type, status, records_in, records_out, error_detail, duration_ms, created_at
         FROM integration_logs
         WHERE connector_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [id, limit]
      );
      return rows;
    });
    return logs;
  });

  // ----- Webhook inbound (no JWT auth — uses HMAC signature) -----

  fastify.post('/:id/ingest', async (request, reply) => {
    const { id } = request.params;

    // Fetch connector without tenant context (we'll validate via signature)
    const client = await fastify.pg.connect();
    let connector;
    try {
      const { rows } = await client.query(
        `SELECT id, tenant_id, mode, config, field_map, status FROM integration_connectors WHERE id = $1`,
        [id]
      );
      connector = rows[0];
    } finally {
      client.release();
    }

    if (!connector) return reply.status(404).send({ error: 'Connector not found' });
    if (connector.status !== 'active') return reply.status(403).send({ error: 'Connector is not active' });
    if (connector.mode !== 'swagger') return reply.status(400).send({ error: 'Ingest only supported for swagger mode' });

    // Verify HMAC signature
    const sig = request.headers['x-genomaflow-signature'];
    if (!verifySignature(connector.config.webhook_secret, request.body, sig)) {
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const start = Date.now();
    const { tenant_id, field_map } = connector;
    const payload = request.body;

    try {
      const mapped = resolveFieldMap(field_map, payload);

      // Find or create patient
      let patientId;
      await withTenant(fastify.pg, tenant_id, async (pgClient) => {
        // Try find by name
        const { rows: existing } = await pgClient.query(
          `SELECT id FROM patients WHERE name = $1 LIMIT 1`,
          [mapped['patient.name']]
        );

        if (existing.length > 0) {
          patientId = existing[0].id;
        } else {
          // Find system user (uploaded_by — use first admin user for integration-created exams)
          const { rows: adminRows } = await pgClient.query(
            `SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' LIMIT 1`,
            [tenant_id]
          );
          const uploadedBy = adminRows[0]?.id;

          const { rows: created } = await pgClient.query(
            `INSERT INTO patients (tenant_id, name, birth_date, sex)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [tenant_id, mapped['patient.name'] || 'Desconhecido',
             mapped['patient.birth_date'] || null, mapped['patient.sex'] || null]
          );
          patientId = created[0].id;
        }

        // Download file if file_url provided
        let filePath = null;
        const fileUrl = mapped['exam.file_url'];
        if (fileUrl) {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
          const filename = `integration-${Date.now()}-${mapped['exam.external_id'] || id}.pdf`;
          filePath = path.join(UPLOADS_DIR, filename);
          await downloadFile(fileUrl, filePath);
        }

        // Find admin user for uploaded_by
        const { rows: adminRows2 } = await pgClient.query(
          `SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' LIMIT 1`, [tenant_id]
        );
        const uploadedBy = adminRows2[0]?.id || adminRows2[0]?.id;

        const { rows: examRows } = await pgClient.query(
          `INSERT INTO exams (tenant_id, patient_id, uploaded_by, file_path, raw_data, status, source)
           VALUES ($1, $2, $3, $4, $5, 'pending', 'integration')
           RETURNING id`,
          [tenant_id, patientId, uploadedBy, filePath, JSON.stringify(payload)]
        );
        const examId = examRows[0].id;

        await examQueue.add('process-exam', {
          exam_id: examId,
          tenant_id,
          file_path: filePath
        });

        // Log success
        await pgClient.query(
          `INSERT INTO integration_logs (connector_id, tenant_id, event_type, status, records_in, records_out, duration_ms)
           VALUES ($1, $2, 'ingest', 'success', 1, 1, $3)`,
          [id, tenant_id, Date.now() - start]
        );

        // Update sync_count + last_sync_at
        await pgClient.query(
          `UPDATE integration_connectors
           SET sync_count = sync_count + 1, last_sync_at = NOW()
           WHERE id = $1`, [id]
        );
      });

      return reply.status(202).send({ ok: true });
    } catch (err) {
      fastify.log.error(err);
      const pgClient2 = await fastify.pg.connect();
      try {
        await pgClient2.query(
          `INSERT INTO integration_logs (connector_id, tenant_id, event_type, status, error_detail, duration_ms)
           VALUES ($1, $2, 'error', 'error', $3, $4)`,
          [id, tenant_id, err.message, Date.now() - start]
        );
      } finally {
        pgClient2.release();
      }
      throw err;
    }
  });
};
```

- [ ] **Step 2: Register integrations route in server.js**

Open `apps/api/src/server.js` and add one line after the users route registration:

```javascript
// Before:
app.register(require('./routes/users'), { prefix: '/users' });

// After (add this line):
app.register(require('./routes/users'), { prefix: '/users' });
app.register(require('./routes/integrations'), { prefix: '/integrations' });
```

Full updated `server.js`:

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
app.register(require('./routes/users'), { prefix: '/users' });
app.register(require('./routes/integrations'), { prefix: '/integrations' });

if (require.main === module) {
  app.listen({ port: 3000, host: '0.0.0.0' });
}

module.exports = app;
```

- [ ] **Step 3: Smoke test the server starts**

```bash
cd apps/api
node src/server.js &
sleep 2
curl -s http://localhost:3000/integrations \
  -H "Authorization: Bearer invalid" | head -c 100
kill %1
```

Expected: `{"message":"Forbidden"}` or `{"statusCode":401}` — server is up and route is registered.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/integrations.js apps/api/src/server.js
git commit -m "feat: integrations API routes — CRUD, swagger parse, test, ingest webhook"
```

---

## Task 4: API Tests

**Files:**
- Create: `apps/api/tests/routes/integrations.test.js`

Look at `apps/api/tests/routes/patients.test.js` and `apps/api/tests/setup.js` to understand the pattern. Tests use supertest + jest + a shared test DB.

Note: `setupTestDb()` creates a tenant + doctor user. The integrations endpoints require `authenticate` (JWT). Use the same `token` pattern.

- [ ] **Step 1: Write the tests**

```javascript
// apps/api/tests/routes/integrations.test.js
const supertest = require('supertest');
const app = require('../../src/server');
const { setupTestDb, teardownTestDb } = require('../setup');

let token;
let connectorId;

beforeAll(async () => {
  await app.ready();
  await setupTestDb();
  const res = await supertest(app.server)
    .post('/auth/login')
    .send({ email: 'test@clinic.com', password: 'password123' });
  token = res.body.token;
});

afterAll(async () => {
  await teardownTestDb();
  await app.close();
});

describe('POST /integrations', () => {
  it('creates a swagger connector', async () => {
    const res = await supertest(app.server)
      .post('/integrations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Tasy Test',
        mode: 'swagger',
        config: { swagger_url: 'https://petstore.swagger.io/v2/swagger.json' },
        field_map: {
          'patient.name': '$.name',
          'patient.birth_date': '$.birth_date'
        }
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Tasy Test');
    expect(res.body.status).toBe('inactive');
    connectorId = res.body.id;
  });

  it('rejects invalid mode', async () => {
    const res = await supertest(app.server)
      .post('/integrations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad', mode: 'fax' });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await supertest(app.server)
      .post('/integrations')
      .send({ name: 'X', mode: 'swagger' });
    expect(res.status).toBe(401);
  });
});

describe('GET /integrations', () => {
  it('returns connector list', async () => {
    const res = await supertest(app.server)
      .get('/integrations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('GET /integrations/:id', () => {
  it('returns connector by id', async () => {
    const res = await supertest(app.server)
      .get(`/integrations/${connectorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(connectorId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await supertest(app.server)
      .get('/integrations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /integrations/:id', () => {
  it('updates connector name', async () => {
    const res = await supertest(app.server)
      .put(`/integrations/${connectorId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Tasy Updated', status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Tasy Updated');
    expect(res.body.status).toBe('active');
  });
});

describe('GET /integrations/:id/logs', () => {
  it('returns logs array', async () => {
    const res = await supertest(app.server)
      .get(`/integrations/${connectorId}/logs`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('DELETE /integrations/:id', () => {
  it('deletes connector', async () => {
    const res = await supertest(app.server)
      .delete(`/integrations/${connectorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 after deletion', async () => {
    const res = await supertest(app.server)
      .get(`/integrations/${connectorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/api
npm test -- --testPathPattern=integrations
```

Expected output:
```
PASS tests/routes/integrations.test.js
  POST /integrations
    ✓ creates a swagger connector
    ✓ rejects invalid mode
    ✓ returns 401 without token
  GET /integrations
    ✓ returns connector list
  GET /integrations/:id
    ✓ returns connector by id
    ✓ returns 404 for unknown id
  PUT /integrations/:id
    ✓ updates connector name
  GET /integrations/:id/logs
    ✓ returns logs array
  DELETE /integrations/:id
    ✓ deletes connector
    ✓ returns 404 after deletion
Test Suites: 1 passed, 1 total
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/tests/routes/integrations.test.js
git commit -m "test: integration connector CRUD API tests"
```

---

## Task 5: Frontend Types

**Files:**
- Modify: `apps/web/src/app/shared/models/api.models.ts`

- [ ] **Step 1: Add Connector and ConnectorLog types**

Append to the end of `apps/web/src/app/shared/models/api.models.ts`:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/shared/models/api.models.ts
git commit -m "feat: add Connector, ConnectorLog, SwaggerParseResult types"
```

---

## Task 6: Integrations List Component

**Files:**
- Create: `apps/web/src/app/features/clinic/integrations/integrations.component.ts`

This page lists connectors with status badges and a "+ Nova Integração" button that navigates to the wizard. Follow the Clinical Sentinel design system (same patterns as `dashboard.component.ts` and `uploads.component.ts`).

- [ ] **Step 1: Create the integrations component**

```typescript
// apps/web/src/app/features/clinic/integrations/integrations.component.ts
import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { environment } from '../../../../environments/environment';
import { Connector } from '../../../shared/models/api.models';

@Component({
  selector: 'app-integrations',
  standalone: true,
  imports: [DatePipe, RouterModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="integrations-page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Integrações</h1>
          <span class="page-subtitle">INTEGRATION STUDIO &middot; CONECTORES ATIVOS</span>
        </div>
        <button class="new-btn" (click)="goToWizard()">
          <mat-icon>add</mat-icon>
          Nova Integração
        </button>
      </div>

      <div class="status-bar">
        <span class="status-stat">
          <span class="stat-num stat-active">{{ activeCount }}</span>
          <span class="stat-label">ATIVO</span>
        </span>
        <span class="status-sep">&middot;</span>
        <span class="status-stat">
          <span class="stat-num stat-error">{{ errorCount }}</span>
          <span class="stat-label">COM ERRO</span>
        </span>
        <span class="status-sep">&middot;</span>
        <span class="status-stat">
          <span class="stat-num">{{ totalIngested }}</span>
          <span class="stat-label">REGISTROS IMPORTADOS</span>
        </span>
      </div>

      @if (!connectors.length) {
        <div class="empty-state">
          <mat-icon class="empty-icon">cable</mat-icon>
          <p class="empty-title">Nenhuma integração configurada</p>
          <p class="empty-sub">Conecte seu sistema legado em menos de 15 minutos</p>
          <button class="new-btn" (click)="goToWizard()">
            <mat-icon>add</mat-icon> Criar primeira integração
          </button>
        </div>
      }

      @for (c of connectors; track c.id) {
        <div class="connector-card">
          <div class="connector-header">
            <div class="connector-info">
              <div class="connector-dot"
                [class.dot-active]="c.status === 'active'"
                [class.dot-error]="c.status === 'error'"
                [class.dot-inactive]="c.status === 'inactive'">
              </div>
              <div>
                <span class="connector-name">{{ c.name }}</span>
                <span class="connector-mode">{{ modeLabel(c.mode) }}</span>
              </div>
            </div>
            <div class="connector-status-badge" [class]="'badge-' + c.status">
              {{ c.status.toUpperCase() }}
            </div>
          </div>

          <div class="connector-meta">
            @if (c.last_sync_at) {
              <span class="meta-item">
                <mat-icon class="meta-icon">sync</mat-icon>
                Último sync: {{ c.last_sync_at | date:'dd/MM HH:mm' }}
              </span>
            }
            <span class="meta-item">
              <mat-icon class="meta-icon">download</mat-icon>
              {{ c.sync_count }} registros importados
            </span>
            <span class="meta-item">
              <mat-icon class="meta-icon">schedule</mat-icon>
              Criado em {{ c.created_at | date:'dd/MM/yyyy' }}
            </span>
          </div>

          @if (c.error_msg) {
            <div class="connector-error">{{ c.error_msg }}</div>
          }

          <div class="connector-actions">
            <button class="action-btn" (click)="testConnection(c)" [disabled]="testing === c.id"
              matTooltip="Testar conexão">
              <mat-icon>cable</mat-icon>
              {{ testing === c.id ? 'Testando...' : 'Testar' }}
            </button>
            <button class="action-btn action-btn-ghost" (click)="toggleStatus(c)"
              [matTooltip]="c.status === 'active' ? 'Desativar' : 'Ativar'">
              <mat-icon>{{ c.status === 'active' ? 'pause' : 'play_arrow' }}</mat-icon>
              {{ c.status === 'active' ? 'Desativar' : 'Ativar' }}
            </button>
            <button class="action-btn action-btn-danger" (click)="deleteConnector(c)"
              matTooltip="Excluir conector">
              <mat-icon>delete</mat-icon>
            </button>
          </div>

          @if (testResult[c.id]) {
            <div class="test-result" [class.test-ok]="testResult[c.id].ok" [class.test-fail]="!testResult[c.id].ok">
              {{ testResult[c.id].message }}
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; background: #0b1326; min-height: 100vh; padding: 2rem; }

    .page-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;
    }

    .page-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.5rem; color: #dae2fd; margin: 0 0 0.25rem 0;
    }

    .page-subtitle {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; color: #464554; letter-spacing: 0.08em;
    }

    .new-btn {
      display: flex; align-items: center; gap: 0.5rem;
      background: #c0c1ff; color: #1000a9; border: none; border-radius: 4px;
      padding: 0.625rem 1.25rem; font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 0.8125rem; text-transform: uppercase;
      letter-spacing: 0.06em; cursor: pointer;
      transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .new-btn:hover { opacity: 0.88; }

    .status-bar {
      display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem;
      background: #131b2e; border: 1px solid rgba(70,69,84,0.15);
      border-radius: 4px; padding: 0.875rem 1.25rem;
    }
    .status-stat { display: flex; align-items: center; gap: 0.5rem; }
    .status-sep { color: #464554; }
    .stat-num {
      font-family: 'JetBrains Mono', monospace; font-weight: 700;
      font-size: 1.125rem; color: #c0c1ff;
    }
    .stat-num.stat-active { color: #10b981; }
    .stat-num.stat-error { color: #ffb4ab; }
    .stat-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.1em; color: #464554;
    }

    .empty-state {
      display: flex; flex-direction: column; align-items: center;
      gap: 0.75rem; padding: 4rem 2rem; text-align: center;
      border: 1px dashed rgba(70,69,84,0.3); border-radius: 8px;
    }
    .empty-icon { font-size: 3rem; width: 3rem; height: 3rem; color: #464554; }
    .empty-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1rem; color: #dae2fd; margin: 0;
    }
    .empty-sub { font-family: 'Inter', sans-serif; font-size: 13px; color: #908fa0; margin: 0; }

    .connector-card {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.15);
      border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;
      transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .connector-card:hover { border-color: rgba(70,69,84,0.35); }

    .connector-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 1rem;
    }
    .connector-info { display: flex; align-items: center; gap: 0.75rem; }
    .connector-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #464554; flex-shrink: 0;
    }
    .dot-active { background: #10b981; box-shadow: 0 0 6px #10b98166; }
    .dot-error { background: #ffb4ab; }
    .dot-inactive { background: #464554; }

    .connector-name {
      display: block; font-family: 'Space Grotesk', sans-serif;
      font-weight: 600; font-size: 1rem; color: #dae2fd;
    }
    .connector-mode {
      display: block; font-family: 'JetBrains Mono', monospace;
      font-size: 10px; text-transform: uppercase; color: #464554;
      letter-spacing: 0.08em; margin-top: 2px;
    }

    .connector-status-badge {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; padding: 3px 10px; border-radius: 4px;
      letter-spacing: 0.08em;
    }
    .badge-active { background: rgba(16,185,129,0.1); color: #10b981; }
    .badge-inactive { background: #1e2740; color: #908fa0; }
    .badge-error { background: rgba(255,180,171,0.1); color: #ffb4ab; }

    .connector-meta {
      display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem;
    }
    .meta-item {
      display: flex; align-items: center; gap: 0.25rem;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #908fa0;
    }
    .meta-icon { font-size: 14px !important; width: 14px !important; height: 14px !important; }

    .connector-error {
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #ffb4ab;
      background: rgba(147,0,10,0.1); border: 1px solid rgba(255,180,171,0.15);
      border-radius: 4px; padding: 0.5rem 0.75rem; margin-bottom: 1rem;
    }

    .connector-actions { display: flex; align-items: center; gap: 0.5rem; }

    .action-btn {
      display: flex; align-items: center; gap: 0.375rem;
      background: rgba(192,193,255,0.08); color: #c0c1ff;
      border: 1px solid rgba(70,69,84,0.25); border-radius: 4px;
      padding: 0.375rem 0.75rem; font-family: 'JetBrains Mono', monospace;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
      cursor: pointer; transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .action-btn:hover:not(:disabled) { background: rgba(192,193,255,0.15); }
    .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .action-btn-ghost { background: transparent; color: #908fa0; }
    .action-btn-ghost:hover:not(:disabled) { background: #1e2740; color: #dae2fd; }
    .action-btn-danger { background: transparent; color: #ffb4ab; border-color: rgba(255,180,171,0.2); }
    .action-btn-danger:hover:not(:disabled) { background: rgba(147,0,10,0.1); }

    .test-result {
      margin-top: 0.75rem; padding: 0.5rem 0.75rem; border-radius: 4px;
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
    }
    .test-ok { background: rgba(16,185,129,0.08); color: #10b981; border: 1px solid rgba(16,185,129,0.2); }
    .test-fail { background: rgba(147,0,10,0.1); color: #ffb4ab; border: 1px solid rgba(255,180,171,0.15); }
  `]
})
export class IntegrationsComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);

  connectors: Connector[] = [];
  testing = '';
  testResult: Record<string, { ok: boolean; message: string }> = {};

  get activeCount() { return this.connectors.filter(c => c.status === 'active').length; }
  get errorCount() { return this.connectors.filter(c => c.status === 'error').length; }
  get totalIngested() { return this.connectors.reduce((s, c) => s + c.sync_count, 0); }

  ngOnInit(): void { this.loadConnectors(); }

  loadConnectors(): void {
    this.http.get<Connector[]>(`${environment.apiUrl}/integrations`)
      .subscribe(c => this.connectors = c);
  }

  goToWizard(): void { this.router.navigate(['/clinic/integrations/new']); }

  modeLabel(mode: string): string {
    return { swagger: 'REST / Swagger', hl7: 'HL7 v2.x', file_drop: 'File Drop' }[mode] ?? mode;
  }

  testConnection(c: Connector): void {
    this.testing = c.id;
    this.http.post<{ ok: boolean; fields_discovered?: number; error?: string }>(
      `${environment.apiUrl}/integrations/${c.id}/test`, {}
    ).subscribe({
      next: r => {
        this.testing = '';
        this.testResult[c.id] = {
          ok: true,
          message: `Conexão OK — ${r.fields_discovered} campos descobertos`
        };
      },
      error: err => {
        this.testing = '';
        this.testResult[c.id] = {
          ok: false,
          message: err.error?.error ?? 'Falha na conexão'
        };
      }
    });
  }

  toggleStatus(c: Connector): void {
    const newStatus = c.status === 'active' ? 'inactive' : 'active';
    this.http.put<Connector>(`${environment.apiUrl}/integrations/${c.id}`, { status: newStatus })
      .subscribe(updated => {
        const idx = this.connectors.findIndex(x => x.id === c.id);
        if (idx !== -1) this.connectors[idx] = { ...this.connectors[idx], status: updated.status };
      });
  }

  deleteConnector(c: Connector): void {
    if (!confirm(`Excluir integração "${c.name}"?`)) return;
    this.http.delete(`${environment.apiUrl}/integrations/${c.id}`)
      .subscribe(() => this.connectors = this.connectors.filter(x => x.id !== c.id));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/features/clinic/integrations/integrations.component.ts
git commit -m "feat: integrations list page component — connector cards, status, test/toggle/delete"
```

---

## Task 7: Wizard Component

**Files:**
- Create: `apps/web/src/app/features/clinic/integrations/wizard/wizard.component.ts`

4-step wizard using Angular Material Stepper. Step 1: choose mode (only REST enabled in Phase 1). Step 2: configure connection (swagger URL + auth). Step 3: parse swagger and map fields to GenomaFlow targets. Step 4: save + activate.

GenomaFlow target fields for mapping:
- `patient.name` — Nome do paciente
- `patient.birth_date` — Data de nascimento
- `patient.sex` — Sexo (M/F)
- `exam.file_url` — URL do arquivo PDF
- `exam.external_id` — ID externo do exame

- [ ] **Step 1: Create the wizard component**

```typescript
// apps/web/src/app/features/clinic/integrations/wizard/wizard.component.ts
import { Component, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatStepperModule } from '@angular/material/stepper';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../../../environments/environment';
import { SwaggerParseResult } from '../../../../shared/models/api.models';

interface TargetField { key: string; label: string; required: boolean; }

const TARGET_FIELDS: TargetField[] = [
  { key: 'patient.name',       label: 'Nome do paciente',       required: true  },
  { key: 'patient.birth_date', label: 'Data de nascimento',     required: false },
  { key: 'patient.sex',        label: 'Sexo (M/F)',             required: false },
  { key: 'exam.file_url',      label: 'URL do arquivo PDF',     required: false },
  { key: 'exam.external_id',   label: 'ID externo do exame',    required: false },
];

@Component({
  selector: 'app-wizard',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatStepperModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatIconModule
  ],
  template: `
    <div class="wizard-page">
      <div class="wizard-header">
        <button class="back-btn" (click)="cancel()">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div>
          <h1 class="page-title">Nova Integração</h1>
          <span class="page-subtitle">INTEGRATION STUDIO &middot; CONFIGURAÇÃO</span>
        </div>
      </div>

      <div class="wizard-card">
        <mat-stepper [linear]="true" #stepper class="wizard-stepper">

          <!-- STEP 1: Choose mode -->
          <mat-step label="Tipo de integração">
            <div class="step-content">
              <p class="step-desc">Selecione como seu sistema envia dados para o GenomaFlow.</p>
              <div class="mode-grid">
                @for (m of modes; track m.key) {
                  <div class="mode-card"
                    [class.mode-selected]="selectedMode === m.key"
                    [class.mode-disabled]="!m.available"
                    (click)="m.available && (selectedMode = m.key)">
                    <mat-icon class="mode-icon">{{ m.icon }}</mat-icon>
                    <span class="mode-label">{{ m.label }}</span>
                    <span class="mode-sub">{{ m.sub }}</span>
                    @if (!m.available) {
                      <span class="coming-soon">EM BREVE</span>
                    }
                  </div>
                }
              </div>
              <div class="step-actions">
                <button class="wizard-btn" [disabled]="!selectedMode" matStepperNext>
                  Continuar <mat-icon>arrow_forward</mat-icon>
                </button>
              </div>
            </div>
          </mat-step>

          <!-- STEP 2: Configure connection -->
          <mat-step label="Configurar conexão" [stepControl]="connectionForm">
            <form [formGroup]="connectionForm">
              <div class="step-content">
                <p class="step-desc">Informe os dados de conexão com seu sistema.</p>

                <mat-form-field appearance="outline" class="field">
                  <mat-label>Nome da integração</mat-label>
                  <input matInput formControlName="name" placeholder="Ex: Tasy HIS" />
                </mat-form-field>

                <mat-form-field appearance="outline" class="field">
                  <mat-label>URL do Swagger / OpenAPI</mat-label>
                  <input matInput formControlName="swagger_url"
                    placeholder="https://sistema.hospital.com/api/docs/swagger.json" />
                  <mat-hint>Suporta OpenAPI 2.x e 3.x</mat-hint>
                </mat-form-field>

                <mat-form-field appearance="outline" class="field">
                  <mat-label>Tipo de autenticação</mat-label>
                  <mat-select formControlName="auth_type">
                    <mat-option value="none">Sem autenticação</mat-option>
                    <mat-option value="bearer">Bearer Token</mat-option>
                    <mat-option value="api_key">API Key</mat-option>
                    <mat-option value="basic">Basic Auth</mat-option>
                  </mat-select>
                </mat-form-field>

                @if (connectionForm.value.auth_type === 'bearer') {
                  <mat-form-field appearance="outline" class="field">
                    <mat-label>Bearer Token</mat-label>
                    <input matInput formControlName="auth_value" type="password" />
                  </mat-form-field>
                }
                @if (connectionForm.value.auth_type === 'api_key') {
                  <mat-form-field appearance="outline" class="field">
                    <mat-label>API Key</mat-label>
                    <input matInput formControlName="auth_value" />
                  </mat-form-field>
                }
                @if (connectionForm.value.auth_type === 'basic') {
                  <mat-form-field appearance="outline" class="field">
                    <mat-label>Usuário:Senha (user:password)</mat-label>
                    <input matInput formControlName="auth_value" placeholder="admin:secret" />
                  </mat-form-field>
                }

                <div class="step-actions">
                  <button class="wizard-btn-ghost" type="button" matStepperPrevious>Voltar</button>
                  <button class="wizard-btn" type="button"
                    [disabled]="connectionForm.invalid || parsing"
                    (click)="parseSwagger()">
                    {{ parsing ? 'Analisando...' : 'Analisar API' }}
                    @if (!parsing) { <mat-icon>search</mat-icon> }
                  </button>
                </div>

                @if (parseError) {
                  <div class="error-box">{{ parseError }}</div>
                }
              </div>
            </form>
          </mat-step>

          <!-- STEP 3: Map fields -->
          <mat-step label="Mapear campos">
            <div class="step-content">
              <p class="step-desc">
                {{ discoveredFields.length }} campos descobertos. Mapeie os campos do seu sistema
                para os campos do GenomaFlow.
              </p>

              <div class="field-map-table">
                <div class="field-map-header">
                  <span>CAMPO GENOMAFLOW</span>
                  <span>CAMPO DO SEU SISTEMA</span>
                </div>
                @for (tf of targetFields; track tf.key) {
                  <div class="field-map-row">
                    <div class="target-field">
                      <span class="target-key">{{ tf.label }}</span>
                      @if (tf.required) { <span class="required-badge">*</span> }
                    </div>
                    <mat-form-field appearance="outline" class="source-select">
                      <mat-select [(ngModel)]="fieldMap[tf.key]" [ngModelOptions]="{standalone: true}">
                        <mat-option value="">— não mapear —</mat-option>
                        @for (f of discoveredFields; track f) {
                          <mat-option [value]="'$.' + f">{{ f }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                  </div>
                }
              </div>

              <div class="step-actions">
                <button class="wizard-btn-ghost" matStepperPrevious>Voltar</button>
                <button class="wizard-btn" matStepperNext
                  [disabled]="!fieldMap['patient.name']">
                  Continuar <mat-icon>arrow_forward</mat-icon>
                </button>
              </div>
            </div>
          </mat-step>

          <!-- STEP 4: Activate -->
          <mat-step label="Ativar">
            <div class="step-content">
              <div class="activate-summary">
                <div class="summary-row">
                  <span class="summary-label">Nome</span>
                  <span class="summary-value">{{ connectionForm.value.name }}</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">Modo</span>
                  <span class="summary-value">REST / Swagger</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">API URL</span>
                  <span class="summary-value mono">{{ connectionForm.value.swagger_url }}</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">Campos mapeados</span>
                  <span class="summary-value">{{ mappedCount }} de {{ targetFields.length }}</span>
                </div>
              </div>

              <div class="webhook-info">
                <p class="webhook-label">WEBHOOK INBOUND</p>
                <p class="webhook-url mono">POST {{ apiUrl }}/integrations/&#123;id&#125;/ingest</p>
                <p class="webhook-hint">
                  Após ativar, configure seu sistema legado para enviar eventos para este endpoint.
                  O secret HMAC será exibido após salvar.
                </p>
              </div>

              @if (saveError) {
                <div class="error-box">{{ saveError }}</div>
              }

              <div class="step-actions">
                <button class="wizard-btn-ghost" matStepperPrevious>Voltar</button>
                <button class="wizard-btn wizard-btn-activate"
                  [disabled]="saving"
                  (click)="activate()">
                  {{ saving ? 'Ativando...' : 'Ativar integração' }}
                  @if (!saving) { <mat-icon>check_circle</mat-icon> }
                </button>
              </div>
            </div>
          </mat-step>

        </mat-stepper>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; background: #0b1326; min-height: 100vh; padding: 2rem; }

    .wizard-header {
      display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem;
    }
    .back-btn {
      background: none; border: 1px solid rgba(70,69,84,0.25); border-radius: 4px;
      padding: 0.5rem; cursor: pointer; color: #908fa0; display: flex; align-items: center;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .back-btn:hover { background: #131b2e; color: #dae2fd; }

    .page-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.5rem; color: #dae2fd; margin: 0 0 0.25rem;
    }
    .page-subtitle {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; color: #464554; letter-spacing: 0.08em;
    }

    .wizard-card {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.15);
      border-radius: 8px; overflow: hidden;
    }

    .step-content { padding: 1.5rem 0; max-width: 600px; }
    .step-desc {
      font-family: 'Inter', sans-serif; font-size: 14px; color: #908fa0;
      margin: 0 0 1.5rem;
    }

    .mode-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem;
    }
    .mode-card {
      display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
      padding: 1.5rem 1rem; border: 1px solid rgba(70,69,84,0.25); border-radius: 8px;
      cursor: pointer; text-align: center; position: relative;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1); background: #0b1326;
    }
    .mode-card:hover:not(.mode-disabled) { border-color: rgba(192,193,255,0.4); background: #171f33; }
    .mode-selected { border-color: #494bd6 !important; background: #171f33 !important; }
    .mode-disabled { opacity: 0.4; cursor: not-allowed; }
    .mode-icon { font-size: 2rem; width: 2rem; height: 2rem; color: #c0c1ff; }
    .mode-label {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 0.875rem; color: #dae2fd;
    }
    .mode-sub { font-family: 'Inter', sans-serif; font-size: 12px; color: #908fa0; }
    .coming-soon {
      position: absolute; top: 0.5rem; right: 0.5rem;
      font-family: 'JetBrains Mono', monospace; font-size: 8px;
      text-transform: uppercase; background: #2d3449; color: #908fa0;
      padding: 2px 6px; border-radius: 3px; letter-spacing: 0.08em;
    }

    .field { width: 100%; margin-bottom: 0.5rem; }

    .field-map-table { margin-bottom: 1.5rem; }
    .field-map-header {
      display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.1em; color: #464554;
      padding: 0 0 0.5rem; border-bottom: 1px solid rgba(70,69,84,0.15);
      margin-bottom: 0.5rem;
    }
    .field-map-row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
      align-items: center; margin-bottom: 0.25rem;
    }
    .target-field { display: flex; align-items: center; gap: 0.375rem; }
    .target-key {
      font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #c7c4d7;
    }
    .required-badge {
      font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #ffb4ab;
    }
    .source-select { width: 100%; }

    .step-actions { display: flex; align-items: center; gap: 0.75rem; margin-top: 1.5rem; }

    .wizard-btn {
      display: flex; align-items: center; gap: 0.5rem;
      background: #c0c1ff; color: #1000a9; border: none; border-radius: 4px;
      padding: 0.625rem 1.25rem; font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 0.8125rem; text-transform: uppercase;
      letter-spacing: 0.06em; cursor: pointer;
      transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .wizard-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .wizard-btn:hover:not(:disabled) { opacity: 0.88; }
    .wizard-btn-activate { background: #10b981; color: #052e16; }
    .wizard-btn-ghost {
      background: none; color: #908fa0; border: 1px solid rgba(70,69,84,0.25);
      border-radius: 4px; padding: 0.625rem 1rem; font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 0.8125rem; text-transform: uppercase;
      cursor: pointer; transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .wizard-btn-ghost:hover { background: #131b2e; color: #dae2fd; }

    .error-box {
      margin-top: 1rem; padding: 0.625rem 0.875rem; border-radius: 4px;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #ffb4ab;
      background: rgba(147,0,10,0.12); border: 1px solid rgba(255,180,171,0.2);
    }

    .activate-summary {
      background: #0b1326; border: 1px solid rgba(70,69,84,0.15); border-radius: 8px;
      padding: 1.25rem; margin-bottom: 1.5rem;
    }
    .summary-row {
      display: grid; grid-template-columns: 140px 1fr; gap: 1rem;
      padding: 0.5rem 0; border-bottom: 1px solid rgba(70,69,84,0.08);
    }
    .summary-row:last-child { border-bottom: none; }
    .summary-label {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.08em; color: #464554;
      align-self: center;
    }
    .summary-value { font-family: 'Inter', sans-serif; font-size: 14px; color: #c7c4d7; }
    .summary-value.mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    .mono { font-family: 'JetBrains Mono', monospace; }

    .webhook-info {
      background: rgba(73,75,214,0.06); border: 1px solid rgba(73,75,214,0.2);
      border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem;
    }
    .webhook-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.1em; color: #464554; margin: 0 0 0.5rem;
    }
    .webhook-url {
      font-family: 'JetBrains Mono', monospace; font-size: 12px;
      color: #c0c1ff; margin: 0 0 0.5rem;
    }
    .webhook-hint {
      font-family: 'Inter', sans-serif; font-size: 12px; color: #908fa0; margin: 0;
    }

    /* Override Material Stepper colors for dark theme */
    ::ng-deep .wizard-stepper .mat-stepper-horizontal { background: transparent; }
    ::ng-deep .wizard-stepper .mat-step-header { padding: 1rem 1.5rem; }
    ::ng-deep .wizard-stepper .mat-horizontal-stepper-header-container {
      border-bottom: 1px solid rgba(70,69,84,0.15);
    }
    ::ng-deep .wizard-stepper .mat-horizontal-content-container { padding: 0 1.5rem 1.5rem; }
    ::ng-deep .wizard-stepper .mat-step-label { color: #908fa0; font-family: 'Space Grotesk', sans-serif; }
    ::ng-deep .wizard-stepper .mat-step-label.mat-step-label-active { color: #dae2fd; }
    ::ng-deep .wizard-stepper .mat-step-icon { background-color: #2d3449; color: #908fa0; }
    ::ng-deep .wizard-stepper .mat-step-icon.mat-step-icon-selected,
    ::ng-deep .wizard-stepper .mat-step-icon.mat-step-icon-state-edit { background-color: #494bd6; color: #fff; }
    ::ng-deep .wizard-stepper .mat-stepper-horizontal-line { border-top-color: rgba(70,69,84,0.2); }
  `]
})
export class WizardComponent {
  private http = inject(HttpClient);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  readonly apiUrl = environment.apiUrl;
  readonly targetFields = TARGET_FIELDS;

  modes = [
    { key: 'swagger', label: 'REST / Swagger', sub: 'Tasy, MV SOUL, iClinic', icon: 'api', available: true },
    { key: 'hl7',     label: 'HL7 v2.x',       sub: 'HIS/LIS hospitalar',     icon: 'local_hospital', available: false },
    { key: 'file',    label: 'File Drop',       sub: 'SFTP / S3 / ZIP',        icon: 'folder_open', available: false },
  ];

  selectedMode = 'swagger';
  discoveredFields: string[] = [];
  fieldMap: Record<string, string> = {};

  parsing = false;
  parseError = '';
  saving = false;
  saveError = '';

  connectionForm = this.fb.group({
    name:        ['', Validators.required],
    swagger_url: ['', Validators.required],
    auth_type:   ['none'],
    auth_value:  ['']
  });

  get mappedCount(): number {
    return Object.values(this.fieldMap).filter(v => !!v).length;
  }

  cancel(): void { this.router.navigate(['/clinic/integrations']); }

  parseSwagger(): void {
    const url = this.connectionForm.value.swagger_url!;
    this.parsing = true;
    this.parseError = '';
    this.http.post<SwaggerParseResult>(`${environment.apiUrl}/integrations/swagger/parse`, { url })
      .subscribe({
        next: r => {
          this.parsing = false;
          this.discoveredFields = r.fields;
          // Navigate to next step via stepper — trigger from template with matStepperNext
          // We do it programmatically below
          document.querySelector<HTMLElement>('[matStepperNext]')?.click();
        },
        error: err => {
          this.parsing = false;
          this.parseError = err.error?.error ?? 'Falha ao analisar a URL do Swagger';
        }
      });
  }

  activate(): void {
    this.saving = true;
    this.saveError = '';

    const { name, swagger_url, auth_type, auth_value } = this.connectionForm.value;
    const config: Record<string, string> = { swagger_url: swagger_url! };
    if (auth_type && auth_type !== 'none') {
      config['auth_type'] = auth_type;
      config['auth_value'] = auth_value ?? '';
    }

    // Filter out empty mappings
    const field_map: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.fieldMap)) {
      if (v) field_map[k] = v;
    }

    this.http.post<{ id: string }>(
      `${environment.apiUrl}/integrations`,
      { name, mode: 'swagger', config, field_map }
    ).pipe(
      // Activate immediately after creation
    ).subscribe({
      next: connector => {
        this.http.put(`${environment.apiUrl}/integrations/${connector.id}`, { status: 'active' })
          .subscribe({
            next: () => {
              this.saving = false;
              this.router.navigate(['/clinic/integrations']);
            },
            error: () => {
              this.saving = false;
              this.router.navigate(['/clinic/integrations']);
            }
          });
      },
      error: err => {
        this.saving = false;
        this.saveError = err.error?.error ?? 'Erro ao salvar integração';
      }
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/features/clinic/integrations/wizard/wizard.component.ts
git commit -m "feat: integration studio wizard — 4-step connector configuration UI"
```

---

## Task 8: Wire Routes + Nav

**Files:**
- Modify: `apps/web/src/app/features/clinic/clinic.routes.ts`
- Modify: `apps/web/src/app/app.component.ts`

- [ ] **Step 1: Add integrations routes to clinic.routes.ts**

```typescript
// apps/web/src/app/features/clinic/clinic.routes.ts
import { Routes } from '@angular/router';

export const CLINIC_ROUTES: Routes = [
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'users',
    loadComponent: () =>
      import('./users/users.component').then(m => m.UsersComponent)
  },
  {
    path: 'integrations',
    loadComponent: () =>
      import('./integrations/integrations.component').then(m => m.IntegrationsComponent)
  },
  {
    path: 'integrations/new',
    loadComponent: () =>
      import('./integrations/wizard/wizard.component').then(m => m.WizardComponent)
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
];
```

- [ ] **Step 2: Add "Integrações" nav item in app.component.ts**

In `apps/web/src/app/app.component.ts`, inside the `@if (user.role === 'admin')` block, add the integrations link after the "Usuários" link:

```html
<!-- existing -->
<a class="nav-item" routerLink="/clinic/users" routerLinkActive="active">
  <mat-icon>group</mat-icon> Usuários
</a>
<!-- ADD THIS: -->
<a class="nav-item" routerLink="/clinic/integrations" routerLinkActive="active">
  <mat-icon>cable</mat-icon> Integrações
</a>
```

Full updated admin section in the template:

```html
@if (user.role === 'admin') {
  <div class="nav-section-label">Gestão</div>
  <a class="nav-item" routerLink="/clinic/dashboard" routerLinkActive="active">
    <mat-icon>dashboard</mat-icon> Dashboard
  </a>
  <a class="nav-item" routerLink="/clinic/users" routerLinkActive="active">
    <mat-icon>group</mat-icon> Usuários
  </a>
  <a class="nav-item" routerLink="/clinic/integrations" routerLinkActive="active">
    <mat-icon>cable</mat-icon> Integrações
  </a>
}
```

- [ ] **Step 3: Verify Angular compiles**

```bash
cd apps/web
npx ng build --configuration production 2>&1 | tail -20
```

Expected: `Build at: ... - Hash: ... - Time: ...ms` with no errors.

If dev server is already running (`ng serve`), it will auto-reload and you can verify in the browser at `http://localhost:4200`.

- [ ] **Step 4: Smoke test in browser**

1. Login as admin user
2. Sidebar shows "Integrações" link
3. Click → `/clinic/integrations` renders the empty state with "Nova Integração" button
4. Click "Nova Integração" → `/clinic/integrations/new` shows the 4-step wizard
5. Step 1 shows mode cards (REST enabled, HL7 and File Drop greyed with "EM BREVE")
6. Click "Continuar" → Step 2 shows connection form
7. Enter a name and swagger URL (e.g. `https://petstore.swagger.io/v2/swagger.json`) → click "Analisar API"
8. After parse: moves to Step 3 with field dropdowns populated from swagger
9. Map "patient.name" to any field → "Continuar" enables
10. Step 4 shows summary and "Ativar integração" button
11. Click → connector created, navigated back to list page showing the new connector as ACTIVE

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/clinic/clinic.routes.ts apps/web/src/app/app.component.ts
git commit -m "feat: wire integration studio routes and sidebar nav item"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] REST/Swagger Connect mode — connector CRUD, swagger parse, field mapping, webhook ingest
- [x] UI wizard 4 steps (mode → configure → map → activate) — Task 7
- [x] `/clinic/integrations` page with connector cards — Task 6
- [x] Sidebar nav item for admin — Task 8
- [x] DB tables + RLS — Task 1
- [x] Webhook HMAC validation — Task 3 (`verifySignature`)
- [x] Patient find-or-create on ingest — Task 3
- [x] Logs table + endpoints — Tasks 1, 3
- [x] Phase 1 scope only (HL7 + File Drop greyed as "em breve") — Task 7 wizard
- [ ] AI field mapping — **intentionally deferred to Phase 4** (spec §Fase 4)
- [ ] HL7 Listener — **intentionally deferred to Phase 3**
- [ ] File Drop — **intentionally deferred to Phase 2**

**Type consistency check:**
- `Connector` interface in `api.models.ts` (Task 5) matches `integration_connectors` columns returned by API routes (Task 3) ✓
- `SwaggerParseResult` matches `POST /integrations/swagger/parse` response shape `{ fields: string[] }` ✓
- `TARGET_FIELDS` keys (`patient.name`, etc.) match `resolveFieldMap` usage in ingest handler ✓
- `downloadFile` utility in routes uses Node built-in `https`/`http` — no external deps needed ✓
