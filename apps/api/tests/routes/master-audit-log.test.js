'use strict';
/**
 * Validation/handler tests pra GET /master/audit-log e GET /master/audit-log/:id.
 *
 * ACL master-only já é coberto em tests/security/master-acl.test.js. Aqui foco em:
 *   - Clamp de `limit` (1..200, default 100) e `days` (1..180, default 30)
 *   - Construção dinâmica de WHERE com filtros (entity_type, actor_channel,
 *     action, entity_id, actor_user_id, tenant_id) — confere placeholders
 *     parametrizados (sem interpolação)
 *   - 404 quando audit entry não existe
 *
 * Fastify isolado com pg.query stubado retornando rows configuráveis. Captura
 * SQL e params pra assert que filtros viram `$N` parametrizados.
 */

const Fastify = require('fastify');

function buildApp({ role = 'master', queryRows = [], queryImpl } = {}) {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async function (request) {
    request.user = {
      user_id: '00000000-0000-0000-0000-000000000099',
      tenant_id: '00000000-0000-0000-0000-000000000099',
      role,
      module: 'human',
    };
  });

  const queryFn = queryImpl
    ? jest.fn(queryImpl)
    : jest.fn(async () => ({ rows: queryRows }));

  app.decorate('pg', { query: queryFn });
  return { app, queryFn };
}

async function withApp(opts) {
  const { app, queryFn } = buildApp(opts);
  await app.register(require('../../src/routes/master'), { prefix: '/master' });
  await app.ready();
  return { app, queryFn };
}

describe('GET /master/audit-log — filter & clamp', () => {
  test('default: days=30, limit=100, sem filtros extras', async () => {
    const { app, queryFn } = await withApp({ queryRows: [] });
    const res = await app.inject({ method: 'GET', url: '/master/audit-log' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toBe(30);
    expect(body.limit).toBe(100);
    expect(body.results).toEqual([]);

    const [sql, params] = queryFn.mock.calls[0];
    expect(sql).toMatch(/INTERVAL '1 day' \* \$1/);
    expect(sql).toMatch(/LIMIT 100/);
    expect(params).toEqual([30]);
    expect(sql).not.toMatch(/AND a\.entity_type =/);
    await app.close();
  });

  test('clamp: days > 180 vira 180; limit > 200 vira 200', async () => {
    const { app, queryFn } = await withApp({ queryRows: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/master/audit-log?days=999&limit=999',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().days).toBe(180);
    expect(res.json().limit).toBe(200);
    const [sql, params] = queryFn.mock.calls[0];
    expect(params[0]).toBe(180);
    expect(sql).toMatch(/LIMIT 200/);
    await app.close();
  });

  test('clamp: days/limit negativos viram 1', async () => {
    const { app, queryFn } = await withApp({ queryRows: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/master/audit-log?days=-5&limit=-5',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().days).toBe(1);
    expect(res.json().limit).toBe(1);
    const [sql, params] = queryFn.mock.calls[0];
    expect(params[0]).toBe(1);
    expect(sql).toMatch(/LIMIT 1/);
    await app.close();
  });

  test('zero ou inválido cai no default (30/100) por causa do `|| default`', async () => {
    const { app } = await withApp({ queryRows: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/master/audit-log?days=0&limit=abc',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().days).toBe(30);
    expect(res.json().limit).toBe(100);
    await app.close();
  });

  test('filtro entity_type: vira $2 parametrizado, não interpolado', async () => {
    const { app, queryFn } = await withApp({ queryRows: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/master/audit-log?entity_type=appointments',
    });
    expect(res.statusCode).toBe(200);
    const [sql, params] = queryFn.mock.calls[0];
    expect(sql).toMatch(/AND a\.entity_type = \$2/);
    expect(params).toEqual([30, 'appointments']);
    expect(sql).not.toMatch(/appointments/);
    await app.close();
  });

  test('múltiplos filtros: actor_channel + action + tenant_id', async () => {
    const { app, queryFn } = await withApp({ queryRows: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/master/audit-log?actor_channel=copilot&action=update&tenant_id=11111111-1111-1111-1111-111111111111',
    });
    expect(res.statusCode).toBe(200);
    const [sql, params] = queryFn.mock.calls[0];
    expect(sql).toMatch(/AND a\.actor_channel = \$2/);
    expect(sql).toMatch(/AND a\.tenant_id = \$3/);
    expect(sql).toMatch(/AND a\.action = \$4/);
    expect(params).toEqual([
      30,
      'copilot',
      '11111111-1111-1111-1111-111111111111',
      'update',
    ]);
    await app.close();
  });

  test('todos os filtros simultâneos: entity_type, entity_id, actor_user_id, actor_channel, tenant_id, action', async () => {
    const { app, queryFn } = await withApp({ queryRows: [] });
    const res = await app.inject({
      method: 'GET',
      url:
        '/master/audit-log?entity_type=subjects&entity_id=22222222-2222-2222-2222-222222222222' +
        '&actor_user_id=33333333-3333-3333-3333-333333333333&actor_channel=ui' +
        '&tenant_id=44444444-4444-4444-4444-444444444444&action=delete',
    });
    expect(res.statusCode).toBe(200);
    const [, params] = queryFn.mock.calls[0];
    expect(params).toEqual([
      30,
      'subjects',
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
      'ui',
      '44444444-4444-4444-4444-444444444444',
      'delete',
    ]);
    await app.close();
  });

  test('SELECT inclui JOIN tenants + users (tenant_name + actor_email)', async () => {
    const { app, queryFn } = await withApp({ queryRows: [] });
    await app.inject({ method: 'GET', url: '/master/audit-log' });
    const [sql] = queryFn.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN tenants t ON t\.id = a\.tenant_id/);
    expect(sql).toMatch(/LEFT JOIN users u ON u\.id = a\.actor_user_id/);
    expect(sql).toMatch(/t\.name AS tenant_name/);
    expect(sql).toMatch(/u\.email AS actor_email/);
    await app.close();
  });

  test('retorna rows do db dentro de results', async () => {
    const fakeRow = {
      id: 'aaa',
      tenant_id: 't1',
      entity_type: 'appointments',
      action: 'insert',
      actor_channel: 'copilot',
      created_at: '2026-04-27T10:00:00Z',
    };
    const { app } = await withApp({ queryRows: [fakeRow] });
    const res = await app.inject({ method: 'GET', url: '/master/audit-log' });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([fakeRow]);
    await app.close();
  });
});

describe('GET /master/audit-log/:id — drill-down', () => {
  test('retorna 404 quando entry não existe', async () => {
    const { app } = await withApp({ queryRows: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/master/audit-log/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Audit entry not found' });
    await app.close();
  });

  test('retorna entry completo com old_data + new_data + changed_fields', async () => {
    const fakeEntry = {
      id: 'abc',
      tenant_id: 't1',
      entity_type: 'subjects',
      entity_id: 's1',
      action: 'update',
      actor_user_id: 'u1',
      actor_channel: 'ui',
      old_data: { name: 'João', sex: 'M' },
      new_data: { name: 'João Silva', sex: 'M' },
      changed_fields: ['name'],
      created_at: '2026-04-27T10:00:00Z',
      tenant_name: 'Clínica Demo',
      actor_email: 'admin@demo.com',
    };
    const { app, queryFn } = await withApp({ queryRows: [fakeEntry] });
    const res = await app.inject({ method: 'GET', url: '/master/audit-log/abc' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(fakeEntry);

    const [sql, params] = queryFn.mock.calls[0];
    expect(sql).toMatch(/a\.old_data, a\.new_data/);
    expect(sql).toMatch(/WHERE a\.id = \$1/);
    expect(params).toEqual(['abc']);
    await app.close();
  });
});
