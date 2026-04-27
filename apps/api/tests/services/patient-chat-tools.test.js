'use strict';
const { TOOL_DEFINITIONS, executeTool, VALID_SPECIES } = require('../../src/services/patient-chat-tools');

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
  test('3 tools registradas (V1: list, find, create)', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(3);
    const names = TOOL_DEFINITIONS.map(t => t.name).sort();
    expect(names).toEqual(['create_patient', 'find_patient_full_details', 'list_patients']);
  });

  test('create_patient description menciona confirmação obrigatória', () => {
    const t = TOOL_DEFINITIONS.find(d => d.name === 'create_patient');
    expect(t.description).toMatch(/confirm/i);
  });

  test('species enum cobre os tipos esperados', () => {
    const t = TOOL_DEFINITIONS.find(d => d.name === 'create_patient');
    expect(t.input_schema.properties.species.enum).toEqual(VALID_SPECIES);
  });
});

describe('list_patients', () => {
  test('retorna count + patients (sem filter)', async () => {
    const c = ctx();
    c.queryMock
      .mockResolvedValueOnce({ rows: [{ n: 42 }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 's1', name: 'Maria', subject_type: 'human', sex: 'F', birth_date: '1990-01-01', species: null, breed: null },
        ],
      });
    const r = await executeTool('list_patients', {}, c);
    expect(r.result.total).toBe(42);
    expect(r.result.showing).toBe(1);
    expect(r.result.patients[0].name).toBe('Maria');
  });

  test('filter_name aplica ILIKE com tenant scope', async () => {
    const c = ctx();
    c.queryMock
      .mockResolvedValueOnce({ rows: [{ n: 3 }] })
      .mockResolvedValueOnce({ rows: [] });
    await executeTool('list_patients', { filter_name: 'Maria' }, c);
    const countCall = c.queryMock.mock.calls[0];
    expect(countCall[1]).toEqual([c.tenant_id, '%Maria%']);
  });

  test('limit clamp entre 1 e 50', async () => {
    const c = ctx();
    c.queryMock
      .mockResolvedValueOnce({ rows: [{ n: 100 }] })
      .mockResolvedValueOnce({ rows: [] });
    await executeTool('list_patients', { limit: 999 }, c);
    const listCall = c.queryMock.mock.calls[1][0];
    expect(listCall).toContain('LIMIT 50');
  });
});

describe('find_patient_full_details', () => {
  test('patient_id obrigatório', async () => {
    const c = ctx();
    const r = await executeTool('find_patient_full_details', {}, c);
    expect(r.result.error).toMatch(/patient_id/);
  });

  test('not found retorna error', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await executeTool('find_patient_full_details', { patient_id: 'x' }, c);
    expect(r.result.error).toBe('not_found');
  });

  test('found retorna dados sem nulls', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'p1', name: 'Maria', subject_type: 'human', sex: 'F',
        birth_date: '1990-01-01', cpf_last4: null, phone: null,
        weight: 65, allergies: 'penicilina', notes: null,
        species: null, breed: null, color: null, microchip: null, neutered: null,
        consent_given_at: null, created_at: '2024-01-01',
        owner_name: null, owner_phone: null,
      }],
    });
    const r = await executeTool('find_patient_full_details', { patient_id: 'p1' }, c);
    expect(r.result.id).toBe('p1');
    expect(r.result.name).toBe('Maria');
    expect(r.result.weight).toBe(65);
    expect(r.result.allergies).toBe('penicilina');
    // nulls removidos pra response limpa
    expect(r.result.notes).toBeUndefined();
    expect(r.result.species).toBeUndefined();
  });
});

describe('create_patient — validação humano', () => {
  test('name curto rejeitado', async () => {
    const c = ctx({ module: 'human' });
    const r = await executeTool('create_patient', { name: 'a', sex: 'M', birth_date: '1990-01-01' }, c);
    expect(r.result.error).toMatch(/name/);
  });

  test('sex inválido rejeitado', async () => {
    const c = ctx({ module: 'human' });
    const r = await executeTool('create_patient', { name: 'Maria', sex: 'X', birth_date: '1990-01-01' }, c);
    expect(r.result.error).toMatch(/sex/);
  });

  test('birth_date obrigatório pra humano', async () => {
    const c = ctx({ module: 'human' });
    const r = await executeTool('create_patient', { name: 'Maria', sex: 'F' }, c);
    expect(r.result.error).toMatch(/birth_date/);
  });

  test('birth_date inválido rejeitado', async () => {
    const c = ctx({ module: 'human' });
    const r = await executeTool('create_patient', { name: 'Maria', sex: 'F', birth_date: '01/01/1990' }, c);
    expect(r.result.error).toMatch(/birth_date/);
  });

  test('species rejeitado em humano (vetcheck)', async () => {
    const c = ctx({ module: 'human' });
    const r = await executeTool('create_patient', {
      name: 'Maria', sex: 'F', birth_date: '1990-01-01', species: 'dog',
    }, c);
    expect(r.result.error).toMatch(/species/);
  });

  test('humano válido cria + publica WS', async () => {
    const c = ctx({ module: 'human' });
    // Dup check
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    // Insert via withTenant
    c.connectMock.mockResolvedValueOnce({
      query: jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // set_config
        .mockResolvedValueOnce({
          rows: [{ id: 'new1', name: 'Maria', subject_type: 'human', sex: 'F', birth_date: '1990-01-01' }],
        })
        .mockResolvedValueOnce({}), // COMMIT
      release: jest.fn(),
    });
    const r = await executeTool('create_patient', {
      name: 'Maria Silva', sex: 'F', birth_date: '1990-01-01',
    }, c);
    expect(r.result.id).toBe('new1');
    expect(c.fastify.redis.publish).toHaveBeenCalledWith(
      `subject:upserted:${c.tenant_id}`,
      expect.stringContaining('new1')
    );
  });

  test('duplicate_name retorna lista de existentes', async () => {
    const c = ctx({ module: 'human' });
    c.queryMock.mockResolvedValueOnce({
      rows: [{ id: 'e1', name: 'Maria Silva' }],
    });
    const r = await executeTool('create_patient', {
      name: 'Maria Silva', sex: 'F', birth_date: '1990-01-01',
    }, c);
    expect(r.result.error).toBe('duplicate_name');
    expect(r.result.existing).toHaveLength(1);
    expect(r.result.existing[0].name).toBe('Maria Silva');
  });
});

describe('create_patient — validação veterinário', () => {
  test('species obrigatório pra vet', async () => {
    const c = ctx({ module: 'veterinary' });
    const r = await executeTool('create_patient', { name: 'Rex', sex: 'M' }, c);
    expect(r.result.error).toMatch(/species/);
  });

  test('species fora da whitelist rejeitada', async () => {
    const c = ctx({ module: 'veterinary' });
    const r = await executeTool('create_patient', {
      name: 'Rex', sex: 'M', species: 'dragon',
    }, c);
    expect(r.result.error).toMatch(/species/);
  });

  test('vet sem birth_date é OK (animais nem sempre têm)', async () => {
    const c = ctx({ module: 'veterinary' });
    c.queryMock.mockResolvedValueOnce({ rows: [] }); // dup check
    c.connectMock.mockResolvedValueOnce({
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rows: [{ id: 'a1', name: 'Rex', subject_type: 'animal', sex: 'M', species: 'dog' }],
        })
        .mockResolvedValueOnce({}),
      release: jest.fn(),
    });
    const r = await executeTool('create_patient', {
      name: 'Rex', sex: 'M', species: 'dog',
    }, c);
    expect(r.result.id).toBe('a1');
  });
});

describe('ACL — args do LLM nunca controlam tenant_id ou user_id', () => {
  test('list_patients ignora override de tenant_id', async () => {
    const c = ctx();
    c.queryMock
      .mockResolvedValueOnce({ rows: [{ n: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    await executeTool('list_patients', { tenant_id: 'EVIL', user_id: 'EVIL' }, c);
    expect(c.queryMock.mock.calls[0][1][0]).toBe(c.tenant_id);
  });

  test('find_patient_full_details escopa por tenant', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('find_patient_full_details', {
      patient_id: 'p1', tenant_id: 'EVIL',
    }, c);
    const args = c.queryMock.mock.calls[0][1];
    expect(args[0]).toBe(c.tenant_id);
    expect(args[1]).toBe('p1');
  });
});
