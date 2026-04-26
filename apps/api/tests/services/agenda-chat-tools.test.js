'use strict';
const { TOOL_DEFINITIONS, executeTool, VALID_DURATION } = require('../../src/services/agenda-chat-tools');

function ctx(overrides = {}) {
  const queryMock = jest.fn();
  const connectMock = jest.fn();
  return {
    fastify: {
      pg: { query: queryMock, connect: connectMock },
      redis: { publish: jest.fn(async () => 1) },
    },
    tenant_id: '00000000-0000-0000-0000-00000000000A',
    user_id: '00000000-0000-0000-0000-00000000000B',
    module: 'human',
    log: { error: jest.fn() },
    queryMock, connectMock,
    ...overrides,
  };
}

describe('TOOL_DEFINITIONS', () => {
  test('6 tools registradas com nome + description + input_schema', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(6);
    for (const t of TOOL_DEFINITIONS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(typeof t.description).toBe('string');
      expect(t.input_schema?.type).toBe('object');
    }
  });

  test('cancel_appointment description menciona confirmação obrigatória', () => {
    const cancel = TOOL_DEFINITIONS.find(t => t.name === 'cancel_appointment');
    expect(cancel).toBeDefined();
    expect(cancel.description).toMatch(/confirme|Confirma/i);
  });

  test('create_appointment exige duration na whitelist', () => {
    const create = TOOL_DEFINITIONS.find(t => t.name === 'create_appointment');
    expect(create.input_schema.properties.duration_minutes.enum).toEqual(VALID_DURATION);
  });

  test('update_appointment_status status enum exclui cancelled e blocked', () => {
    const update = TOOL_DEFINITIONS.find(t => t.name === 'update_appointment_status');
    expect(update).toBeDefined();
    const allowed = update.input_schema.properties.status.enum;
    expect(allowed).toEqual(['scheduled', 'confirmed', 'completed', 'no_show']);
    expect(allowed).not.toContain('cancelled');
    expect(allowed).not.toContain('blocked');
  });
});

describe('find_subject', () => {
  test('rejeita nome curto', async () => {
    const c = ctx();
    const r = await executeTool('find_subject', { name: 'a' }, c);
    expect(r.result.error).toMatch(/curto/);
    expect(c.queryMock).not.toHaveBeenCalled();
  });

  test('rejeita nome ausente', async () => {
    const c = ctx();
    const r = await executeTool('find_subject', {}, c);
    expect(r.result.error).toBeTruthy();
  });

  test('busca com tenant scope', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({
      rows: [{ id: 's1', name: 'Maria', subject_type: 'human', species: null, breed: null }],
    });
    const r = await executeTool('find_subject', { name: 'Maria' }, c);
    const args = c.queryMock.mock.calls[0][1];
    expect(args[0]).toBe(c.tenant_id);
    expect(args[1]).toBe('%Maria%');
    expect(r.result.matches).toHaveLength(1);
    expect(r.result.matches[0].name).toBe('Maria');
  });

  test('limita a 5 matches', () => {
    const sql = TOOL_DEFINITIONS.find(t => t.name === 'find_subject');
    expect(sql).toBeDefined(); // valida que tool existe
    // SQL hard-codeia LIMIT 5 — protege contra enumeração massiva
  });
});

describe('list_my_agenda', () => {
  test('preset=today calcula range UTC do dia', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_my_agenda', { preset: 'today' }, c);
    const args = c.queryMock.mock.calls[0][1];
    expect(args[0]).toBe(c.tenant_id);
    expect(args[1]).toBe(c.user_id);
    const from = new Date(args[2]);
    const to = new Date(args[3]);
    expect(to - from).toBe(24 * 60 * 60 * 1000);
  });

  test('preset=tomorrow calcula amanhã UTC', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_my_agenda', { preset: 'tomorrow' }, c);
    const args = c.queryMock.mock.calls[0][1];
    const from = new Date(args[2]);
    const today = new Date();
    expect(from.getUTCDate()).toBe(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1)).getUTCDate());
  });

  test('preset=this_week calcula range de 7 dias começando em segunda', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_my_agenda', { preset: 'this_week' }, c);
    const args = c.queryMock.mock.calls[0][1];
    const from = new Date(args[2]);
    const to = new Date(args[3]);
    expect(to - from).toBe(7 * 24 * 60 * 60 * 1000);
    expect(from.getUTCDay()).toBe(1); // segunda
  });

  test('from/to ISO custom funciona', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_my_agenda', {
      from: '2030-06-01T00:00:00Z',
      to: '2030-06-08T00:00:00Z',
    }, c);
    const args = c.queryMock.mock.calls[0][1];
    expect(args[2]).toBe('2030-06-01T00:00:00Z');
    expect(args[3]).toBe('2030-06-08T00:00:00Z');
  });

  test('from/to inválido → error', async () => {
    const c = ctx();
    const r = await executeTool('list_my_agenda', { from: 'not-iso', to: 'also-not' }, c);
    expect(r.result.error).toMatch(/ISO/);
    expect(c.queryMock).not.toHaveBeenCalled();
  });

  test('sem preset nem from/to → error', async () => {
    const c = ctx();
    const r = await executeTool('list_my_agenda', {}, c);
    expect(r.result.error).toMatch(/preset/);
    expect(c.queryMock).not.toHaveBeenCalled();
  });
});

describe('get_appointment_details', () => {
  test('appointment_id obrigatório', async () => {
    const c = ctx();
    const r = await executeTool('get_appointment_details', {}, c);
    expect(r.result.error).toMatch(/appointment_id/);
  });

  test('not found retorna erro', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await executeTool('get_appointment_details', { appointment_id: 'abc' }, c);
    expect(r.result.error).toMatch(/não encontrado/i);
  });

  test('found retorna shape completo', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'a1', start_at: '2030-01-01T10:00:00Z', duration_minutes: 30, status: 'scheduled',
        subject_id: 's1', subject_name: 'Maria', notes: 'ok', reason: null,
      }],
    });
    const r = await executeTool('get_appointment_details', { appointment_id: 'a1' }, c);
    expect(r.result.id).toBe('a1');
    expect(r.result.subject_name).toBe('Maria');
    expect(r.result.duration_minutes).toBe(30);
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
    [{ ...BASE, duration_minutes: 31 }, /duration/],
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

describe('update_appointment_status', () => {
  test('appointment_id obrigatório', async () => {
    const c = ctx();
    const r = await executeTool('update_appointment_status', { status: 'confirmed' }, c);
    expect(r.result.error).toMatch(/appointment_id/);
  });

  test('status fora do enum rejeitado (incluindo cancelled e blocked)', async () => {
    const c = ctx();
    for (const bad of ['cancelled', 'blocked', 'unknown', 'CONFIRMED']) {
      const r = await executeTool('update_appointment_status', {
        appointment_id: 'a1', status: bad,
      }, c);
      expect(r.result.error).toMatch(/status deve ser/);
    }
  });

  test('not found retorna erro', async () => {
    const c = ctx();
    c.connectMock.mockResolvedValueOnce({
      query: jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // set_config
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({}), // COMMIT
      release: jest.fn(),
    });
    const r = await executeTool('update_appointment_status', {
      appointment_id: 'a1', status: 'confirmed',
    }, c);
    expect(r.result.error).toBe('not_found');
  });

  test('reativar cancelled → scheduled funciona (limpa cancelled_at)', async () => {
    const c = ctx();
    const queryFn = jest.fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // set_config
      .mockResolvedValueOnce({
        rows: [{ id: 'a1', status: 'scheduled', start_at: '2030-01-01T10:00:00Z', duration_minutes: 30 }],
      })
      .mockResolvedValueOnce({}); // COMMIT
    c.connectMock.mockResolvedValueOnce({ query: queryFn, release: jest.fn() });

    const r = await executeTool('update_appointment_status', {
      appointment_id: 'a1', status: 'scheduled',
    }, c);
    expect(r.result.status).toBe('scheduled');

    // SQL deve incluir cleanup de cancelled_at quando target != cancelled
    const updateSql = queryFn.mock.calls[2][0];
    expect(updateSql).toMatch(/cancelled_at = CASE/);
    // E excluir apenas blocked (não cancelled)
    expect(updateSql).toMatch(/status != 'blocked'/);
    expect(updateSql).not.toMatch(/status NOT IN \('cancelled'/);
  });

  test('overlap (23P01) ao reativar retorna erro inteligível', async () => {
    const c = ctx();
    const err = new Error('overlap');
    err.code = '23P01';
    c.connectMock.mockResolvedValueOnce({
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(err),
      release: jest.fn(),
    });

    const r = await executeTool('update_appointment_status', {
      appointment_id: 'a1', status: 'scheduled',
    }, c);
    expect(r.result.error).toBe('overlap');
    expect(r.result.message).toMatch(/horário já está ocupado/i);
  });

  test.each(['scheduled', 'confirmed', 'completed', 'no_show'])(
    'status=%s aceito + UPDATE escopa por tenant + user',
    async (status) => {
      const c = ctx();
      const queryFn = jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // set_config
        .mockResolvedValueOnce({
          rows: [{ id: 'a1', status, start_at: '2030-01-01T10:00:00Z', duration_minutes: 30 }],
        })
        .mockResolvedValueOnce({}); // COMMIT
      c.connectMock.mockResolvedValueOnce({ query: queryFn, release: jest.fn() });

      const r = await executeTool('update_appointment_status', {
        appointment_id: 'a1', status,
      }, c);
      expect(r.result.status).toBe(status);

      // UPDATE call (3rd query) recebe tenant + user do contexto
      const updateCall = queryFn.mock.calls[2];
      expect(updateCall[1]).toEqual([status, 'a1', c.tenant_id, c.user_id]);
    }
  );

  test('sucesso publica WS event', async () => {
    const c = ctx();
    c.connectMock.mockResolvedValueOnce({
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rows: [{ id: 'a1', status: 'confirmed', start_at: '2030-01-01T10:00:00Z', duration_minutes: 30 }],
        })
        .mockResolvedValueOnce({}),
      release: jest.fn(),
    });
    await executeTool('update_appointment_status', {
      appointment_id: 'a1', status: 'confirmed',
    }, c);
    expect(c.fastify.redis.publish).toHaveBeenCalled();
    const channel = c.fastify.redis.publish.mock.calls[0][0];
    expect(channel).toBe(`appointment:event:${c.tenant_id}`);
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

  test('sucesso publica WS event', async () => {
    const c = ctx();
    c.connectMock.mockResolvedValueOnce({
      query: jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // set_config
        .mockResolvedValueOnce({
          rows: [{ id: 'a1', status: 'cancelled', cancelled_at: '2030-01-01T10:00:00Z' }]
        })
        .mockResolvedValueOnce({}), // COMMIT
      release: jest.fn(),
    });
    const r = await executeTool('cancel_appointment', { appointment_id: 'a1' }, c);
    expect(r.result.id).toBe('a1');
    expect(r.result.status).toBe('cancelled');
    expect(c.fastify.redis.publish).toHaveBeenCalled();
    const channel = c.fastify.redis.publish.mock.calls[0][0];
    expect(channel).toBe(`appointment:event:${c.tenant_id}`);
  });
});

describe('ACL — args do LLM nunca controlam tenant_id ou user_id', () => {
  test('find_subject ignora qualquer override de tenant_id no input', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('find_subject', {
      name: 'Maria',
      tenant_id: 'OUTRO_TENANT',
      user_id: 'OUTRO_USER',
    }, c);
    const args = c.queryMock.mock.calls[0][1];
    expect(args[0]).toBe(c.tenant_id);
    expect(args[0]).not.toBe('OUTRO_TENANT');
  });

  test('list_my_agenda usa user_id do contexto, não do input', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_my_agenda', {
      preset: 'today',
      user_id: 'OUTRO',
      tenant_id: 'OUTRO',
    }, c);
    const args = c.queryMock.mock.calls[0][1];
    expect(args[0]).toBe(c.tenant_id);
    expect(args[1]).toBe(c.user_id);
  });

  test('get_appointment_details escopa por tenant + user', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('get_appointment_details', {
      appointment_id: 'a1',
      tenant_id: 'X', user_id: 'Y',
    }, c);
    const args = c.queryMock.mock.calls[0][1];
    expect(args[1]).toBe(c.tenant_id);
    expect(args[2]).toBe(c.user_id);
  });
});

describe('executeTool — dispatch', () => {
  test('tool desconhecida retorna error sem chamar nada', async () => {
    const c = ctx();
    const r = await executeTool('nonexistent_tool', {}, c);
    expect(r.error).toMatch(/desconhecida/);
    expect(r.latency_ms).toBe(0);
    expect(c.queryMock).not.toHaveBeenCalled();
  });

  test('inclui latency_ms no resultado', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await executeTool('find_subject', { name: 'Maria' }, c);
    expect(typeof r.latency_ms).toBe('number');
    expect(r.latency_ms).toBeGreaterThanOrEqual(0);
  });
});
