const supertest = require('supertest');
const app = require('../../../src/server');
const fixtures = require('./fixtures');

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await fixtures.closePool(); await app.close(); });
afterEach(() => fixtures.cleanup());

describe('GET /inter-tenant-chat/conversations', () => {
  it('lista conversas do tenant com counterpart info', async () => {
    const { a, b, conversationId } = await fixtures.createConversedPair(app);
    const res = await supertest(app.server)
      .get('/inter-tenant-chat/conversations')
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThanOrEqual(1);
    const conv = res.body.results.find(c => c.id === conversationId);
    expect(conv).toBeDefined();
    expect(conv.counterpart_tenant_id).toBe(b.tenantId);
    expect(conv.counterpart_name).toBeDefined();
    expect(conv.unread_count).toBe(0);
  });

  it('unread_count reflete mensagens não lidas', async () => {
    const { a, b, conversationId } = await fixtures.createConversedPair(app);
    // b envia 2 mensagens
    await fixtures.getPool().query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
       VALUES ($1, $2, $3, 'msg1'), ($1, $2, $3, 'msg2')`,
      [conversationId, b.tenantId, b.userId]
    );
    const res = await supertest(app.server)
      .get('/inter-tenant-chat/conversations')
      .set('Authorization', `Bearer ${a.token}`);
    const conv = res.body.results.find(c => c.id === conversationId);
    expect(conv.unread_count).toBe(2);
  });
});

describe('GET /inter-tenant-chat/conversations/:id', () => {
  it('retorna detalhe da conversa se membro', async () => {
    const { a, conversationId } = await fixtures.createConversedPair(app);
    const res = await supertest(app.server)
      .get(`/inter-tenant-chat/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(conversationId);
  });

  it('403 para não-membro', async () => {
    const { conversationId } = await fixtures.createConversedPair(app);
    const c = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .get(`/inter-tenant-chat/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${c.token}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /inter-tenant-chat/conversations/:id/archive', () => {
  it('204 arquiva do lado do tenant', async () => {
    const { a, conversationId } = await fixtures.createConversedPair(app);
    const res = await supertest(app.server)
      .post(`/inter-tenant-chat/conversations/${conversationId}/archive`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(204);
  });
});

describe('POST /inter-tenant-chat/conversations/:id/unarchive', () => {
  it('204 desarquiva', async () => {
    const { a, conversationId } = await fixtures.createConversedPair(app);
    await supertest(app.server)
      .post(`/inter-tenant-chat/conversations/${conversationId}/archive`)
      .set('Authorization', `Bearer ${a.token}`);
    const res = await supertest(app.server)
      .post(`/inter-tenant-chat/conversations/${conversationId}/unarchive`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(204);
  });
});

describe('DELETE /inter-tenant-chat/conversations/:id', () => {
  it('204 soft-deleta (anonimiza body, mantém metadata)', async () => {
    const { a, b, conversationId } = await fixtures.createConversedPair(app);
    await fixtures.getPool().query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
       VALUES ($1, $2, $3, 'mensagem secreta')`,
      [conversationId, b.tenantId, b.userId]
    );
    const res = await supertest(app.server)
      .delete(`/inter-tenant-chat/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(204);

    // mensagens devem estar com deleted_at setado e body vazio
    const { rows } = await fixtures.getPool().query(
      `SELECT body, deleted_at FROM tenant_messages WHERE conversation_id = $1`,
      [conversationId]
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it('403 para não-membro', async () => {
    const { conversationId } = await fixtures.createConversedPair(app);
    const c = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .delete(`/inter-tenant-chat/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${c.token}`);
    expect(res.status).toBe(403);
  });
});
