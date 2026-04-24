const supertest = require('supertest');
const app = require('../../../src/server');
const fixtures = require('./fixtures');

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await fixtures.closePool(); await app.close(); });
afterEach(() => fixtures.cleanup());

describe('POST /inter-tenant-chat/conversations/:id/messages', () => {
  it('201 cria mensagem + atualiza last_message_at', async () => {
    const { a, conversationId } = await fixtures.createConversedPair(app);
    const res = await supertest(app.server)
      .post(`/inter-tenant-chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ body: 'olá vizinho' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.body).toBe('olá vizinho');

    const { rows } = await fixtures.getPool().query(
      `SELECT last_message_at FROM tenant_conversations WHERE id = $1`,
      [conversationId]
    );
    expect(rows[0].last_message_at).not.toBeNull();
  });

  it('400 body vazio', async () => {
    const { a, conversationId } = await fixtures.createConversedPair(app);
    const res = await supertest(app.server)
      .post(`/inter-tenant-chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ body: '' });
    expect(res.status).toBe(400);
  });

  it('400 body muito longo (>5000)', async () => {
    const { a, conversationId } = await fixtures.createConversedPair(app);
    const res = await supertest(app.server)
      .post(`/inter-tenant-chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ body: 'x'.repeat(5001) });
    expect(res.status).toBe(400);
  });

  it('403 para não-membro', async () => {
    const { conversationId } = await fixtures.createConversedPair(app);
    const c = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post(`/inter-tenant-chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${c.token}`)
      .send({ body: 'intruso' });
    expect(res.status).toBe(403);
  });
});

describe('GET /inter-tenant-chat/conversations/:id/messages', () => {
  it('lista mensagens mais recentes primeiro', async () => {
    const { a, b, conversationId } = await fixtures.createConversedPair(app);
    // Insere em queries separadas pra ter timestamps distintos (ORDER BY created_at DESC)
    await fixtures.getPool().query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
       VALUES ($1, $2, $3, 'primeira')`,
      [conversationId, a.tenantId, a.userId]
    );
    // Pequena espera pra garantir timestamp diferente
    await new Promise(r => setTimeout(r, 10));
    await fixtures.getPool().query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
       VALUES ($1, $2, $3, 'segunda')`,
      [conversationId, b.tenantId, b.userId]
    );
    const res = await supertest(app.server)
      .get(`/inter-tenant-chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThanOrEqual(2);
    // Ordem: mais recente primeiro
    const bodies = res.body.results.map(m => m.body);
    expect(bodies[0]).toBe('segunda');
  });

  it('limit respeita parâmetro', async () => {
    const { a, conversationId } = await fixtures.createConversedPair(app);
    for (let i = 0; i < 5; i++) {
      await fixtures.getPool().query(
        `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
         VALUES ($1, $2, $3, 'msg' || $4)`,
        [conversationId, a.tenantId, a.userId, i]
      );
    }
    const res = await supertest(app.server)
      .get(`/inter-tenant-chat/conversations/${conversationId}/messages?limit=2`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(2);
  });

  it('ignora mensagens com deleted_at setado', async () => {
    const { a, conversationId } = await fixtures.createConversedPair(app);
    await fixtures.getPool().query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body, deleted_at)
       VALUES ($1, $2, $3, 'deleted', NOW())`,
      [conversationId, a.tenantId, a.userId]
    );
    const res = await supertest(app.server)
      .get(`/inter-tenant-chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${a.token}`);
    const bodies = res.body.results.map(m => m.body);
    expect(bodies).not.toContain('deleted');
  });
});

describe('GET /inter-tenant-chat/conversations/:id/search', () => {
  it('busca full-text em português', async () => {
    const { a, conversationId } = await fixtures.createConversedPair(app);
    await fixtures.getPool().query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
       VALUES ($1, $2, $3, 'cardiologia preventiva')`,
      [conversationId, a.tenantId, a.userId]
    );
    const res = await supertest(app.server)
      .get(`/inter-tenant-chat/conversations/${conversationId}/search?q=cardiologia`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThanOrEqual(1);
    expect(res.body.results[0].snippet).toContain('cardiologia');
  });

  it('400 sem q', async () => {
    const { a, conversationId } = await fixtures.createConversedPair(app);
    const res = await supertest(app.server)
      .get(`/inter-tenant-chat/conversations/${conversationId}/search`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(400);
  });
});
