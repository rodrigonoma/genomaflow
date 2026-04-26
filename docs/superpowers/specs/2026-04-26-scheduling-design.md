---
title: "Agendamento de exames/consultas — V1"
date: 2026-04-26
status: spec aprovado, plano da Fase 1 sendo escrito
owners: [backend, frontend, dba]
related: []
---

## 1. Resumo executivo

Médico/veterinário (admin de uma clínica) gerencia sua própria agenda: define duração padrão de slot e horários comerciais, vê semana/dia em calendário, cria agendamentos para pacientes (subject_id) ou bloqueia slots (subject_id NULL). DB garante não-sobreposição via constraint EXCLUDE com tstzrange + btree_gist. Notificações em tempo real via Redis pub/sub seguindo padrão WS estabelecido (chat, exam:done).

**Princípio central:** appointments são imutáveis em `start_at` + `duration_minutes` capturados na criação. Configuração de slot (`schedule_settings.default_slot_minutes`) só afeta:
- Como a UI desenha a grid de slots vazios
- Que duração é sugerida ao criar novo agendamento

Mudar config de 30 → 45 min é instantâneo, sem migração: agendamentos passados mantêm suas durações originais; novos usam a nova. Solução elimina a complexidade de "data migration ao mudar config" que costuma ser fonte de bug.

## 2. Personas e casos de uso

### Casos típicos
- **Caso A** (consulta humana): Dr. Silva (cardiologista) abre `/agenda`, vê semana atual com horário comercial 09–12 / 14–18, slots de 30 min. Clica num slot vazio às 10:30 → popover compacto → digita "Maria Costa" no autocomplete → seleciona paciente → Enter. Agendamento criado, paciente notificado (V2).
- **Caso B** (atendimento veterinário equino, sessão longa): Dr. Costa (vet equino) configura sua agenda com slot default 60 min. Clica em terça às 09:00, seleciona "Trovão (Souza)", marca "duração: 90 min" no campo opcional do popover → cria agendamento custom maior que o default.
- **Caso C** (bloqueio): Dr. Silva vai a um congresso na sexta. Clica numa célula da sexta, escolhe "Bloquear horário", seleciona "06/06 09:00 → 06/06 18:00", motivo: "Congresso SBC". Slot inteiro fica bloqueado, ninguém consegue marcar agendamento sobre ele.
- **Caso D** (mudança de duração mid-stream): Dr. Silva tem 50 agendamentos passados de 30 min. Decide mudar default pra 45 min em junho. Configuração salva. Agendamentos antigos permanecem 30 min na timeline (sem migração). Próximo clique em slot vazio cria agendamento de 45 min.

### Não-objetivos do V1
- Recorrência semanal/quinzenal (V2)
- Lembrete por email/SMS pro paciente (V2)
- Agenda compartilhada multi-médico na clínica (V2 — V1 mostra "minha agenda")
- Booking pelo paciente (V3 — exige portal externo)
- Integração Google Calendar / iCal export (V2)
- Drag-to-resize (V2 — drag-to-reschedule entra no V1)
- Lista de espera / overbooking controlado (V3)

## 3. Decisões de design e rationale

| # | Decisão | Rationale |
|---|---|---|
| D1 | `appointments.duration_minutes` capturada na criação, imutável | Mudança de config nunca afeta passado; zero data migration; passado é evidência do que aconteceu |
| D2 | Não pré-gerar slots vazios em tabela | Slots vazios derivados em runtime de `business_hours - existing_appointments`. Pré-geração explode storage e exige re-write em toda mudança de horário |
| D3 | Não-sobreposição via Postgres EXCLUDE constraint | Race-condition-proof no DB. Erro de aplicação não vaza overlap. Custo: ~1ms por insert |
| D4 | Cancelamento = `status='cancelled'` (soft-delete) | Mantém histórico clínico-administrativo. WHERE da constraint exclui canceled, liberando o horário automaticamente |
| D5 | Soft-delete em vez de tabela `appointment_history` | YAGNI; `updated_at` + `cancelled_at` cobrem auditoria mínima do V1. History table é V2 se houver demanda real |
| D6 | `series_id UUID NULL` reservado já no V1 | Suporte futuro a recorrência sem migração. Custo zero (coluna nullable) |
| D7 | `subjects.deleted_at` ON DELETE SET NULL no FK | Se paciente excluído (soft), appointment vira bloqueio com motivo "paciente removido". Não destrói histórico do calendário |
| D8 | `tenants.timezone` por clínica (não por médico) | V1 simplifica: clínica define seu fuso (default America/Sao_Paulo). Multi-timezone por médico = V2 |
| D9 | EXCLUDE em (`user_id`, `tstzrange`) e não (`tenant_id`, `user_id`, `tstzrange`) | `user_id` já é tenant-scoped via RLS (user pertence a um tenant). Reduz escopo do constraint |
| D10 | `business_hours` em JSONB, não tabela `weekday_schedule` | Estrutura semanal é estável e pequena (7 dias × 1-2 windows). JSONB simples; tabela seria over-engineering |
| D11 | RLS ENABLE + FORCE em todas tabelas novas | Padrão obrigatório do projeto (CLAUDE.md). Defesa em profundidade + filtro `AND tenant_id = $X` explícito em toda query |
| D12 | Nenhum ALTER em tabelas existentes além de `tenants` (timezone) | Blast radius mínimo. Feature isolada |

## 4. Multi-módulo (regra obrigatória CLAUDE.md)

Schema é **agnóstico de módulo** — `subject_id` referencia `subjects(id)` que já é polimórfico (human/animal). Diferenças exclusivamente na UI:

| Aspecto | `human` | `veterinary` |
|---|---|---|
| Termo do evento | "Consulta" | "Atendimento" |
| Autocomplete | "Buscar paciente" | "Buscar animal" |
| Ícone na sidebar `/agenda` | `event` | `event` (mesmo) |
| Default suggestion de duração | 30 min | 30 min (vets de equino tendem a 60min — pode ser refinado por especialidade em V2 com sugestão automática) |

**Validação obrigatória nos testes** (CI gate):
- Criar appointment human + appointment vet com mesmo médico → não impactam um ao outro
- Bloquear horário em vet, criar consulta human → opera independente (médicos diferentes)
- Multi-módulo testado em `tests/security` (paridade com chat e prescriptions)

## 5. Schema

### 5.1 `schedule_settings` (1 linha por user com agenda)

```sql
CREATE TABLE schedule_settings (
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
```

- PK = `user_id`: cada user tem no máximo uma config (1:1)
- `tenant_id` redundante mas obrigatório pra RLS (defense in depth, ver CLAUDE.md)
- `business_hours.{day}` = lista de pares `[start, end]` em formato `HH:MM`. Lista vazia = não atende naquele dia.
- Validação JSONB delegada à camada API (não constraint DB) — flexibilidade pra adicionar campos futuros

### 5.2 `appointments`

```sql
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  series_id UUID,                  -- reservado V2 (recorrência)
  start_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  status TEXT NOT NULL CHECK (status IN (
    'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'blocked'
  )),
  reason TEXT,                     -- motivo do bloqueio se subject_id IS NULL e status='blocked'
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,        -- preenchido quando status vira 'cancelled'

  -- Garantia DB: agendamentos do mesmo médico não se sobrepõem
  -- (cancelled e no_show não bloqueiam o slot)
  EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(start_at, start_at + (duration_minutes * INTERVAL '1 minute'), '[)') WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'))
);
```

- `duration_minutes BETWEEN 5 AND 480` — limite superior 8h evita registros absurdos; inferior 5min permite ajustes finos no futuro mesmo se UI hoje só oferece [30, 45, ..., 120]
- `EXCLUDE USING gist` exige extension `btree_gist` (habilitada na migration)
- Range `[)` = inclui start, exclui end → reservar 09:00–10:00 e 10:00–11:00 não conflita
- WHERE da constraint usa NOT IN (cancelled, no_show) → cancelar libera o slot automaticamente

### 5.3 RLS

```sql
ALTER TABLE schedule_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY schedule_settings_tenant ON schedule_settings
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;

CREATE POLICY appointments_tenant ON appointments
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
```

Pattern NULLIF é o padrão do projeto (compatível com login cross-tenant).

### 5.4 Índices

```sql
-- Calendar query principal: appointments do user num range de tempo
CREATE INDEX appointments_user_start_idx
  ON appointments (user_id, start_at)
  WHERE status NOT IN ('cancelled', 'no_show');

-- Filtro por tenant (defense in depth)
CREATE INDEX appointments_tenant_idx ON appointments (tenant_id);

-- Lookup por paciente (timeline do prontuário)
CREATE INDEX appointments_subject_idx ON appointments (subject_id) WHERE subject_id IS NOT NULL;
```

### 5.5 `tenants.timezone`

```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
```

IANA timezone string. Backend usa pra renderizar UTC → local time na UI.

## 6. API endpoints

Todos sob `/agenda` com `preHandler: [fastify.authenticate]` e `withTenant` (escritas) ou query com `AND tenant_id = $X` explícito (leituras).

### 6.1 Settings

- **`GET /agenda/settings`** — retorna config do user logado. Se não existir, retorna defaults sem criar linha.
- **`PUT /agenda/settings`** — upsert. Body: `{ default_slot_minutes, business_hours }`. Validações:
  - `default_slot_minutes ∈ [30, 45, 60, 75, 90, 105, 120]`
  - `business_hours` shape: `{ "mon": [["09:00","12:00"], ...], ... }` com 7 chaves; cada window `[start, end]` com `start < end` e formato `HH:MM`

### 6.2 Appointments

- **`GET /agenda/appointments?from=...&to=...`** — lista do user logado dentro do range. Default range: semana atual. Max range: 90 dias.
- **`POST /agenda/appointments`** — cria agendamento. Body:
  ```json
  {
    "start_at": "2026-04-26T13:30:00Z",
    "duration_minutes": 45,
    "subject_id": "uuid|null",
    "status": "scheduled" | "blocked",
    "reason": "string opcional",
    "notes": "string opcional"
  }
  ```
  - `subject_id NULL` exige `status='blocked'` e `reason` preenchido
  - `subject_id` preenchido exige `status ∈ {scheduled, confirmed}`
  - 409 se EXCLUDE constraint disparar (overlap)
  - 400 se subject pertence a outro tenant (defense)
- **`PATCH /agenda/appointments/:id`** — atualiza. Mesma validação de body. Permite mover (`start_at`/`duration_minutes`), mudar status, editar notes/reason.
- **`POST /agenda/appointments/:id/cancel`** — atalho que faz `UPDATE status='cancelled', cancelled_at=NOW()`. Idempotente.
- **`DELETE /agenda/appointments/:id`** — só para appointments com status='blocked'. Para outros statuses, exige cancel.
- **`GET /agenda/appointments/free-slots?date=YYYY-MM-DD`** — calcula slots disponíveis pro dia (auxiliar pra UX de quick-create). Backend deriva de `business_hours - existing_appointments` em janelas de `default_slot_minutes`.

### 6.3 Eventos WS via Redis pub/sub

Canal `appointment:event:{tenant_id}` com:

- `appointment:created` → broadcast pra outros tabs do mesmo médico
- `appointment:updated`
- `appointment:cancelled`

Best-effort (try/catch); falha de notify não derruba a request. Padrão idêntico ao chat.

## 7. UX flows

### 7.1 Calendar week view (default desktop)

Layout grid: dias 7 colunas × horas 1 linha por slot. Slot height proporcional a `default_slot_minutes`. Cores por status:

- **Scheduled**: azul claro com borda
- **Confirmed**: verde
- **Completed**: cinza
- **Cancelled**: tracejado vermelho (mostra mas indica liberação)
- **No-show**: laranja
- **Blocked**: hatch pattern cinza

Hover empty slot → cursor pointer + outline azul. Click → popover compacto.

### 7.2 Quick-create popover

Aparece ancorado no slot clicado:

```
┌─────────────────────────────────┐
│ Novo agendamento — Ter 28/04 10:30 │
│                                 │
│ [🔍 Buscar paciente / animal  ] │
│                                 │
│ Duração: [30 min  ▼]            │
│ Notas:   [_____________]        │
│                                 │
│ [Bloquear horário]   [Cancelar] [Salvar] │
└─────────────────────────────────┘
```

- Autocomplete de subject usa `/patients/search?q=` existente
- Enter no autocomplete + nada mais → cria com status='scheduled', duration=default
- Botão "Bloquear horário" troca o popover pra modo bloqueio: subject_id NULL + textarea de motivo

### 7.3 Edit dialog

Click em appointment existente → modal com mesmos campos do create + ações: "Confirmar", "Marcar como concluído", "Marcar como faltou", "Cancelar agendamento", "Excluir" (só blocked).

### 7.4 Drag-to-reschedule

Desktop: drag de appointment pra outro slot → PATCH `/agenda/appointments/:id` com novo `start_at`. Optimistic update + reverter se 409.

### 7.5 Mobile day view

Lista vertical de slots do dia, swipe horizontal entre dias, FAB "+" no canto pra criar.

### 7.6 Acessibilidade

- Tab navigation entre slots
- Enter abre quick-create
- ← → pra navegar semanas
- Aria labels em cada appointment com nome do paciente + horário

## 8. Multi-doctor scenarios (V1 vs V2)

**V1**: cada user vê só sua própria agenda (`WHERE user_id = request.user.user_id` em todas as queries).

**V2 planejado** (não no escopo agora):
- Admin de clínica vê seletor "agenda de quem?" com lista dos médicos do tenant
- Permissões: médico só edita própria; admin vê (mas não edita) qualquer um do tenant
- Calendar agregado opcional ("ver todas")

Schema atual já suporta V2 sem migração — `user_id` e `tenant_id` permitem qualquer query desejada.

## 9. Migration & rollback strategy

### 9.1 Migration 053

Conteúdo em ordem:
1. `CREATE EXTENSION IF NOT EXISTS btree_gist;`
2. `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';`
3. `CREATE TABLE schedule_settings (...);`
4. `ALTER TABLE schedule_settings ENABLE/FORCE RLS;` + policy
5. `CREATE TABLE appointments (...);` (com EXCLUDE)
6. `ALTER TABLE appointments ENABLE/FORCE RLS;` + policy
7. Indexes
8. `GRANT SELECT, INSERT, UPDATE, DELETE ON ... TO genomaflow_app;`

Aplicada via `genomaflow-prod-migrate` no pipeline (padrão do projeto).

### 9.2 Rollback

**Pré-merge (qualquer fase):** deletar branch local + remota. Zero risco.

**Pós-merge — Fase 1 (schema)**:
- Criar migration 054_rollback_scheduling.sql:
  ```sql
  DROP TABLE IF EXISTS appointments CASCADE;
  DROP TABLE IF EXISTS schedule_settings CASCADE;
  ALTER TABLE tenants DROP COLUMN IF EXISTS timezone;
  -- btree_gist mantém (custo zero)
  ```
- Reverter merge commit no main (`git revert -m 1 <sha>`) → CI deploy reverte código
- Migrate task aplica 054 → schema limpo

**Pós-merge — Fases 2-5**:
- Reverter merge commit no main → código removido
- Schema permanece (tabelas vazias em prod) até decidir se rollback é definitivo
- Se sim, criar migration de drop subsequente

## 10. Plano de fases

| Fase | Branch | Entregável | PR mergeável sozinho |
|---|---|---|---|
| 1 | `feat/scheduling-schema` | Migration 053 + RLS + tests RLS | ✅ tabelas vazias, zero impacto UX |
| 2 | `feat/scheduling-api` | Rotas CRUD + validação + WS event + tests unit | ✅ testável via curl, zero impacto UX |
| 3 | `feat/scheduling-ui-week` | Rota /agenda + week view + quick-create + edit dialog | ✅ feature visível, drag-to-reschedule pendente |
| 4 | `feat/scheduling-ui-mobile` | Day view mobile + drag-to-reschedule desktop | ✅ polish |
| 5 | `feat/scheduling-tests-docs` | Cobertura unit estendida + docs/user-help/ + memory | ✅ documentação |

Cada fase passa pelo fluxo CLAUDE.md: branch → validação local → aprovação → merge → CI gate (testes) → deploy.

## 11. Open questions / decisões pendentes

Nenhuma — todos os 4 pontos do brainstorm foram respondidos pelo usuário em 2026-04-26:

1. ✅ Timezone: por tenant (`tenants.timezone`)
2. ✅ Multi-doctor: V1 mostra só própria agenda
3. ✅ Durações: `[30, 45, 60, 75, 90, 105, 120]`
4. ✅ Status no-show: ação rápida na UI sim

## 12. Cobertura de testes (CI gate)

V1 obrigatório:

- **`tests/security/scheduling-acl.test.js`** — appointments só visíveis pro próprio user (RLS); admin de outro tenant 403
- **`tests/routes/scheduling-validation.test.js`** — body validations (status whitelist, duration range, required fields, blocked needs reason, scheduled needs subject_id)
- **`tests/routes/scheduling-overlap.test.js`** — POST conflitante retorna 409 (DB constraint hit)
- **`tests/routes/scheduling-multi-module.test.js`** — paridade human/vet
- **`tests/imaging/`** ou similar pra helpers (free-slots calculation, business_hours validation)

Adicionar paths em `apps/api/package.json` `test:unit`. Falha bloqueia deploy.

## 13. Próximos passos

1. ✅ Spec (este documento) — aprovada implicitamente pelo OK do brainstorm
2. **Plano detalhado da Fase 1** em `docs/superpowers/plans/2026-04-26-scheduling-phase1-schema.md` — em escrita agora
3. Implementação Fase 1 → validação local → aprovação humana → merge → deploy
4. Plano da Fase 2 (escrito após Fase 1 mergeada, com aprendizados incorporados)
5. Sequência das próximas fases

Plano da Fase 2-5 NÃO escrito ainda intencionalmente (writing-plans skill: "fase é spec separada quando independente"). Cada plano após validar fase anterior.
