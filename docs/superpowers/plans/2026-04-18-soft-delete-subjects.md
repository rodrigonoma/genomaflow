# Soft Delete para Subjects

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o DELETE físico de subjects por soft delete via `deleted_at`, preservando histórico clínico.

**Architecture:** Adicionar coluna `deleted_at TIMESTAMPTZ` em `subjects`. Todas as queries filtram `WHERE s.deleted_at IS NULL`. A rota `DELETE /patients/:id` passa a executar `UPDATE subjects SET deleted_at = NOW()`. Não há rota de restore exposta por ora.

**Tech Stack:** PostgreSQL migration, Node.js/Fastify (patients.js), Angular (patient-list.component.ts)

---

### Task 1: Migration — adicionar coluna deleted_at

**Files:**
- Create: `apps/api/src/db/migrations/020_subjects_soft_delete.sql`

- [ ] **Step 1: Criar o arquivo de migração**

```sql
-- 020_subjects_soft_delete.sql
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_subjects_deleted_at ON subjects (deleted_at)
  WHERE deleted_at IS NULL;
```

- [ ] **Step 2: Executar a migração**

```bash
docker compose exec api node src/db/migrate.js
```

Expected: `Migration 020_subjects_soft_delete.sql applied` (ou "already applied")

- [ ] **Step 3: Verificar no banco**

```bash
docker compose exec db psql -U postgres -d genomaflow -c "\d subjects" | grep deleted_at
```

Expected: `deleted_at | timestamp with time zone | ...`

---

### Task 2: API — soft delete e filtros nas queries

**Files:**
- Modify: `apps/api/src/routes/patients.js`

- [ ] **Step 1: Trocar DELETE físico por UPDATE em `DELETE /:id`**

Em `patients.js`, linha com `DELETE FROM subjects WHERE id = $1 RETURNING id`, substituir por:

```js
const { rows } = await client.query(
  `UPDATE subjects SET deleted_at = NOW()
   WHERE id = $1 AND deleted_at IS NULL
   RETURNING id`, [id]
);
```

- [ ] **Step 2: Filtrar `deleted_at IS NULL` no GET /**

```sql
SELECT s.id, s.name, s.birth_date, s.sex, s.subject_type, s.species,
       s.weight, s.breed, s.created_at,
       o.name AS owner_name, o.cpf_last4 AS owner_cpf_last4, o.phone AS owner_phone
FROM subjects s
LEFT JOIN owners o ON o.id = s.owner_id
WHERE s.deleted_at IS NULL
ORDER BY s.created_at DESC
```

- [ ] **Step 3: Filtrar `deleted_at IS NULL` no GET /search**

```sql
SELECT s.id, s.name, s.sex, s.species, s.subject_type, s.created_at,
       o.name AS owner_name
FROM subjects s
LEFT JOIN owners o ON o.id = s.owner_id
WHERE (s.owner_cpf_hash = $1 OR o.cpf_hash = $1)
  AND s.subject_type = 'animal'
  AND s.deleted_at IS NULL
ORDER BY s.name
```

- [ ] **Step 4: Filtrar `deleted_at IS NULL` no GET /:id**

```sql
SELECT s.*,
       o.name AS owner_name, o.cpf_last4 AS owner_cpf_last4,
       o.phone AS owner_phone, o.email AS owner_email
FROM subjects s
LEFT JOIN owners o ON o.id = s.owner_id
WHERE s.id = $1 AND s.deleted_at IS NULL
```

- [ ] **Step 5: Filtrar `deleted_at IS NULL` no PUT /:id (UPDATE)**

Adicionar `AND deleted_at IS NULL` na cláusula WHERE do UPDATE existente:

```sql
UPDATE subjects SET
  name = COALESCE($1, name),
  ...
  owner_id = COALESCE($15, owner_id)
WHERE id = $16 AND deleted_at IS NULL
RETURNING *
```

- [ ] **Step 6: Rebuild e smoke test**

```bash
docker compose build api && docker compose up -d api
curl -s http://localhost:3000/health | jq .
```

---

### Task 3: Frontend — mensagem de confirmação atualizada

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-list.component.ts`

- [ ] **Step 1: Atualizar o texto do confirm() para refletir soft delete**

Localizar:
```ts
if (!confirm(`Excluir "${name}"? Todos os exames e tratamentos vinculados serão removidos permanentemente.`)) return;
```

Substituir por:
```ts
if (!confirm(`Arquivar "${name}"? O registro será desativado e não aparecerá mais na lista. O histórico clínico é preservado.`)) return;
```

- [ ] **Step 2: Rebuild web**

```bash
docker compose build web && docker compose up -d web
```

- [ ] **Step 3: Testar no browser**

1. Criar um subject de teste
2. Clicar em excluir — confirmar que some da lista
3. Verificar no banco que `deleted_at` foi preenchido e o registro ainda existe:
```bash
docker compose exec db psql -U postgres -d genomaflow \
  -c "SELECT id, name, deleted_at FROM subjects WHERE deleted_at IS NOT NULL LIMIT 5"
```
