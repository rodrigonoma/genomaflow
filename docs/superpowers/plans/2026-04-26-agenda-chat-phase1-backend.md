# Copilot Agenda Tools — Fase 1 (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar tools do Anthropic SDK ao endpoint `/product-help/ask` pra permitir que o Copilot execute ações na agenda (find/list/create/cancel/get_details). UI continua igual nesta fase — apenas backend testável via curl.

**Architecture:** Tool definitions + executor isolados em `apps/api/src/services/agenda-chat-tools.js`. Endpoint `/ask` ganha campo opcional `enable_agenda_tools`. Loop de tool execution com hard cap de 5 iterações. Migration 054 adiciona `tool_calls` + `actions_taken` em `help_questions`.

**Tech Stack:** `@anthropic-ai/sdk` 0.88 (já instalado), Postgres 15 (já), `withTenant` helper.

**Branch:** `feat/agenda-chat-tools-backend`

**Spec:** `docs/superpowers/specs/2026-04-26-agenda-chat-actions-design.md`

---

## File Structure

| Path | Ação | Responsabilidade |
|---|---|---|
| `apps/api/src/db/migrations/054_help_questions_tool_calls.sql` | Criar | ADD COLUMN tool_calls/actions_taken + index |
| `apps/api/src/services/agenda-chat-tools.js` | Criar | Tool definitions + executors + dispatch |
| `apps/api/src/routes/product-help.js` | Modificar | Aceitar enable_agenda_tools + conversation_history; loop de tools com SDK; log estendido |
| `apps/api/tests/services/agenda-chat-tools.test.js` | Criar | Unit tests pra cada tool executor (mock pg) |
| `apps/api/tests/security/agenda-chat-tools-acl.test.js` | Criar | Garantia de tenant/user scope, defesa contra arg injection |
| `apps/api/tests/routes/product-help-tools.test.js` | Criar | Integration: endpoint com tools ativadas usando mock Anthropic SDK |
| `apps/api/package.json` | Modificar | Adicionar paths novos ao `test:unit` |

---

## Pre-flight

- [ ] **Step 0: Branch + verificar estado**

```bash
git checkout main && git pull --ff-only origin main
git checkout -b feat/agenda-chat-tools-backend
ls apps/api/src/db/migrations/ | tail -3
```

Expected: branch criada, último arquivo `053_scheduling.sql`.

---

## Task 1: Migration 054

- [ ] **Step 1.1: Criar `apps/api/src/db/migrations/054_help_questions_tool_calls.sql`**

```sql
-- Migration 054: audit de tool calls do Copilot (agenda actions)
-- Spec: docs/superpowers/specs/2026-04-26-agenda-chat-actions-design.md

ALTER TABLE help_questions
  ADD COLUMN IF NOT EXISTS tool_calls JSONB,
  ADD COLUMN IF NOT EXISTS actions_taken JSONB;

-- Index pra analytics futura (queries do tipo "qual tool é mais chamada?")
CREATE INDEX IF NOT EXISTS help_questions_with_tools_idx
  ON help_questions(created_at DESC)
  WHERE tool_calls IS NOT NULL;
```

- [ ] **Step 1.2: Aplicar local**

```bash
DATABASE_URL_ADMIN="postgres://postgres:postgres@localhost:5432/genomaflow" node apps/api/src/db/migrate.js
```

Expected: `[apply] 054_help_questions_tool_calls.sql` + `Migrations complete.`

- [ ] **Step 1.3: Verificar**

```bash
docker compose exec -T db psql -U postgres -d genomaflow -c "\d help_questions" | grep -E "tool_calls|actions_taken"
```

Expected: ambas colunas listadas como `jsonb` nullable.

---

## Task 2: Tool definitions + executors

- [ ] **Step 2.1: Criar `apps/api/src/services/agenda-chat-tools.js`**

Estrutura completa: definitions exportadas + executor por tool + dispatch function. Toda tool recebe `(input, context)` onde `context = { fastify, tenant_id, user_id, module, log }`.

```javascript
'use strict';
/**
 * Tool definitions + executors pro Copilot de Ajuda agir na agenda.
 *
 * Cada tool tem:
 *   - definition: shape exposto ao Anthropic SDK (name, description, input_schema)
 *   - executor: fn(input, context) → Promise<result>
 *
 * Executors SEMPRE usam tenant_id/user_id do context (vindos do JWT verificado),
 * nunca dos args do LLM. Defesa contra prompt injection que tenta override.
 *
 * Spec: docs/superpowers/specs/2026-04-26-agenda-chat-actions-design.md §6
 */

const { withTenant } = require('../db/tenant');

const VALID_DURATION = [30, 45, 60, 75, 90, 105, 120];

// ── Definitions (Anthropic SDK shape) ─────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'find_subject',
    description: 'Busca pacientes/animais pelo nome no tenant atual. Retorna até 5 matches. Use ANTES de criar agendamento pra resolver ambiguidade.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome ou parte do nome do paciente/animal (mínimo 2 chars)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_my_agenda',
    description: 'Lista os agendamentos do médico/veterinário logado num período. Use preset "today", "tomorrow", "this_week" OU passe from/to ISO. Sem args = semana atual.',
    input_schema: {
      type: 'object',
      properties: {
        preset: { type: 'string', enum: ['today', 'tomorrow', 'this_week'] },
        from: { type: 'string', description: 'ISO datetime (UTC)' },
        to: { type: 'string', description: 'ISO datetime (UTC)' },
      },
    },
  },
  {
    name: 'get_appointment_details',
    description: 'Retorna detalhes completos de um agendamento por id. Use pra confirmar com o usuário antes de cancelar.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string', description: 'UUID do agendamento' },
      },
      required: ['appointment_id'],
    },
  },
  {
    name: 'create_appointment',
    description: 'Cria novo agendamento. Use SOMENTE após resolver subject_id via find_subject. status="scheduled" exige subject_id; status="blocked" exige reason e proíbe subject_id.',
    input_schema: {
      type: 'object',
      properties: {
        start_at: { type: 'string', description: 'ISO datetime (UTC)' },
        duration_minutes: { type: 'integer', enum: [30, 45, 60, 75, 90, 105, 120] },
        status: { type: 'string', enum: ['scheduled', 'blocked'] },
        subject_id: { type: 'string', description: 'UUID do paciente/animal (obrigatório se scheduled)' },
        reason: { type: 'string', description: 'Motivo do bloqueio (obrigatório se blocked)' },
        notes: { type: 'string' },
      },
      required: ['start_at', 'duration_minutes', 'status'],
    },
  },
  {
    name: 'cancel_appointment',
    description: 'Cancela agendamento existente. CRÍTICO: SEMPRE confirme com o usuário em mensagem de texto ANTES de chamar esta tool. Apresente os detalhes (paciente, data, hora) e pergunte "Confirma?". Só chame após resposta afirmativa.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string', description: 'UUID do agendamento a cancelar' },
      },
      required: ['appointment_id'],
    },
  },
];

// ── Executors ─────────────────────────────────────────────────────

async function execFindSubject(input, ctx) {
  if (!input.name || input.name.length < 2) {
    return { error: 'Nome muito curto (mínimo 2 chars)' };
  }
  const { rows } = await ctx.fastify.pg.query(
    `SELECT id, name, subject_type, species, breed, owner_cpf_hash
     FROM subjects
     WHERE tenant_id = $1 AND deleted_at IS NULL AND name ILIKE $2
     LIMIT 5`,
    [ctx.tenant_id, `%${input.name}%`]
  );
  return {
    matches: rows.map(r => ({
      id: r.id,
      name: r.name,
      subject_type: r.subject_type,
      species: r.species || undefined,
      breed: r.breed || undefined,
    })),
  };
}

async function execListMyAgenda(input, ctx) {
  let from, to;
  if (input.preset === 'today') {
    const d = new Date();
    from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
    to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
  } else if (input.preset === 'tomorrow') {
    const d = new Date();
    from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
    to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 2)).toISOString();
  } else if (input.preset === 'this_week') {
    const d = new Date();
    const day = d.getUTCDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMon));
    const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 7);
    from = monday.toISOString();
    to = sunday.toISOString();
  } else if (input.from && input.to) {
    from = input.from;
    to = input.to;
  } else {
    return { error: 'Forneça preset (today/tomorrow/this_week) ou from+to ISO' };
  }

  const { rows } = await ctx.fastify.pg.query(
    `SELECT a.id, a.start_at, a.duration_minutes, a.status, a.subject_id, a.reason, s.name AS subject_name
     FROM appointments a
     LEFT JOIN subjects s ON s.id = a.subject_id
     WHERE a.tenant_id = $1 AND a.user_id = $2
       AND a.start_at >= $3 AND a.start_at < $4
     ORDER BY a.start_at ASC`,
    [ctx.tenant_id, ctx.user_id, from, to]
  );
  return {
    appointments: rows.map(r => ({
      id: r.id,
      start_at: r.start_at,
      duration_minutes: r.duration_minutes,
      status: r.status,
      subject_name: r.subject_name || undefined,
      reason: r.reason || undefined,
    })),
    range: { from, to },
  };
}

async function execGetAppointmentDetails(input, ctx) {
  if (!input.appointment_id) return { error: 'appointment_id obrigatório' };
  const { rows } = await ctx.fastify.pg.query(
    `SELECT a.id, a.start_at, a.duration_minutes, a.status, a.subject_id,
            a.reason, a.notes, s.name AS subject_name
     FROM appointments a
     LEFT JOIN subjects s ON s.id = a.subject_id
     WHERE a.id = $1 AND a.tenant_id = $2 AND a.user_id = $3`,
    [input.appointment_id, ctx.tenant_id, ctx.user_id]
  );
  if (rows.length === 0) return { error: 'Agendamento não encontrado.' };
  const r = rows[0];
  return {
    id: r.id,
    start_at: r.start_at,
    duration_minutes: r.duration_minutes,
    status: r.status,
    subject_id: r.subject_id || null,
    subject_name: r.subject_name || null,
    notes: r.notes || null,
    reason: r.reason || null,
  };
}

async function execCreateAppointment(input, ctx) {
  // Validação básica (LLM já recebe schema, mas defesa em profundidade)
  if (!input.start_at || Number.isNaN(Date.parse(input.start_at))) {
    return { error: 'start_at inválido' };
  }
  if (!VALID_DURATION.includes(input.duration_minutes)) {
    return { error: `duration_minutes deve ser um de ${VALID_DURATION.join(', ')}` };
  }
  if (!['scheduled', 'blocked'].includes(input.status)) {
    return { error: 'status deve ser scheduled ou blocked' };
  }
  if (input.status === 'scheduled' && !input.subject_id) {
    return { error: 'status=scheduled exige subject_id' };
  }
  if (input.status === 'blocked' && !input.reason) {
    return { error: 'status=blocked exige reason' };
  }
  if (input.status === 'blocked' && input.subject_id) {
    return { error: 'status=blocked não pode ter subject_id' };
  }

  try {
    const result = await withTenant(ctx.fastify.pg, ctx.tenant_id, async (client) => {
      // Defense: subject pertence ao mesmo tenant
      if (input.subject_id) {
        const { rows: subRows } = await client.query(
          `SELECT id, name FROM subjects WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          [input.subject_id, ctx.tenant_id]
        );
        if (subRows.length === 0) {
          const e = new Error('SUBJECT_INVALID'); e.code = 'SUBJECT_INVALID'; throw e;
        }
      }
      const { rows } = await client.query(
        `INSERT INTO appointments
          (tenant_id, user_id, subject_id, start_at, duration_minutes, status, reason, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $2)
         RETURNING id, start_at, duration_minutes, status, subject_id, reason`,
        [ctx.tenant_id, ctx.user_id, input.subject_id || null, input.start_at,
         input.duration_minutes, input.status, input.reason || null, input.notes || null]
      );
      return rows[0];
    });

    // Notify WS (best-effort)
    try {
      if (ctx.fastify.redis) {
        await ctx.fastify.redis.publish(
          `appointment:event:${ctx.tenant_id}`,
          JSON.stringify({ event: 'appointment:created', appointment: result })
        );
      }
    } catch (_) {}

    return {
      id: result.id,
      start_at: result.start_at,
      duration_minutes: result.duration_minutes,
      status: result.status,
    };
  } catch (err) {
    if (err.code === '23P01') return { error: 'overlap', message: 'Horário já ocupado por outro agendamento.' };
    if (err.code === 'SUBJECT_INVALID') return { error: 'subject_invalid', message: 'Paciente não encontrado neste tenant.' };
    throw err;
  }
}

async function execCancelAppointment(input, ctx) {
  if (!input.appointment_id) return { error: 'appointment_id obrigatório' };

  const result = await withTenant(ctx.fastify.pg, ctx.tenant_id, async (client) => {
    const { rows } = await client.query(
      `UPDATE appointments
       SET status='cancelled', cancelled_at=COALESCE(cancelled_at, NOW()), updated_at=NOW()
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3
       RETURNING id, status, cancelled_at`,
      [input.appointment_id, ctx.tenant_id, ctx.user_id]
    );
    return rows[0];
  });

  if (!result) return { error: 'not_found', message: 'Agendamento não encontrado ou não pertence a você.' };

  try {
    if (ctx.fastify.redis) {
      await ctx.fastify.redis.publish(
        `appointment:event:${ctx.tenant_id}`,
        JSON.stringify({ event: 'appointment:cancelled', appointment_id: input.appointment_id })
      );
    }
  } catch (_) {}

  return {
    id: result.id,
    status: result.status,
    cancelled_at: result.cancelled_at,
  };
}

const EXECUTORS = {
  find_subject: execFindSubject,
  list_my_agenda: execListMyAgenda,
  get_appointment_details: execGetAppointmentDetails,
  create_appointment: execCreateAppointment,
  cancel_appointment: execCancelAppointment,
};

/**
 * Executa uma tool por nome com input + context.
 * @returns Promise<{result?, error?, latency_ms}>
 */
async function executeTool(name, input, context) {
  const exec = EXECUTORS[name];
  if (!exec) return { error: `Tool desconhecida: ${name}`, latency_ms: 0 };
  const startedAt = Date.now();
  try {
    const result = await exec(input || {}, context);
    return { result, latency_ms: Date.now() - startedAt };
  } catch (err) {
    context.log?.error({ err, tool: name, input }, 'agenda-chat-tools: executor error');
    return { error: err.message || 'Erro interno', latency_ms: Date.now() - startedAt };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  EXECUTORS,
  executeTool,
  VALID_DURATION,
};
```

- [ ] **Step 2.2: Smoke test módulo carrega sem erro**

```bash
node -e "console.log(Object.keys(require('./apps/api/src/services/agenda-chat-tools')))"
```

Expected: `['TOOL_DEFINITIONS', 'EXECUTORS', 'executeTool', 'VALID_DURATION']`.

---

## Task 3: Unit tests dos executors

- [ ] **Step 3.1: Criar `apps/api/tests/services/agenda-chat-tools.test.js`**

Cobre cada executor com mock fastify.pg + valida shape de input/output. Não testa Anthropic SDK aqui (vai pra Task 5).

```javascript
'use strict';
const { TOOL_DEFINITIONS, executeTool, EXECUTORS } = require('../../src/services/agenda-chat-tools');

function ctx(overrides = {}) {
  const queryMock = jest.fn();
  const connectMock = jest.fn(async () => ({
    query: queryMock,
    release: jest.fn(),
  }));
  return {
    fastify: {
      pg: { query: queryMock, connect: connectMock },
      redis: { publish: jest.fn(async () => 1) },
    },
    tenant_id: '00000000-0000-0000-0000-00000000000A',
    user_id:   '00000000-0000-0000-0000-00000000000B',
    module: 'human',
    log: { error: jest.fn() },
    queryMock, connectMock,
    ...overrides,
  };
}

describe('TOOL_DEFINITIONS', () => {
  test('5 tools registradas com nome + description + input_schema', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(5);
    for (const t of TOOL_DEFINITIONS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(typeof t.description).toBe('string');
      expect(t.input_schema?.type).toBe('object');
    }
  });
  test('cancel_appointment description menciona confirmação obrigatória', () => {
    const cancel = TOOL_DEFINITIONS.find(t => t.name === 'cancel_appointment');
    expect(cancel.description).toMatch(/confirme|Confirma/i);
  });
});

describe('find_subject', () => {
  test('rejeita nome curto', async () => {
    const c = ctx();
    const r = await executeTool('find_subject', { name: 'a' }, c);
    expect(r.result.error).toMatch(/curto/);
    expect(c.queryMock).not.toHaveBeenCalled();
  });
  test('busca com tenant scope', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [
      { id: 's1', name: 'Maria', subject_type: 'human', species: null, breed: null }
    ]});
    const r = await executeTool('find_subject', { name: 'Maria' }, c);
    expect(c.queryMock).toHaveBeenCalledWith(
      expect.stringContaining('subjects'),
      expect.arrayContaining(['00000000-0000-0000-0000-00000000000A', '%Maria%'])
    );
    expect(r.result.matches).toHaveLength(1);
    expect(r.result.matches[0].name).toBe('Maria');
  });
});

describe('list_my_agenda', () => {
  test('preset=today calcula range UTC do dia', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_my_agenda', { preset: 'today' }, c);
    expect(c.queryMock).toHaveBeenCalled();
    const args = c.queryMock.mock.calls[0][1];
    // arg 2 é tenant, arg 3 user, arg 4 from, arg 5 to
    expect(args[0]).toBe(c.tenant_id);
    expect(args[1]).toBe(c.user_id);
    const from = new Date(args[2]);
    const to = new Date(args[3]);
    expect(to - from).toBe(24 * 60 * 60 * 1000);
  });
  test('sem preset nem from/to → error', async () => {
    const c = ctx();
    const r = await executeTool('list_my_agenda', {}, c);
    expect(r.result.error).toMatch(/preset/);
    expect(c.queryMock).not.toHaveBeenCalled();
  });
});

describe('get_appointment_details', () => {
  test('not found retorna erro', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await executeTool('get_appointment_details', { appointment_id: 'abc' }, c);
    expect(r.result.error).toMatch(/não encontrado/i);
  });
  test('found retorna shape completo', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [{
      id: 'a1', start_at: '2030-01-01T10:00:00Z', duration_minutes: 30, status: 'scheduled',
      subject_id: 's1', subject_name: 'Maria', notes: 'ok', reason: null,
    }]});
    const r = await executeTool('get_appointment_details', { appointment_id: 'a1' }, c);
    expect(r.result.id).toBe('a1');
    expect(r.result.subject_name).toBe('Maria');
  });
});

describe('create_appointment — validação', () => {
  const BASE = {
    start_at: '2030-06-01T10:00:00Z',
    duration_minutes: 30,
    status: 'scheduled',
    subject_id: '00000000-0000-0000-0000-00000000001A',
  };
  test.each([
    [{ ...BASE, start_at: 'not-iso' }, /start_at/],
    [{ ...BASE, duration_minutes: 25 }, /duration/],
    [{ ...BASE, status: 'unknown' }, /status/],
    [{ ...BASE, subject_id: undefined }, /subject_id/],
    [{ ...BASE, status: 'blocked', subject_id: 'x', reason: 'r' }, /blocked.*subject/],
    [{ ...BASE, status: 'blocked', subject_id: undefined }, /reason/],
  ])('rejeita input inválido', async (input, msgRegex) => {
    const c = ctx();
    const r = await executeTool('create_appointment', input, c);
    expect(r.result.error).toMatch(msgRegex);
  });
});

describe('cancel_appointment', () => {
  test('appointment_id obrigatório', async () => {
    const c = ctx();
    const r = await executeTool('cancel_appointment', {}, c);
    expect(r.result.error).toMatch(/appointment_id/);
  });
  test('not found retorna erro', async () => {
    const c = ctx();
    // withTenant: connect → BEGIN → set_config → UPDATE (rows: [])
    c.queryMock
      .mockResolvedValueOnce({}) // BEGIN (via client direto não usado; withTenant usa connect)
      .mockResolvedValueOnce({}); // set_config
    // withTenant chama c.fastify.pg.connect, então o query do client é o mock
    c.connectMock.mockResolvedValueOnce({
      query: jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // set_config
        .mockResolvedValueOnce({ rows: [] }) // UPDATE returning vazio
        .mockResolvedValueOnce({}), // COMMIT
      release: jest.fn(),
    });
    const r = await executeTool('cancel_appointment', { appointment_id: 'a1' }, c);
    expect(r.result.error).toBe('not_found');
  });
});

describe('ACL — args do LLM nunca controlam tenant_id ou user_id', () => {
  test('find_subject ignora qualquer override de tenant_id no input', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('find_subject', { name: 'X', tenant_id: 'OUTRO_TENANT', user_id: 'OUTRO_USER' }, c);
    const args = c.queryMock.mock.calls[0][1];
    expect(args[0]).toBe(c.tenant_id); // do contexto
    expect(args[0]).not.toBe('OUTRO_TENANT');
  });

  test('list_my_agenda usa user_id do contexto, não do input', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_my_agenda', { preset: 'today', user_id: 'OUTRO', tenant_id: 'OUTRO' }, c);
    const args = c.queryMock.mock.calls[0][1];
    expect(args[0]).toBe(c.tenant_id);
    expect(args[1]).toBe(c.user_id);
  });
});
```

- [ ] **Step 3.2: Adicionar path em `test:unit`**

Em `apps/api/package.json`, adicionar `tests/services/agenda-chat-tools.test.js` ao final do `test:unit`.

- [ ] **Step 3.3: Rodar**

```bash
cd apps/api && npm run test:unit
```

Expected: TODAS suites passing, ~+15 tests do agenda-chat-tools.

---

## Task 4: Integração no `/product-help/ask`

- [ ] **Step 4.1: Modificar `apps/api/src/routes/product-help.js`**

Mudanças:
1. Importar `TOOL_DEFINITIONS` + `executeTool` do `agenda-chat-tools.js`
2. Aceitar `enable_agenda_tools: boolean` e `conversation_history: Message[]` no body
3. Quando `enable_agenda_tools=true`, system prompt ganha bloco de "AÇÕES NA AGENDA" (do spec §7.2)
4. Trocar `anthropic.messages.stream(...)` por loop de `.create(...)` com tools (não streaming inicial — V1 simplifica)
5. Loop: até max 5 iterações, executa tool_use blocks, alimenta tool_result na conversation
6. Emite eventos SSE conforme spec §7.4
7. Log estendido em `help_questions` com `tool_calls` + `actions_taken`

Edit cirúrgico — mantém comportamento atual (`enable_agenda_tools=false` default) intacto.

Ver código completo em apêndice deste plano (Step 4.1 detalhe abaixo).

- [ ] **Step 4.2: Smoke test API local**

Subir API local (`docker compose up -d`), gerar JWT válido (login admin) e testar:

```bash
TOKEN="<jwt do admin>"
curl -N -X POST http://localhost:3000/product-help/ask \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question": "o que tenho hoje na agenda?", "enable_agenda_tools": true, "context": {"route":"/agenda","module":"human"}}'
```

Expected: stream SSE com `event: tool_call_started` (list_my_agenda) → `event: tool_call_completed` → `event: delta` (texto explicando) → `event: done`.

- [ ] **Step 4.3: Smoke test cancelamento confirmação**

```bash
# Turn 1
curl ... -d '{"question": "cancela meu próximo atendimento", "enable_agenda_tools": true}'
# Expected: lista próximo, pede confirmação NO TEXTO. NÃO deve chamar cancel_appointment.

# Turn 2 (com history)
curl ... -d '{"question": "sim, pode cancelar", "enable_agenda_tools": true, "conversation_history": [...turn 1...]}'
# Expected: chama cancel_appointment, devolve confirmação de sucesso.
```

---

## Task 5: Integration tests da rota com tools mockadas

- [ ] **Step 5.1: Criar `apps/api/tests/routes/product-help-tools.test.js`**

Mock do Anthropic SDK pra simular respostas com tool_use. Foco:
- `enable_agenda_tools=false` (default) preserva comportamento atual (sem tools no SDK call)
- `enable_agenda_tools=true` passa tools no SDK call
- Loop respeita hard cap de 5 iterações
- Tool execution usa user JWT (não args do LLM)
- Erros de tool são reportados via SSE `error`

(Detalhe de código de teste segue padrão estabelecido em `tests/routes/billing-validation.test.js` etc.)

- [ ] **Step 5.2: Rodar**

```bash
cd apps/api && npm run test:unit
```

Expected: ~280 tests passing total (era 243).

---

## Task 6: Memory + commit + push + apresentar

- [ ] **Step 6.1: Atualizar `CLAUDE.md`**

Adicionar bullet em "Comportamentos Esperados":

```
- Copilot ações na agenda (entregue 2026-04-26): /product-help/ask aceita
  enable_agenda_tools=true + conversation_history. Quando true, LLM ganha
  5 tools (find_subject, list_my_agenda, get_appointment_details,
  create_appointment, cancel_appointment) que executam server-side com
  tenant_id/user_id do JWT. Cancel exige confirmação prévia em mensagem
  de texto (instruída no system prompt). Hard cap 5 iterações de tool
  loop. Audit em help_questions.tool_calls + actions_taken.
```

- [ ] **Step 6.2: Commit + push (NÃO mergear)**

```bash
git add apps/api/src/db/migrations/054_help_questions_tool_calls.sql \
        apps/api/src/services/agenda-chat-tools.js \
        apps/api/src/routes/product-help.js \
        apps/api/tests/services/agenda-chat-tools.test.js \
        apps/api/tests/routes/product-help-tools.test.js \
        apps/api/package.json \
        CLAUDE.md
git commit -m "feat(copilot-agenda): tools + executor + integração com /product-help/ask"
git push -u origin feat/agenda-chat-tools-backend
```

- [ ] **Step 6.3: Apresentar pra aprovação**

Mensagem padrão:
> "Fase 1 entregue na branch `feat/agenda-chat-tools-backend`. Migration 054 aplicada local, X testes passando (era 243), smoke test confirma list/create/cancel via curl com confirmação multi-turn. test:unit verde. Posso mergear pra main?"

---

## Apêndice — Step 4.1 detalhado: edit em product-help.js

Mudanças mínimas:

```javascript
// No topo:
const { TOOL_DEFINITIONS, executeTool } = require('../services/agenda-chat-tools');

// Adicionar na função systemPrompt, no final, condicionalmente:
function systemPromptWithTools(ctx, enableTools) {
  const base = systemPrompt(ctx);
  if (!enableTools) return base;
  return base + `

## AÇÕES NA AGENDA (DISPONÍVEIS VIA TOOLS)

Você TAMBÉM pode executar ações na agenda do usuário usando as tools fornecidas.

REGRAS DE AÇÃO:
1. Para criar agendamento: SEMPRE chame find_subject primeiro pra resolver o nome do paciente. Se múltiplos matches, PERGUNTE qual antes de criar.
2. Para cancelar: NUNCA execute direto. Primeiro use get_appointment_details ou list_my_agenda pra encontrar o item, apresente os detalhes ao usuário em mensagem de texto, e PEÇA CONFIRMAÇÃO ("Confirma cancelar X às Y? [Sim/Não]"). Só chame cancel_appointment quando o usuário responder afirmativamente.
3. Após executar com sucesso, confirme em uma frase curta.
4. Se a tool retornar erro, explique em linguagem simples.
5. Datas/horas em pt-BR: aceite "amanhã", "hoje", "próxima segunda", "14h". Converta pra ISO ao chamar tools. Hoje é ${new Date().toISOString().slice(0,10)}.
6. Duração default 30min. Se usuário pedir fora da whitelist [30,45,60,75,90,105,120], use o mais próximo e mencione.
7. Tools sempre executam na agenda do usuário logado — não há como agendar pra outro profissional.`;
}

// Dentro do handler de POST /ask:
const { enable_agenda_tools, conversation_history } = request.body || {};

// Se enable_agenda_tools, monta loop de tool use; caso contrário, mantém streaming atual
if (!enable_agenda_tools) {
  // ... código atual (streaming)
  return;
}

// Loop de tool use (V1: não-streaming pra simplificar)
const messages = Array.isArray(conversation_history) && conversation_history.length > 0
  ? conversation_history.slice(-10) // cap
  : [];
messages.push({ role: 'user', content: `${docsText ? `Documentação:\n\n${docsText}\n\n---\n\n` : ''}Pergunta do usuário: ${question}` });

const toolContext = {
  fastify, tenant_id, user_id, module: userModule,
  log: request.log,
};

const toolCallsLog = [];
const actionsTakenLog = [];
let iterations = 0;
const MAX_ITERATIONS = 5;
let finalText = '';

reply.raw.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
});

try {
  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPromptWithTools(ctx, true),
      tools: TOOL_DEFINITIONS,
      messages,
    });

    // Acumula texto e tool_uses
    const toolUses = [];
    let textBlock = '';
    for (const block of response.content) {
      if (block.type === 'text') textBlock += block.text;
      else if (block.type === 'tool_use') toolUses.push(block);
    }

    if (textBlock) {
      finalText += textBlock;
      reply.raw.write(`event: delta\ndata: ${JSON.stringify({ text: textBlock })}\n\n`);
    }

    if (toolUses.length === 0) break; // LLM terminou

    // Adiciona assistant message à history
    messages.push({ role: 'assistant', content: response.content });

    // Executa tools em paralelo
    const toolResults = await Promise.all(toolUses.map(async (tu) => {
      reply.raw.write(`event: tool_call_started\ndata: ${JSON.stringify({ tool_name: tu.name })}\n\n`);
      toolCallsLog.push({ tool_name: tu.name, input: tu.input, started_at_ms: Date.now() });
      const r = await executeTool(tu.name, tu.input, toolContext);
      const ok = !r.result?.error && !r.error;
      actionsTakenLog.push({ tool_name: tu.name, ok, latency_ms: r.latency_ms, error: r.result?.error || r.error });
      reply.raw.write(`event: tool_call_completed\ndata: ${JSON.stringify({ tool_name: tu.name, ok })}\n\n`);
      return { tool_use_id: tu.id, content: JSON.stringify(r.result || { error: r.error }) };
    }));

    // Adiciona tool_results à history
    messages.push({
      role: 'user',
      content: toolResults.map(tr => ({ type: 'tool_result', tool_use_id: tr.tool_use_id, content: tr.content })),
    });

    if (response.usage) {
      inputTokens += response.usage.input_tokens || 0;
      outputTokens += response.usage.output_tokens || 0;
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    request.log.warn({ tool_calls: toolCallsLog }, 'product-help: hit MAX_ITERATIONS');
  }

  reply.raw.write(`event: done\ndata: ${JSON.stringify({ tool_calls_summary: toolCallsLog.map(t => t.tool_name) })}\n\n`);
} catch (err) {
  request.log.error({ err }, 'product-help: tools loop failed');
  reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: 'Falha — tente reformular' })}\n\n`);
} finally {
  reply.raw.end();
}

// Log estendido
fastify.pg.query(
  `INSERT INTO help_questions
   (tenant_id, user_id, route, component, user_role, question, answer_preview,
    tokens_input, tokens_output, latency_ms, tool_calls, actions_taken)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [tenant_id, user_id, ctx.route || 'unknown', ctx.component || null, role,
   question.slice(0, 1000), finalText.slice(0, 500),
   inputTokens, outputTokens, Date.now() - startTime,
   toolCallsLog.length > 0 ? JSON.stringify(toolCallsLog) : null,
   actionsTakenLog.length > 0 ? JSON.stringify(actionsTakenLog) : null]
).catch(err => request.log.error({ err }, 'help_questions insert failed'));
```

---

## Self-review checklist

- [ ] Migration aplicável idempotente (`IF NOT EXISTS`)
- [ ] Executors NÃO usam tenant_id/user_id do input (sempre do context)
- [ ] cancel_appointment description menciona confirmação obrigatória
- [ ] Hard cap 5 iterações
- [ ] `enable_agenda_tools=false` mantém comportamento atual intacto
- [ ] Tests: cada executor + ACL guard + integração mockada
- [ ] Sem dep nova
- [ ] Audit em help_questions com tool_calls + actions_taken

## Definition of Done (Fase 1)

- ✅ Migration 054 commitada
- ✅ Tool definitions + executors em `services/agenda-chat-tools.js`
- ✅ `/product-help/ask` aceita `enable_agenda_tools` + `conversation_history`
- ✅ Tests verdes (target ~280 no test:unit)
- ✅ Smoke test local: list/create/cancel funcional via curl com confirmação multi-turn
- ✅ Memória atualizada (CLAUDE.md)
- ✅ Branch pushed, aguardando aprovação humana antes do merge
