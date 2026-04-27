'use strict';
/**
 * Validation/handler tests pra POST /master/broadcasts.
 *
 * ACL master-only é garantido em tests/security/master-acl.test.js.
 * Aqui foco em:
 *   - Body validation (vazio, > 2000 chars)
 *   - Segment validation (kind whitelist, value por tipo)
 *   - Sem alvos elegíveis → 400
 *   - Happy path: chama pg, redis, retorna recipient_count
 *
 * Padrão Fastify isolado: pg.connect retorna client mockado pra cobrir
 * fan-out. redis.publish é mockado.
 */

const Fastify = require('fastify');

function buildApp({ role = 'master', targets, deliveryFails } = {}) {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async function (request) {
    request.user = {
      user_id: 'master-user',
      tenant_id: '00000000-0000-0000-0000-000000000001',
      role,
      module: 'human',
    };
  });

  // Cliente de transação retornado por pg.connect()
  const txClient = {
    query: jest.fn(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
      if (sql.startsWith('SELECT set_config')) return {};
      if (deliveryFails) throw new Error('synthetic delivery failure');
      if (sql.includes('INSERT INTO tenant_conversations')) return { rows: [{ id: 'conv-x' }] };
      if (sql.includes('INSERT INTO tenant_messages')) return { rows: [{ id: 'msg-x' }] };
      if (sql.includes('UPDATE tenant_conversations')) return {};
      if (sql.includes('INSERT INTO master_broadcast_deliveries')) return {};
      return { rows: [] };
    }),
    release: jest.fn(),
  };

  // Pool: query é usado fora de tx (resolveTargets, INSERT canonical, UPDATE recipient_count).
  // connect retorna o txClient pra withTenant
  const pgQuery = jest.fn(async (sql) => {
    if (sql.startsWith('SELECT id, module FROM tenants')) {
      return { rows: targets || [] };
    }
    if (sql.includes('INSERT INTO master_broadcasts')) {
      return { rows: [{ id: 'bc-1', created_at: '2026-04-27T15:00:00Z' }] };
    }
    if (sql.includes('UPDATE master_broadcasts')) return {};
    return { rows: [] };
  });

  app.decorate('pg', {
    query: pgQuery,
    connect: jest.fn(async () => txClient),
  });

  app.decorate('redis', {
    publish: jest.fn(async () => 1),
  });

  return { app, pgQuery, txClient };
}

async function withApp(opts) {
  const ctx = buildApp(opts);
  await ctx.app.register(require('../../src/routes/master'), { prefix: '/master' });
  await ctx.app.ready();
  return ctx;
}

describe('POST /master/broadcasts — validation gates', () => {
  test('body vazio → 400', async () => {
    const { app } = await withApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: { body: '   ', segment: { kind: 'all' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/body é obrigatório/);
    await app.close();
  });

  test('body > 2000 chars → 400', async () => {
    const { app } = await withApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: { body: 'x'.repeat(2001), segment: { kind: 'all' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/excede/);
    await app.close();
  });

  test('segment ausente → 400', async () => {
    const { app } = await withApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: { body: 'oi' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/segment é obrigatório/);
    await app.close();
  });

  test('segment.kind inválido → 400', async () => {
    const { app } = await withApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: { body: 'oi', segment: { kind: 'pluto' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/kind inválido/);
    await app.close();
  });

  test('segment.kind=module sem value válido → 400', async () => {
    const { app } = await withApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: { body: 'oi', segment: { kind: 'module', value: 'invalid' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/value inválido/);
    await app.close();
  });

  test('segment.kind=tenant sem value → 400', async () => {
    const { app } = await withApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: { body: 'oi', segment: { kind: 'tenant' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/value obrigatório/);
    await app.close();
  });

  test('targets vazio → 400 (Nenhum tenant elegível)', async () => {
    const { app } = await withApp({ targets: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: { body: 'oi', segment: { kind: 'all' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Nenhum tenant/);
    await app.close();
  });

  test('attachments > 5 → 400', async () => {
    const { app } = await withApp({});
    const big = Array.from({ length: 6 }, (_, i) => ({
      kind: 'image', filename: `f${i}.jpg`, mime_type: 'image/jpeg',
      data_base64: Buffer.from('x').toString('base64'),
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: { body: 'x', segment: { kind: 'all' }, attachments: big },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/máximo 5 anexos/);
    await app.close();
  });

  test('attachment.kind inválido → 400', async () => {
    const { app } = await withApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: {
        body: 'x', segment: { kind: 'all' },
        attachments: [{ kind: 'video', filename: 'v.mp4', mime_type: 'video/mp4', data_base64: 'aGVsbG8=' }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/anexo\.kind inválido/);
    await app.close();
  });

  test('attachment image com mime PDF → 400', async () => {
    const { app } = await withApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: {
        body: 'x', segment: { kind: 'all' },
        attachments: [{ kind: 'image', filename: 'fake.jpg', mime_type: 'application/pdf', data_base64: 'aGVsbG8=' }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/mime_type inválido/);
    await app.close();
  });

  test('attachment data_base64 ausente → 400', async () => {
    const { app } = await withApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: {
        body: 'x', segment: { kind: 'all' },
        attachments: [{ kind: 'image', filename: 'a.jpg', mime_type: 'image/jpeg' }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/data_base64 obrigatório/);
    await app.close();
  });

  test('attachment > 10MB → 400', async () => {
    const { app } = await withApp({});
    // 11MB de zeros em base64
    const big = Buffer.alloc(11 * 1024 * 1024).toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: {
        body: 'x', segment: { kind: 'all' },
        attachments: [{ kind: 'pdf', filename: 'big.pdf', mime_type: 'application/pdf', data_base64: big }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/excede 10MB/);
    await app.close();
  });
});

describe('POST /master/broadcasts — happy path', () => {
  test('all com 2 tenants → 200, recipient_count=2, redis publish 2x', async () => {
    const { app, pgQuery } = await withApp({
      targets: [
        { id: 't-human', module: 'human' },
        { id: 't-vet', module: 'veterinary' },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: { body: 'Teste de comunicado', segment: { kind: 'all' } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.broadcast_id).toBe('bc-1');
    expect(body.recipient_count).toBe(2);
    expect(body.target_count).toBe(2);

    // INSERT canonical foi feito
    const insertCall = pgQuery.mock.calls.find(
      ([sql]) => sql.includes('INSERT INTO master_broadcasts')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toEqual([
      'master-user', 'Teste de comunicado', 'all', null,
    ]);

    // UPDATE recipient_count foi feito com o número entregue
    const updateCall = pgQuery.mock.calls.find(
      ([sql]) => sql.includes('UPDATE master_broadcasts SET recipient_count')
    );
    expect(updateCall[1]).toEqual([2, 'bc-1']);

    // Redis publish chamado 2x (1 por tenant)
    expect(app.redis.publish).toHaveBeenCalledTimes(2);
    expect(app.redis.publish.mock.calls[0][0]).toBe('chat:event:t-human');
    const msg = JSON.parse(app.redis.publish.mock.calls[0][1]);
    expect(msg.event).toBe('master_broadcast_received');
    expect(msg.conversation_id).toBe('conv-x');
    expect(msg.message_id).toBe('msg-x');

    await app.close();
  });

  test('module=human → segment_value=human persistido', async () => {
    const { app, pgQuery } = await withApp({
      targets: [{ id: 't-human', module: 'human' }],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: { body: 'só humanos', segment: { kind: 'module', value: 'human' } },
    });

    expect(res.statusCode).toBe(200);
    const insertCall = pgQuery.mock.calls.find(
      ([sql]) => sql.includes('INSERT INTO master_broadcasts')
    );
    expect(insertCall[1]).toEqual(['master-user', 'só humanos', 'module', 'human']);
    await app.close();
  });

  test('tenant=specific_uuid → segment_value=uuid persistido', async () => {
    const { app, pgQuery } = await withApp({
      targets: [{ id: 'tenant-z', module: 'human' }],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: { body: 'pra você', segment: { kind: 'tenant', value: 'tenant-z' } },
    });

    expect(res.statusCode).toBe(200);
    const insertCall = pgQuery.mock.calls.find(
      ([sql]) => sql.includes('INSERT INTO master_broadcasts')
    );
    expect(insertCall[1]).toEqual(['master-user', 'pra você', 'tenant', 'tenant-z']);
    expect(res.json().recipient_count).toBe(1);
    await app.close();
  });

  test('falha em uma entrega não derruba o broadcast inteiro', async () => {
    const { app } = await withApp({
      targets: [
        { id: 't-1', module: 'human' },
        { id: 't-2', module: 'human' },
      ],
      deliveryFails: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/master/broadcasts',
      payload: { body: 'x', segment: { kind: 'all' } },
    });

    // 200 retornado mas recipient_count=0 (deliveryFails simula erro em todas as queries)
    expect(res.statusCode).toBe(200);
    expect(res.json().recipient_count).toBe(0);
    expect(res.json().target_count).toBe(2);
    await app.close();
  });
});
