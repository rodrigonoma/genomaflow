# Audit Log (Option B) — Design Spec

**Data:** 2026-04-27
**Status:** Entregue (migrations 055–057 aplicadas em prod, master panel deployado)
**Autor:** rodrigo.noma — pareamento com Claude Opus 4.7

## Contexto e motivação

Após a entrega das ações na agenda via Copilot (2026-04-26), surgiu a pergunta: *"as ações solicitadas por voz e via sistema de forma padrão (mouse e teclado) são logadas?"*

Estado anterior:
- `appointments`, `subjects`, `prescriptions`, `exams` não tinham trail de mutação
- Cancelamento/alteração não atribuía o autor — investigação de incidente exigia correlacionar logs do app com timestamps do DB
- `help_questions` (migration 054) já armazenava `tool_calls` + `actions_taken` do Copilot, mas era único pra esse fluxo
- Sem trail genérico, distinguir "usuário cancelou" de "Copilot cancelou" era best-effort

Compliance LGPD + investigação de fraude (cancelamento não autorizado, alteração de prescrição) demandavam registro append-only de mutações com atribuição de canal.

## Alternativas consideradas

### Option A — patch mínimo (rejeitada)
Adicionar colunas pontuais por tabela:
- `appointments.cancelled_by` + `cancelled_at` + `cancelled_via_channel`
- `subjects.updated_by` + `updated_at`
- `prescriptions.updated_by` + ...

**Prós:** mais leve no schema, sem trigger, sem JSONB.
**Contras:**
- Não captura `insert` nem `delete`, só `update`
- Cada tabela exige refactor próprio (handler precisa popular `cancelled_by` antes de cada UPDATE)
- Master panel precisaria query por tabela (UNION all)
- Schema diverge de tabela pra tabela
- Não tem `old_data`/`new_data` — só "quem", não "o quê"

### Option B — audit_log genérico via triggers (escolhida)

Tabela única `audit_log` com schema fixo, populada por trigger Postgres genérico aplicado tabela a tabela. Cada mutação grava `old_data` + `new_data` + `changed_fields` + `actor_user_id` + `actor_channel`.

**Prós:**
- Captura insert/update/delete uniformemente
- Atribuição de canal (ui/copilot/system/worker) — diferencia UI de IA
- Diff completo via JSONB — investigação não precisa do schema
- Master panel = uma query
- Adicionar nova tabela = 1 linha de SQL (CREATE TRIGGER)
- Append-only enforcement via GRANT (SELECT/INSERT only)

**Contras:**
- Trigger SECURITY DEFINER tem risco se função vazar (mitigado: lê de current_setting, não recebe input arbitrário)
- JSONB diff é volumoso pra tabelas grandes (mitigado: TTL natural via INTERVAL queries no master panel; não há retenção infinita)

## Decisão

**Option B.** A pergunta original era sobre atribuição UI vs Copilot, e Option A perde isso. Cobertura uniforme + única query no master panel também simplifica forense.

## Arquitetura

### Tabela `audit_log` (migration 055)

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,         -- 'appointments' | 'subjects' | ...
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  actor_user_id UUID,                -- NULL se contexto não foi passado
  actor_channel TEXT NOT NULL DEFAULT 'ui'
    CHECK (actor_channel IN ('ui', 'copilot', 'system', 'worker')),
  old_data JSONB,
  new_data JSONB,
  changed_fields TEXT[],             -- só pra UPDATE; vazio em insert/delete
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Indexes:
- `(tenant_id, created_at DESC)` — listagem por tenant
- `(entity_type, entity_id)` — drill-down de uma entidade
- `(actor_user_id)` — filtro por autor

RLS:
```sql
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
```

Append-only:
```sql
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
GRANT SELECT, INSERT ON audit_log TO genomaflow_app;
```

### Função genérica `audit_trigger_fn()`

SECURITY DEFINER (executa com privilégios do owner, não do caller) — mas só lê `current_setting(..., true)` (que retorna NULL se não setado, não joga). Calcula diff comparando `to_jsonb(OLD)` e `to_jsonb(NEW)` via `jsonb_each`. Output em `changed_fields TEXT[]`.

Idempotente: `CREATE OR REPLACE FUNCTION` permite re-aplicar a migration.

### Helper `withTenant` estendido

```js
async function withTenant(pg, tenantId, fn, opts) {
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    if (opts?.userId)  await client.query('SELECT set_config($1, $2, true)', ['app.user_id', opts.userId]);
    if (opts?.channel) await client.query('SELECT set_config($1, $2, true)', ['app.actor_channel', opts.channel]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
```

Backwards-compatible — código antigo sem `opts` continua funcionando, mas `actor_user_id` fica NULL e channel cai no default 'ui'.

### Triggers (migrations 056–057)

```sql
CREATE TRIGGER audit_appointments
  AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
-- + subjects, prescriptions, exams (057)
```

`DROP TRIGGER IF EXISTS` antes de cada `CREATE` → migration idempotente.

## Master panel

### Backend (`apps/api/src/routes/master.js`)

`GET /master/audit-log`:
- Query params: `days` (1..180, default 30), `limit` (1..200, default 100), `entity_type`, `entity_id`, `actor_user_id`, `actor_channel`, `tenant_id`, `action`
- WHERE construído dinamicamente com `$N` parametrizados (nunca interpolado)
- JOIN `tenants` + `users` pra trazer `tenant_name` + `actor_email`
- Retorna `{ results, filters, days, limit }`

`GET /master/audit-log/:id`:
- Detalhe completo com `old_data` + `new_data` + `changed_fields`
- 404 se não encontrado

### Frontend (`apps/web/src/app/features/master/master.component.ts`)

- Tab "Auditoria" com filter dropdowns reativos (`computed` signals)
- Tabela com badges coloridos por `actor_channel` (ui=azul, copilot=roxo, system=cinza, worker=laranja) e `action` (insert=verde, update=amarelo, delete=vermelho)
- Modal drill-down com side-by-side `old_data` (esquerda) vs `new_data` (direita) usando `JsonPipe`
- Effects pra recarregar ao ativar tab e ao mudar filtros

## Cobertura testes

- `tests/security/master-acl.test.js` — adicionadas rotas `/master/audit-log` e `/master/audit-log/:id` ao array de rotas master-only (regression guard contra bug 2026-04-23 em que `role !== 'admin'` deixava todo admin de tenant ver dados cross-tenant). 37 verdes.
- `tests/routes/master-audit-log.test.js` — 11 verdes:
  - Clamp days (1..180) e limit (1..200) com defaults
  - Edge cases: `0` e valor inválido caem no default por causa do `|| <default>`
  - Filtros viram placeholders parametrizados — assert que `entity_type=appointments` aparece como `$2` no SQL e nos params, não interpolado
  - SELECT inclui JOIN tenants + users (tenant_name + actor_email)
  - 404 quando audit entry não existe
  - Drill-down retorna entry completo
- Adicionado ao `test:unit` (CI gate) — `npm run test:unit`: 355 passed / 3 skipped / 17 suites

## E2E validation (Docker local)

1. Cadastro de paciente via UI (canal=ui) → `audit_log` row com `entity_type='subjects'`, `action='insert'`, `actor_channel='ui'`, `actor_user_id=<UUID do user>`
2. Cancelamento de appointment via Copilot tool → `audit_log` row com `actor_channel='copilot'`
3. Edição de paciente via UI → `audit_log` row com `action='update'`, `changed_fields` populado com nomes das colunas alteradas

Confirmado.

## Trade-offs e limitações

- **Volume**: trigger grava `to_jsonb(OLD)` + `to_jsonb(NEW)` em todo update. Pra tabelas com colunas pesadas (ex: `exams.parsed_text`) o JSONB pode ficar grande. Aceitamos — tabela é informativa, não hot-path. Se virar problema, restringir colunas no diff.
- **TTL implícito**: master panel limita a 180 dias; tabela em si não tem retenção formal. Quando o volume for problema, agendar `genomaflow-prod-purge-audit` (ECS one-shot) com cutoff de 1–2 anos.
- **Backfill**: dados anteriores às migrations 056/057 não estão no log. Documentado — não tentamos reconstruir.
- **`security_invoker` vs `security_definer`**: optamos por DEFINER pra trigger executar com privilégios do owner (acesso à tabela `audit_log` mesmo se o role do caller não tiver INSERT direto). Risco mitigado: função só lê `current_setting`, não aceita input arbitrário.

## Como adicionar nova tabela ao audit

1. Migration nova (`058_audit_<tabela>.sql`):
   ```sql
   DROP TRIGGER IF EXISTS audit_<tabela> ON <tabela>;
   CREATE TRIGGER audit_<tabela>
     AFTER INSERT OR UPDATE OR DELETE ON <tabela>
     FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
   ```
2. Em todas as rotas/services que mutam `<tabela>`, garantir `withTenant(pg, tid, fn, { userId, channel })`. Channel = `'ui'` pra HTTP de UI, `'copilot'` pra tool calls, `'system'` ou `'worker'` conforme.
3. Adicionar a tabela à lista em `docs/claude-memory/project_audit_log.md`.

## Branches/commits

- Fase 1 — `feat/audit-log-foundation` → `46e7ab06` (schema + helper)
- Fase 2 — `feat/audit-appointments` → `3cfc3d24` (trigger appointments + agenda routes/tools)
- Fase 3 — `feat/audit-extend-tables` → `86403e5a` (subjects/prescriptions/exams + rotas/tools)
- Fase 4 — `feat/audit-master-panel` → `9413795a` (endpoints + tab UI)
- Fase 5 — `docs/audit-log-memory` → `3bee6625` (testes + docs/CLAUDE.md/memória)
