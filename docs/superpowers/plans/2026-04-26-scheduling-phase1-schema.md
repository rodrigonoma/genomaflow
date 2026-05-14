# Agendamento — Fase 1 (Schema + RLS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar tabelas `schedule_settings` e `appointments` com RLS + EXCLUDE constraint pra não-sobreposição, ativar `btree_gist`, adicionar `tenants.timezone`. Não inclui rotas API nem frontend (Fase 2 e 3).

**Architecture:** Migration SQL numerada 053. Schema imutável-by-design (D1 do spec). RLS ENABLE+FORCE com policy NULLIF (compat login). EXCLUDE GIST pra impedir overlap no DB. Tests de RLS validam isolation cross-tenant + EXCLUDE garante 23P01 em overlap.

**Tech Stack:** PostgreSQL 15 + pgvector (já existente) + extension `btree_gist` (nova).

**Branch:** `feat/scheduling-schema` (criada a partir da main após aprovação deste plano)

**Spec:** `docs/superpowers/specs/2026-04-26-scheduling-design.md`

---

## File Structure

| Path | Ação | Responsabilidade |
|---|---|---|
| `apps/api/src/db/migrations/053_scheduling.sql` | Criar | Extension btree_gist + tenants.timezone + 2 tabelas + RLS + indexes + grants |
| `apps/api/tests/db/migration-053-scheduling.test.js` | Criar | Testes de schema, RLS, EXCLUDE constraint contra DB real (rodam local com docker compose) |
| `apps/api/package.json` | Modificar | Path do novo teste em `test:unit` (somente se rodar sem DB) — neste caso vai pro `test` completo, não pro `test:unit` |
| `docs/claude-memory/project_context.md` | Modificar | Atualizar contagem de migrations e adicionar tabelas novas à lista RLS |

---

## Pre-flight

- [ ] **Step 0: Branch a partir de main**

```bash
git checkout main && git pull --ff-only origin main
git checkout -b feat/scheduling-schema
```

Expected: branch `feat/scheduling-schema` ativa, working tree limpo.

---

## Task 1: Migration SQL

**Files:**
- Create: `apps/api/src/db/migrations/053_scheduling.sql`

- [ ] **Step 1.1: Criar arquivo da migration**

Conteúdo completo:

```sql
-- Migration 053: Agendamento de exames/consultas
-- Spec: docs/superpowers/specs/2026-04-26-scheduling-design.md
-- Tabelas: schedule_settings (1:1 com user) + appointments (eventos)
-- Garantia DB: EXCLUDE constraint impede agendamentos sobrepostos do mesmo médico

-- Extension necessária pra EXCLUDE multi-coluna (btree + gist)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Timezone da clínica (UTC → local time na render). IANA string.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- ── schedule_settings ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  default_slot_minutes INT NOT NULL DEFAULT 30
    CHECK (default_slot_minutes IN (30, 45, 60, 75, 90, 105, 120)),
  business_hours JSONB NOT NULL DEFAULT '{
    "mon": [["09:00","12:00"],["14:00","18:00"]],
    "tue": [["09:00","12:00"],["14:00","18:00"]],
    "wed": [["09:00","12:00"],["14:00","18:00"]],
    "thu": [["09:00","12:00"],["14:00","18:00"]],
    "fri": [["09:00","12:00"],["14:00","18:00"]],
    "sat": [],
    "sun": []
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE schedule_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY schedule_settings_tenant ON schedule_settings
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- ── appointments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  series_id UUID,
  start_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  status TEXT NOT NULL CHECK (status IN (
    'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'blocked'
  )),
  reason TEXT,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,

  -- Não-sobreposição garantida no DB (race-condition-proof)
  -- cancelled e no_show liberam o slot
  EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(start_at, start_at + (duration_minutes * INTERVAL '1 minute'), '[)') WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'))
);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;

CREATE POLICY appointments_tenant ON appointments
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- Índices
CREATE INDEX IF NOT EXISTS appointments_user_start_idx
  ON appointments (user_id, start_at)
  WHERE status NOT IN ('cancelled', 'no_show');

CREATE INDEX IF NOT EXISTS appointments_tenant_idx
  ON appointments (tenant_id);

CREATE INDEX IF NOT EXISTS appointments_subject_idx
  ON appointments (subject_id) WHERE subject_id IS NOT NULL;

-- Grants pro role da aplicação
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_settings TO genomaflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON appointments TO genomaflow_app;
```

- [ ] **Step 1.2: Aplicar migration localmente**

```bash
docker compose exec api node src/db/migrate.js
```

Expected: log mostra `Applied: 053_scheduling.sql`. Sem erro.

- [ ] **Step 1.3: Verificar schema aplicado**

```bash
docker compose exec db psql -U postgres genomaflow -c "\d appointments" | head -30
docker compose exec db psql -U postgres genomaflow -c "\d schedule_settings" | head -10
docker compose exec db psql -U postgres genomaflow -c "SELECT extname FROM pg_extension WHERE extname='btree_gist';"
docker compose exec db psql -U postgres genomaflow -c "SELECT column_name FROM information_schema.columns WHERE table_name='tenants' AND column_name='timezone';"
```

Expected:
- `\d appointments` mostra todas as colunas + EXCLUDE constraint listada
- `\d schedule_settings` mostra config + RLS habilitado
- Extension `btree_gist` retorna 1 linha
- `tenants.timezone` existe

- [ ] **Step 1.4: Commit da migration**

```bash
git add apps/api/src/db/migrations/053_scheduling.sql
git commit -m "feat(scheduling): migration 053 — schedule_settings + appointments + RLS"
```

---

## Task 2: Test de schema (DB-dependent)

**Files:**
- Create: `apps/api/tests/db/migration-053-scheduling.test.js`

Estes testes rodam contra Postgres real. Não vão pro `test:unit` (CI gate); ficam no `test` completo (rodam local com docker compose).

- [ ] **Step 2.1: Escrever teste falhando — RLS isolation**

```javascript
const { Pool } = require('pg');

// Pool com role genomaflow_app (não bypassa RLS)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgres://genomaflow_app:devpass@localhost:5432/genomaflow',
});

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

async function withTenant(tenantId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
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

describe('migration 053 — RLS isolation', () => {
  let userA, userB;

  beforeAll(async () => {
    // tenants NÃO tem RLS — INSERT direto OK
    await pool.query(`INSERT INTO tenants (id, name, type, plan, module)
      VALUES ($1, 'Test A', 'clinic', 'starter', 'human'),
             ($2, 'Test B', 'clinic', 'starter', 'veterinary')
      ON CONFLICT (id) DO NOTHING`, [TENANT_A, TENANT_B]);

    // users TEM RLS FORCE — INSERT exige withTenant pra cada um
    const ua = await withTenant(TENANT_A, (c) => c.query(
      `INSERT INTO users (tenant_id, email, password_hash, role, name)
       VALUES ($1, 'doc-a-053@test.com', 'x', 'admin', 'Doc A')
       ON CONFLICT (email) DO UPDATE SET password_hash = 'x'
       RETURNING id`, [TENANT_A]
    ));
    const ub = await withTenant(TENANT_B, (c) => c.query(
      `INSERT INTO users (tenant_id, email, password_hash, role, name)
       VALUES ($1, 'doc-b-053@test.com', 'x', 'admin', 'Doc B')
       ON CONFLICT (email) DO UPDATE SET password_hash = 'x'
       RETURNING id`, [TENANT_B]
    ));
    userA = ua.rows[0].id;
    userB = ub.rows[0].id;
  });

  afterAll(async () => {
    // Cleanup
    await pool.query(`DELETE FROM appointments WHERE user_id IN ($1, $2)`, [userA, userB]);
    await pool.query(`DELETE FROM schedule_settings WHERE user_id IN ($1, $2)`, [userA, userB]);
    await pool.end();
  });

  test('tenant A não vê appointments do tenant B', async () => {
    // Insere via tenant B
    await withTenant(TENANT_B, (c) => c.query(
      `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
       VALUES ($1, $2, '2030-01-01 10:00:00+00', 30, 'scheduled', $2)`,
      [TENANT_B, userB]
    ));

    // Lê via tenant A
    const visible = await withTenant(TENANT_A, (c) =>
      c.query(`SELECT COUNT(*)::int AS n FROM appointments WHERE user_id = $1`, [userB])
    );
    expect(visible.rows[0].n).toBe(0);
  });
});
```

- [ ] **Step 2.2: Rodar teste e ver passar (já que migration aplicou e RLS está ativa)**

```bash
docker compose exec api npx jest tests/db/migration-053-scheduling.test.js
```

Expected: PASS (RLS funciona).

- [ ] **Step 2.3: Adicionar teste — EXCLUDE constraint impede overlap**

Anexar ao mesmo arquivo:

```javascript
describe('migration 053 — EXCLUDE constraint', () => {
  test('agendamento sobreposto retorna erro 23P01', async () => {
    await withTenant(TENANT_A, async (c) => {
      // Primeiro insert OK
      await c.query(
        `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
         VALUES ($1, $2, '2030-02-01 10:00:00+00', 30, 'scheduled', $2)`,
        [TENANT_A, userA]
      );

      // Segundo insert sobrepõe (10:15 dentro do primeiro)
      await expect(c.query(
        `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
         VALUES ($1, $2, '2030-02-01 10:15:00+00', 30, 'scheduled', $2)`,
        [TENANT_A, userA]
      )).rejects.toMatchObject({ code: '23P01' });
    });
  });

  test('agendamentos adjacentes (10:00-10:30 e 10:30-11:00) são permitidos', async () => {
    await withTenant(TENANT_A, async (c) => {
      await c.query(
        `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
         VALUES ($1, $2, '2030-03-01 10:00:00+00', 30, 'scheduled', $2)`,
        [TENANT_A, userA]
      );
      await expect(c.query(
        `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
         VALUES ($1, $2, '2030-03-01 10:30:00+00', 30, 'scheduled', $2)`,
        [TENANT_A, userA]
      )).resolves.toBeDefined();
    });
  });

  test('cancelar libera o slot — agendamento substituto cabe', async () => {
    await withTenant(TENANT_A, async (c) => {
      const r1 = await c.query(
        `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
         VALUES ($1, $2, '2030-04-01 10:00:00+00', 30, 'scheduled', $2)
         RETURNING id`,
        [TENANT_A, userA]
      );
      const id = r1.rows[0].id;

      // Cancela
      await c.query(
        `UPDATE appointments SET status='cancelled', cancelled_at=NOW() WHERE id=$1`,
        [id]
      );

      // Novo agendamento no mesmo horário deve passar
      await expect(c.query(
        `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
         VALUES ($1, $2, '2030-04-01 10:00:00+00', 30, 'scheduled', $2)`,
        [TENANT_A, userA]
      )).resolves.toBeDefined();
    });
  });
});
```

- [ ] **Step 2.4: Rodar e validar**

```bash
docker compose exec api npx jest tests/db/migration-053-scheduling.test.js
```

Expected: 4 testes PASS (RLS isolation + 3 cases de EXCLUDE).

- [ ] **Step 2.5: Adicionar teste de check constraint duration**

Anexar:

```javascript
describe('migration 053 — duration check', () => {
  test('duration_minutes < 5 rejeitado', async () => {
    await withTenant(TENANT_A, async (c) => {
      await expect(c.query(
        `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
         VALUES ($1, $2, '2030-05-01 10:00:00+00', 4, 'scheduled', $2)`,
        [TENANT_A, userA]
      )).rejects.toThrow();
    });
  });

  test('duration_minutes > 480 rejeitado', async () => {
    await withTenant(TENANT_A, async (c) => {
      await expect(c.query(
        `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
         VALUES ($1, $2, '2030-05-01 10:00:00+00', 481, 'scheduled', $2)`,
        [TENANT_A, userA]
      )).rejects.toThrow();
    });
  });

  test('default_slot_minutes fora do enum CHECK rejeitado em schedule_settings', async () => {
    await withTenant(TENANT_A, async (c) => {
      await expect(c.query(
        `INSERT INTO schedule_settings (user_id, tenant_id, default_slot_minutes)
         VALUES ($1, $2, 35)`,
        [userA, TENANT_A]
      )).rejects.toThrow();
    });
  });

  test('status fora do enum CHECK rejeitado', async () => {
    await withTenant(TENANT_A, async (c) => {
      await expect(c.query(
        `INSERT INTO appointments (tenant_id, user_id, start_at, duration_minutes, status, created_by)
         VALUES ($1, $2, '2030-06-01 10:00:00+00', 30, 'invalid_status', $2)`,
        [TENANT_A, userA]
      )).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2.6: Rodar suite completa**

```bash
docker compose exec api npx jest tests/db/migration-053-scheduling.test.js
```

Expected: 8 testes PASS no total.

- [ ] **Step 2.7: Commit dos tests**

```bash
git add apps/api/tests/db/migration-053-scheduling.test.js
git commit -m "test(scheduling): RLS isolation + EXCLUDE constraint + check constraints"
```

---

## Task 3: Atualizar memória do projeto

**Files:**
- Modify: `docs/claude-memory/project_context.md` (adicionar tabelas à lista RLS)

- [ ] **Step 3.1: Editar project_context.md**

Procurar a seção sobre RLS multi-tenant. Adicionar `appointments`, `schedule_settings` à lista de tabelas com RLS ativo. (Lista atual está em `CLAUDE.md` e `project_security_hardening.md`.)

Edit em `CLAUDE.md` na lista "Tabelas com RLS ativo (ENABLE + FORCE)":

```diff
- `patients`, `exams`, `clinical_results`, ..., `tenant_conversation_reads`
+ `patients`, `exams`, `clinical_results`, ..., `tenant_conversation_reads`, `schedule_settings`, `appointments`
```

- [ ] **Step 3.2: Commit**

```bash
git add CLAUDE.md docs/claude-memory/project_context.md
git commit -m "docs(memory): registra schedule_settings + appointments na lista RLS"
```

---

## Task 4: Smoke test final + push + apresentar

- [ ] **Step 4.1: Verificar que `test:unit` (CI gate) ainda passa intacto**

Migration nova só adiciona schema; não impacta tests unit existentes.

```bash
cd apps/api && npm run test:unit
```

Expected: 176+ tests passing (mesmo número de antes).

- [ ] **Step 4.2: Verificar nada quebrou na app**

```bash
docker compose up -d
docker compose logs api | tail -20
```

Expected: API sobe sem erro de inicialização. Migrations aplicadas listadas inclui `053_scheduling.sql`.

- [ ] **Step 4.3: Smoke local — login admin → app carrega**

Manual: abrir `http://localhost:4200`, login com user admin, navegar pra `/doctor/patients`, verificar que tudo carrega normal. Nada deve mudar visualmente — feature ainda não tem UI.

- [ ] **Step 4.4: Push branch**

```bash
git push -u origin feat/scheduling-schema
```

- [ ] **Step 4.5: Apresentar para aprovação**

Mensagem para o usuário:

> "Fase 1 (schema) entregue na branch `feat/scheduling-schema`. Migration 053 aplicada local, 8 testes RLS+EXCLUDE+check passando. test:unit do CI gate continua verde (176 tests). Smoke test manual: app carrega normal, nenhum impacto visual. Posso mergear pra main?"

**NÃO mergear sem OK explícito do usuário** (regra CLAUDE.md).

- [ ] **Step 4.6: Após OK — merge + deploy**

```bash
git checkout main
git merge --no-ff feat/scheduling-schema -m "merge: feat/scheduling-schema → main"
git push origin main
```

CI roda: test gate (verde, schema não afeta unit tests) → build → deploy → migrations → wait stable.

Pipeline `genomaflow-prod-migrate` aplica 053 em prod automaticamente.

- [ ] **Step 4.7: Verificar prod**

```bash
gh run watch <run-id> --exit-status
# Verificar nos logs do migrate task que 053 aplicou:
aws logs filter-log-events --log-group-name /genomaflow/prod \
  --filter-pattern "053_scheduling" --max-items 10
```

Expected: log mostra "Applied: 053_scheduling.sql".

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| `btree_gist` não disponível em RDS prod | RDS Postgres 15 inclui contrib modules por default; testar via `CREATE EXTENSION` que é idempotente |
| Migration falha em prod por incompatibilidade | Rodar local primeiro (Step 1.2). Se falhar, ajustar antes do merge |
| Tests bypass RLS sem querer | Pool usa role `genomaflow_app` (sem BYPASSRLS — verificado em migration 046) |
| Testes deixam dados órfãos no DB local | `afterAll` faz cleanup. Em caso de crash: `DELETE FROM appointments WHERE start_at >= '2030-01-01'` |
| `tenants.timezone` afeta tenant existente | Default `America/Sao_Paulo` aplicado a todos via DEFAULT na coluna; nenhum impacto operacional |

---

## Self-review checklist

- [ ] Spec coverage: schema, RLS, EXCLUDE, indexes, grants, timezone, btree_gist — todos cobertos por tasks ✅
- [ ] Placeholder scan: nenhum TBD/TODO no código a entregar
- [ ] Type consistency: nomes de colunas (start_at, duration_minutes, status) batem entre migration, testes e spec ✅
- [ ] Multi-módulo: schema agnóstico (subject_id polimórfico já existente) ✅
- [ ] Não quebra existente: zero ALTER em tabelas além de tenants (timezone NOT NULL DEFAULT) ✅
- [ ] Rollback documentado: spec §9.2 detalha migration 054 de drop ✅
- [ ] Aprovação humana antes do merge: Step 4.5 explícito ✅

---

## Definition of Done (Fase 1)

- ✅ Migration 053 commitada na branch `feat/scheduling-schema`
- ✅ 8 testes DB-dependent passando local
- ✅ `test:unit` (CI gate) inalterado e verde
- ✅ Smoke test manual confirma app sem regressão
- ✅ Merge na main + deploy verde + migration aplicada em prod (logs confirmam)
- ✅ Memória atualizada (CLAUDE.md + project_context.md)

Após esses 6 itens checkados → Fase 1 done. Iniciar plano da Fase 2 (API + rotas).
