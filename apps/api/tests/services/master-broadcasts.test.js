'use strict';
/**
 * Unit tests pra apps/api/src/services/master-broadcasts.js.
 *
 * - resolveTargetTenants: testa cada kind (all/module/tenant) + edge cases
 *   (module inválido, tenant inativo, kind ausente)
 * - deliverToTenant: testa sequência de queries via mock client; valida
 *   master é sempre tenant_a, conversation kind é master_broadcast, delivery
 *   row é inserida com IDs corretos
 */

const {
  MASTER_TENANT_ID,
  resolveTargetTenants,
  deliverToTenant,
} = require('../../src/services/master-broadcasts');

describe('resolveTargetTenants', () => {
  test('kind=all → todos os tenants ativos exceto master, ordenados por nome', async () => {
    const pg = {
      query: jest.fn(async () => ({
        rows: [
          { id: 't1', module: 'human' },
          { id: 't2', module: 'veterinary' },
        ],
      })),
    };
    const result = await resolveTargetTenants(pg, { kind: 'all' });
    expect(result).toEqual([
      { id: 't1', module: 'human' },
      { id: 't2', module: 'veterinary' },
    ]);

    const [sql, params] = pg.query.mock.calls[0];
    expect(sql).toMatch(/active = true/);
    expect(sql).toMatch(/id <> \$1/);
    expect(sql).toMatch(/ORDER BY name/);
    expect(params).toEqual([MASTER_TENANT_ID]);
  });

  test('kind=module value=human → AND module=$2', async () => {
    const pg = { query: jest.fn(async () => ({ rows: [{ id: 't1', module: 'human' }] })) };
    await resolveTargetTenants(pg, { kind: 'module', value: 'human' });

    const [sql, params] = pg.query.mock.calls[0];
    expect(sql).toMatch(/AND module = \$2/);
    expect(params).toEqual([MASTER_TENANT_ID, 'human']);
  });

  test('kind=module value=veterinary funciona', async () => {
    const pg = { query: jest.fn(async () => ({ rows: [{ id: 't2', module: 'veterinary' }] })) };
    const result = await resolveTargetTenants(pg, { kind: 'module', value: 'veterinary' });
    expect(result).toEqual([{ id: 't2', module: 'veterinary' }]);
  });

  test('kind=module value inválido → throw', async () => {
    const pg = { query: jest.fn() };
    await expect(
      resolveTargetTenants(pg, { kind: 'module', value: 'invalid' })
    ).rejects.toThrow(/module inválido/);
    expect(pg.query).not.toHaveBeenCalled();
  });

  test('kind=tenant value=specific_uuid → SELECT WHERE id=$1 AND active', async () => {
    const pg = {
      query: jest.fn(async () => ({ rows: [{ id: 'specific', module: 'human' }] })),
    };
    const result = await resolveTargetTenants(pg, { kind: 'tenant', value: 'specific' });
    expect(result).toEqual([{ id: 'specific', module: 'human' }]);

    const [sql, params] = pg.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$1 AND active = true/);
    expect(params).toEqual(['specific', MASTER_TENANT_ID]);
  });

  test('kind=tenant tenant inativo → array vazio (não joga)', async () => {
    const pg = { query: jest.fn(async () => ({ rows: [] })) };
    const result = await resolveTargetTenants(pg, { kind: 'tenant', value: 'gone' });
    expect(result).toEqual([]);
  });

  test('kind=tenant sem value → throw', async () => {
    const pg = { query: jest.fn() };
    await expect(
      resolveTargetTenants(pg, { kind: 'tenant' })
    ).rejects.toThrow(/tenant value obrigatório/);
    expect(pg.query).not.toHaveBeenCalled();
  });

  test('kind inválido → throw', async () => {
    const pg = { query: jest.fn() };
    await expect(
      resolveTargetTenants(pg, { kind: 'broadcast_to_pluto' })
    ).rejects.toThrow(/segment kind inválido/);
    expect(pg.query).not.toHaveBeenCalled();
  });

  test('segment ausente → throw', async () => {
    const pg = { query: jest.fn() };
    await expect(resolveTargetTenants(pg, null)).rejects.toThrow(/segment kind inválido/);
    await expect(resolveTargetTenants(pg, undefined)).rejects.toThrow(/segment kind inválido/);
  });
});

describe('deliverToTenant', () => {
  function buildClient() {
    // Cada query retorna resposta distinta — usamos mockResolvedValueOnce em cadeia
    return {
      query: jest.fn(),
    };
  }

  test('happy path sem anexos: INSERT conv UPSERT → INSERT msg (has_attachment=false) → UPDATE conv → INSERT delivery', async () => {
    const client = buildClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1' }] }) // INSERT tenant_conversations
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] })  // INSERT tenant_messages
      .mockResolvedValueOnce({})                            // UPDATE last_message_at
      .mockResolvedValueOnce({});                           // INSERT master_broadcast_deliveries

    const result = await deliverToTenant(client, {
      broadcastId: 'bc-1',
      masterUserId: 'master-user',
      recipientTenant: { id: 'tenant-x', module: 'human' },
      body: 'Olá mundo',
    });

    expect(result).toEqual({ conversationId: 'conv-1', messageId: 'msg-1' });
    expect(client.query).toHaveBeenCalledTimes(4);

    // INSERT tenant_messages: has_attachment=false (5o param)
    const msgInsert = client.query.mock.calls[1];
    expect(msgInsert[0]).toMatch(/INSERT INTO tenant_messages/);
    expect(msgInsert[1]).toEqual(['conv-1', MASTER_TENANT_ID, 'master-user', 'Olá mundo', false]);
  });

  test('com anexos: INSERT msg (has_attachment=true) → INSERT tenant_message_attachments por anexo', async () => {
    const client = buildClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1' }] }) // INSERT conv
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] })  // INSERT msg
      .mockResolvedValueOnce({})                            // INSERT attachment 1
      .mockResolvedValueOnce({})                            // INSERT attachment 2
      .mockResolvedValueOnce({})                            // UPDATE conv
      .mockResolvedValueOnce({});                           // INSERT delivery

    await deliverToTenant(client, {
      broadcastId: 'bc-1',
      masterUserId: 'master-user',
      recipientTenant: { id: 'tenant-x', module: 'human' },
      body: 'Com anexo',
      attachments: [
        { kind: 'image', filename: 'foo.jpg', s3_key: 'master-broadcasts/bc-1/abc.jpg', size_bytes: 1024 },
        { kind: 'pdf',   filename: 'doc.pdf', s3_key: 'master-broadcasts/bc-1/def.pdf', size_bytes: 2048 },
      ],
    });

    expect(client.query).toHaveBeenCalledTimes(6);

    // has_attachment=true
    const msgInsert = client.query.mock.calls[1];
    expect(msgInsert[1][4]).toBe(true);

    // INSERT attachments — kind, s3_key, size_bytes
    const att1 = client.query.mock.calls[2];
    expect(att1[0]).toMatch(/INSERT INTO tenant_message_attachments/);
    expect(att1[1]).toEqual(['msg-1', 'image', 'master-broadcasts/bc-1/abc.jpg', 1024]);
    const att2 = client.query.mock.calls[3];
    expect(att2[1]).toEqual(['msg-1', 'pdf', 'master-broadcasts/bc-1/def.pdf', 2048]);
  });

  test('UPSERT conversation: master sempre é tenant_a (menor UUID), kind=master_broadcast', async () => {
    const client = buildClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await deliverToTenant(client, {
      broadcastId: 'bc-1',
      masterUserId: 'master-user',
      recipientTenant: { id: 'tenant-x', module: 'veterinary' },
      body: 'broadcast text',
    });

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO tenant_conversations/);
    expect(sql).toMatch(/'master_broadcast'/);
    expect(sql).toMatch(/ON CONFLICT \(tenant_a_id, tenant_b_id\) DO UPDATE/);
    // Params: tenant_a=master, tenant_b=recipient, module=recipient.module
    expect(params).toEqual([MASTER_TENANT_ID, 'tenant-x', 'veterinary']);
  });

  test('INSERT message: sender_tenant=master, sender_user=masterUserId, body literal, has_attachment=false sem anexos', async () => {
    const client = buildClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await deliverToTenant(client, {
      broadcastId: 'bc-1',
      masterUserId: 'master-user-uuid',
      recipientTenant: { id: 'tenant-x', module: 'human' },
      body: 'mensagem completa',
    });

    const [sql, params] = client.query.mock.calls[1];
    expect(sql).toMatch(/INSERT INTO tenant_messages/);
    expect(params).toEqual(['conv-1', MASTER_TENANT_ID, 'master-user-uuid', 'mensagem completa', false]);
  });

  test('INSERT delivery: broadcast_id, tenant_id, conversation_id, message_id corretos (sem anexos = call 3)', async () => {
    const client = buildClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'conv-99' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'msg-99' }] })
      .mockResolvedValueOnce({})  // UPDATE conv
      .mockResolvedValueOnce({}); // INSERT delivery

    await deliverToTenant(client, {
      broadcastId: 'bc-42',
      masterUserId: 'master-user',
      recipientTenant: { id: 'tenant-z', module: 'human' },
      body: 'oi',
    });

    const [sql, params] = client.query.mock.calls[3];
    expect(sql).toMatch(/INSERT INTO master_broadcast_deliveries/);
    expect(params).toEqual(['bc-42', 'tenant-z', 'conv-99', 'msg-99']);
  });

  test('erro em qualquer query propaga (transação será rollback no withTenant)', async () => {
    const client = buildClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1' }] })
      .mockRejectedValueOnce(new Error('insert message failed'));

    await expect(
      deliverToTenant(client, {
        broadcastId: 'bc-1',
        masterUserId: 'master-user',
        recipientTenant: { id: 'tenant-x', module: 'human' },
        body: 'x',
      })
    ).rejects.toThrow(/insert message failed/);
  });
});
