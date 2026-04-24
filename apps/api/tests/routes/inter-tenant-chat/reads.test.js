const supertest = require('supertest');
const app = require('../../../src/server');
const fixtures = require('./fixtures');

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await fixtures.closePool(); await app.close(); });
afterEach(() => fixtures.cleanup());

describe('POST /inter-tenant-chat/conversations/:id/read', () => {
  it('204 atualiza last_read_at e zera unread_count', async () => {
    const { a, b, conversationId } = await fixtures.createConversedPair(app);
    // b envia mensagem
    await fixtures.getPool().query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
       VALUES ($1, $2, $3, 'oi')`,
      [conversationId, b.tenantId, b.userId]
    );

    // a tinha unread_count=1
    let res = await supertest(app.server)
      .get('/inter-tenant-chat/conversations')
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.body.results.find(c => c.id === conversationId).unread_count).toBe(1);

    // a marca como lido
    res = await supertest(app.server)
      .post(`/inter-tenant-chat/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(204);

    // unread zera
    res = await supertest(app.server)
      .get('/inter-tenant-chat/conversations')
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.body.results.find(c => c.id === conversationId).unread_count).toBe(0);
  });

  it('403 para não-membro', async () => {
    const { conversationId } = await fixtures.createConversedPair(app);
    const c = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post(`/inter-tenant-chat/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${c.token}`);
    expect(res.status).toBe(403);
  });
});
