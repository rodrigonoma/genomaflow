'use strict';
/**
 * Tests para GET/POST/PUT/DELETE /master/aesthetic-treatments.
 *
 * Fastify isolado. pg.query e pg.connect/client stubados para evitar DB real.
 * withTenant chama pg.connect, então precisamos de um mock completo de pool+client.
 *
 * Casos cobertos:
 *   - GET: lista all rows, filtro category, filtro active=all/false (inclui inativos)
 *   - POST: INSERT com tenant_id=NULL, validação de body
 *   - PUT: atualiza só row global (tenant_id IS NULL); 404 se não encontra
 *   - DELETE: soft delete só row global; 204; 404 se não encontra
 *   - 403 se role !== 'master' em todos os endpoints
 */

const Fastify = require('fastify');

const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const MASTER_USER_ID   = '00000000-0000-0000-0000-000000000099';
const TREATMENT_ID     = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// Factory para criar app de teste com pg completo mockado.
// queryImpl: chamado pra `client.query` dentro de withTenant (transação).
// poolQueryImpl: chamado pra `fastify.pg.query` direto (GET list).
function buildApp({
  role = 'master',
  poolQueryRows = [],
  clientQueryImpl,
} = {}) {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async function (request) {
    request.user = {
      user_id:   MASTER_USER_ID,
      tenant_id: MASTER_TENANT_ID,
      role,
      module:    'estetica',
    };
  });

  // Mock para fastify.pg.query (usado no GET list)
  const poolQueryFn = jest.fn(async () => ({ rows: poolQueryRows }));

  // Mock para client usado dentro de withTenant (BEGIN/set_config/query/COMMIT)
  const clientQueryFn = clientQueryImpl
    ? jest.fn(clientQueryImpl)
    : jest.fn(async (sql) => {
        // Default: transação overhead (BEGIN, set_config, COMMIT) retorna vazio
        return { rows: [], rowCount: 0 };
      });

  const mockClient = {
    query: clientQueryFn,
    release: jest.fn(),
  };

  app.decorate('pg', {
    query: poolQueryFn,
    connect: jest.fn(async () => mockClient),
  });

  return { app, poolQueryFn, clientQueryFn, mockClient };
}

async function withApp(opts) {
  const mocks = buildApp(opts);
  await mocks.app.register(require('../../src/routes/master'), { prefix: '/master' });
  await mocks.app.ready();
  return mocks;
}

// ── GET /master/aesthetic-treatments ───────────────────────────────────────

describe('GET /master/aesthetic-treatments', () => {
  test('retorna items com status 200', async () => {
    const fakeRows = [
      { id: TREATMENT_ID, tenant_id: null, name: 'Laser CO₂', category: 'facial_rejuvenescimento', is_active: true },
      { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', tenant_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', name: 'Proprietary', category: 'outro', is_active: true },
    ];
    const { app, poolQueryFn } = await withApp({ poolQueryRows: fakeRows });
    const res = await app.inject({ method: 'GET', url: '/master/aesthetic-treatments' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: fakeRows });
    // Default: filtra só ativos (sem active=all/false)
    const [sql] = poolQueryFn.mock.calls[0];
    expect(sql).toMatch(/is_active = true/);
    await app.close();
  });

  test('filtro category: vira $1 parametrizado', async () => {
    const { app, poolQueryFn } = await withApp({ poolQueryRows: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/master/aesthetic-treatments?category=facial_acne',
    });
    expect(res.statusCode).toBe(200);
    const [sql, params] = poolQueryFn.mock.calls[0];
    expect(sql).toMatch(/category = \$1/);
    expect(params).toContain('facial_acne');
    await app.close();
  });

  test('active=all: remove filtro is_active da query', async () => {
    const { app, poolQueryFn } = await withApp({ poolQueryRows: [] });
    await app.inject({ method: 'GET', url: '/master/aesthetic-treatments?active=all' });
    const [sql] = poolQueryFn.mock.calls[0];
    expect(sql).not.toMatch(/is_active = true/);
    await app.close();
  });

  test('active=false: remove filtro is_active da query', async () => {
    const { app, poolQueryFn } = await withApp({ poolQueryRows: [] });
    await app.inject({ method: 'GET', url: '/master/aesthetic-treatments?active=false' });
    const [sql] = poolQueryFn.mock.calls[0];
    expect(sql).not.toMatch(/is_active = true/);
    await app.close();
  });

  test('403 se role !== master', async () => {
    const { app } = await withApp({ role: 'admin', poolQueryRows: [] });
    const res = await app.inject({ method: 'GET', url: '/master/aesthetic-treatments' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

// ── POST /master/aesthetic-treatments ──────────────────────────────────────

describe('POST /master/aesthetic-treatments', () => {
  const validBody = {
    name: 'Microagulhamento',
    category: 'facial_rejuvenescimento',
    indications: ['rugas', 'cicatrizes'],
    contraindications: ['gravidez'],
  };

  test('cria row com tenant_id=NULL e retorna 201', async () => {
    const insertedRow = { id: TREATMENT_ID, tenant_id: null, ...validBody, is_active: true };

    let capturedSql = '';
    let capturedParams = [];

    const { app } = await withApp({
      clientQueryImpl: async (sql, params) => {
        // Overhead de transação (BEGIN, set_config, COMMIT)
        if (/BEGIN|set_config|COMMIT/i.test(sql)) return { rows: [], rowCount: 0 };
        // INSERT real
        capturedSql = sql;
        capturedParams = params || [];
        return { rows: [insertedRow], rowCount: 1 };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/master/aesthetic-treatments',
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(insertedRow);

    // tenant_id deve ser NULL no INSERT (parâmetro explícito)
    expect(capturedSql).toMatch(/INSERT INTO aesthetic_treatments/);
    expect(capturedSql).toMatch(/VALUES \(NULL/);
    await app.close();
  });

  test('400 se body inválido — category inválido', async () => {
    const { app } = await withApp();
    const res = await app.inject({
      method: 'POST',
      url: '/master/aesthetic-treatments',
      payload: { ...validBody, category: 'categoria_inexistente' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/category/);
    await app.close();
  });

  test('400 se body sem name', async () => {
    const { app } = await withApp();
    const res = await app.inject({
      method: 'POST',
      url: '/master/aesthetic-treatments',
      payload: { category: 'outro', indications: [], contraindications: [] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('400 se indications não é array', async () => {
    const { app } = await withApp();
    const res = await app.inject({
      method: 'POST',
      url: '/master/aesthetic-treatments',
      payload: { name: 'X', category: 'outro', indications: 'string', contraindications: [] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('403 se role !== master', async () => {
    const { app } = await withApp({ role: 'admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/master/aesthetic-treatments',
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

// ── PUT /master/aesthetic-treatments/:id ───────────────────────────────────

describe('PUT /master/aesthetic-treatments/:id', () => {
  test('atualiza row global e retorna 200 com row atualizada', async () => {
    const updatedRow = {
      id: TREATMENT_ID,
      tenant_id: null,
      name: 'Microagulhamento Pro',
      category: 'facial_rejuvenescimento',
      is_active: true,
    };

    const { app } = await withApp({
      clientQueryImpl: async (sql, params) => {
        if (/BEGIN|set_config|COMMIT/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [updatedRow], rowCount: 1 };
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/master/aesthetic-treatments/${TREATMENT_ID}`,
      payload: { name: 'Microagulhamento Pro' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(updatedRow);
    await app.close();
  });

  test('404 se row não é global (tenant_id IS NULL não bate)', async () => {
    const { app } = await withApp({
      clientQueryImpl: async (sql) => {
        if (/BEGIN|set_config|COMMIT/i.test(sql)) return { rows: [], rowCount: 0 };
        // Simula que WHERE id = $1 AND tenant_id IS NULL retornou vazio
        return { rows: [], rowCount: 0 };
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/master/aesthetic-treatments/${TREATMENT_ID}`,
      payload: { name: 'Atualização' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/não encontrado/);
    await app.close();
  });

  test('400 se category inválido', async () => {
    const { app } = await withApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/master/aesthetic-treatments/${TREATMENT_ID}`,
      payload: { category: 'invalido_xpto' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/category/);
    await app.close();
  });

  test('400 se evidence_level inválido', async () => {
    const { app } = await withApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/master/aesthetic-treatments/${TREATMENT_ID}`,
      payload: { evidence_level: 'Z' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/evidence_level/);
    await app.close();
  });

  test('403 se role !== master', async () => {
    const { app } = await withApp({ role: 'admin' });
    const res = await app.inject({
      method: 'PUT',
      url: `/master/aesthetic-treatments/${TREATMENT_ID}`,
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

// ── DELETE /master/aesthetic-treatments/:id ─────────────────────────────────

describe('DELETE /master/aesthetic-treatments/:id', () => {
  test('soft delete row global — retorna 204', async () => {
    let capturedSql = '';
    const { app } = await withApp({
      clientQueryImpl: async (sql) => {
        if (/BEGIN|set_config|COMMIT/i.test(sql)) return { rows: [], rowCount: 0 };
        capturedSql = sql;
        return { rows: [], rowCount: 1 };
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/master/aesthetic-treatments/${TREATMENT_ID}`,
    });

    expect(res.statusCode).toBe(204);
    // Confirma soft delete (is_active=false) e restrição a tenant_id IS NULL
    expect(capturedSql).toMatch(/is_active = false/);
    expect(capturedSql).toMatch(/tenant_id IS NULL/);
    await app.close();
  });

  test('404 se row não encontrada ou já inativa', async () => {
    const { app } = await withApp({
      clientQueryImpl: async (sql) => {
        if (/BEGIN|set_config|COMMIT/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/master/aesthetic-treatments/${TREATMENT_ID}`,
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  test('403 se role !== master', async () => {
    const { app } = await withApp({ role: 'admin' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/master/aesthetic-treatments/${TREATMENT_ID}`,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
