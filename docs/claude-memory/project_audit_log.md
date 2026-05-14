---
name: Audit log (Option B) — entregue 2026-04-27
description: Trail de mutações via Postgres triggers genéricos + atribuição de canal (ui/copilot/system/worker) + master panel — substitui ideia de cancelled_by puntual
type: project
---

Audit log genérico foi entregue em 5 fases (migrations 055, 056, 057). Substitui a alternativa "Option A" de adicionar `cancelled_by`/`updated_by` colunas pontuais — Option B captura toda mutação (insert/update/delete) em todas as tabelas críticas com diff JSONB completo e atribui o canal (UI vs Copilot vs system vs worker).

**Why:** demanda do usuário em 2026-04-27 — *"as ações solicitadas por voz e via sistema de forma padrão são logadas?"* — sem trail dava pra negar/confundir o que veio do Copilot vs UI, especialmente em cancelamentos. Compliance LGPD + investigação de incidentes exigia atribuição.

**How to apply:** ao adicionar nova tabela com PII/billing/compliance → criar trigger em migration nova; ao adicionar nova rota de mutação em tabela já com trigger → `withTenant(pg, tid, fn, { userId, channel })` é OBRIGATÓRIO.

## Schema (migration 055)

`audit_log`: `id`, `tenant_id`, `entity_type`, `entity_id`, `action` (insert/update/delete), `actor_user_id`, `actor_channel` (`'ui'|'copilot'|'system'|'worker'`), `old_data` JSONB, `new_data` JSONB, `changed_fields` TEXT[], `created_at`.

- RLS NULLIF (master sem `set_config` vê tudo; tenant só o próprio)
- Append-only: GRANT só SELECT/INSERT
- `audit_trigger_fn()` SECURITY DEFINER lê `app.tenant_id`, `app.user_id`, `app.actor_channel` via `current_setting(..., true)`
- Diff calculado via `jsonb_each` comparando OLD/NEW

## Tabelas com trigger habilitado

- `appointments` (056) — UI + Copilot
- `subjects`, `prescriptions`, `exams` (057) — UI + Copilot

## Helper estendido

`apps/api/src/db/tenant.js#withTenant` agora aceita `(pg, tenantId, fn, opts)`:
- `opts.userId` → `SELECT set_config('app.user_id', $1, true)`
- `opts.channel` → `SELECT set_config('app.actor_channel', $1, true)`
- Sem opts: backwards-compatible (mas `actor_user_id` fica NULL e `actor_channel` cai no default 'ui')

## Rotas/services atualizados

- `apps/api/src/routes/agenda.js` — 5 withTenant com `{ channel: 'ui' }`
- `apps/api/src/services/agenda-chat-tools.js` — 3 com `{ channel: 'copilot' }`
- `apps/api/src/routes/patients.js` — POST/PUT/DELETE com `{ channel: 'ui' }`
- `apps/api/src/routes/prescriptions.js` — POST/PUT/DELETE com `{ channel: 'ui' }`
- `apps/api/src/routes/exams.js` — POST upload com `{ channel: 'ui' }`
- `apps/api/src/services/patient-chat-tools.js` — create_patient com `{ channel: 'copilot' }`

## Master panel

- Tab "Auditoria" em `/master` (`master.component.ts`)
- Filtros: entity_type, actor_channel, action (dropdowns)
- Tabela com badges coloridos por channel (ui/copilot/system/worker) e action
- Drill-down modal com side-by-side JSON diff (old vs new) usando JsonPipe
- Endpoints: `GET /master/audit-log` (lista paginada, clamp 30/100 default, max 180/200) e `GET /master/audit-log/:id` (detalhe completo)

## Tests

- `tests/security/master-acl.test.js` — `/master/audit-log` e `/master/audit-log/:id` no array de rotas master-only (37 verdes)
- `tests/routes/master-audit-log.test.js` — 11 verdes: clamp days/limit, filtros parametrizados (não interpolados), JOIN tenants+users, 404, drill-down completo
- Adicionado ao `test:unit` (CI gate) — npm run test:unit: 355 passed / 3 skipped / 17 suites
- E2E manual validado: INSERT via 'ui' + UPDATE via 'copilot' produziram audit_log entries corretos com changed_fields

## Branches/commits

- Fase 1: `feat/audit-log-foundation` → main (`46e7ab06`)
- Fase 2: `feat/audit-appointments` → main (`3cfc3d24`)
- Fase 3: `feat/audit-extend-tables` → main (`86403e5a`)
- Fase 4: `feat/audit-master-panel` → main (`9413795a`)
- Fase 5: `docs/audit-log-memory` → main (`3bee6625`)

## Trade-off vs Option A

Option A era patch mínimo: adicionar `cancelled_by` em `appointments`, `updated_by` em `subjects`, etc. Mais leve mas:
- Não captura `insert` nem `delete`, só `update`
- Não atribui canal (UI vs Copilot) — perde o ponto principal da pergunta original
- Cada tabela exige refactor próprio
- Master panel precisaria query por tabela

Option B (escolhida) captura toda mutação numa tabela única com canal — investigação fica em uma query.
