const supertest = require('supertest');
const app = require('../../../src/server');
const fixtures = require('./fixtures');

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await fixtures.closePool(); await app.close(); });
afterEach(() => fixtures.cleanup());

describe('E2E HTTP: fluxo completo do chat entre tenants', () => {
  it('settings → directory → invite → accept → message → read → search', async () => {
    const a = await fixtures.createTenantWithAdmin(app, { module: 'human' });
    const b = await fixtures.createTenantWithAdmin(app, { module: 'human' });

    // 1. A opt-in no diretório
    let res = await supertest(app.server)
      .put('/inter-tenant-chat/settings')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ visible_in_directory: true });
    expect(res.status).toBe(200);
    expect(res.body.visible_in_directory).toBe(true);

    // 2. B faz busca no diretório → vê A
    res = await supertest(app.server)
      .get('/inter-tenant-chat/directory')
      .set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.results.map(r => r.tenant_id);
    expect(ids).toContain(a.tenantId);

    // 3. B convida A
    res = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ to_tenant_id: a.tenantId, message: 'Olá!' });
    expect(res.status).toBe(201);
    const inviteId = res.body.id;

    // 4. A vê convite
    res = await supertest(app.server)
      .get('/inter-tenant-chat/invitations?direction=incoming')
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.body.results.some(i => i.id === inviteId)).toBe(true);

    // 5. A aceita → conversation criada
    res = await supertest(app.server)
      .post(`/inter-tenant-chat/invitations/${inviteId}/accept`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(201);
    const convId = res.body.conversation_id;
    expect(convId).toBeDefined();

    // 6. B lista conversas → vê counterpart=A
    res = await supertest(app.server)
      .get('/inter-tenant-chat/conversations')
      .set('Authorization', `Bearer ${b.token}`);
    const conv = res.body.results.find(c => c.id === convId);
    expect(conv).toBeDefined();
    expect(conv.counterpart_tenant_id).toBe(a.tenantId);

    // 7. B envia mensagem
    res = await supertest(app.server)
      .post(`/inter-tenant-chat/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ body: 'olá vizinho de clínica!' });
    expect(res.status).toBe(201);

    // 8. A lista mensagens → vê a mensagem
    res = await supertest(app.server)
      .get(`/inter-tenant-chat/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.body.results.length).toBeGreaterThanOrEqual(1);
    expect(res.body.results[0].body).toContain('vizinho');

    // 9. A viu — unread_count = 1 antes de POST /read
    res = await supertest(app.server)
      .get('/inter-tenant-chat/conversations')
      .set('Authorization', `Bearer ${a.token}`);
    const aView = res.body.results.find(c => c.id === convId);
    expect(aView.unread_count).toBe(1);

    // 10. A marca como lido
    res = await supertest(app.server)
      .post(`/inter-tenant-chat/conversations/${convId}/read`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(204);

    // 11. unread zera
    res = await supertest(app.server)
      .get('/inter-tenant-chat/conversations')
      .set('Authorization', `Bearer ${a.token}`);
    const aViewAfter = res.body.results.find(c => c.id === convId);
    expect(aViewAfter.unread_count).toBe(0);

    // 12. A busca por "vizinho" na conversa → 1 match com snippet highlighted
    res = await supertest(app.server)
      .get(`/inter-tenant-chat/conversations/${convId}/search?q=vizinho`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(1);
    expect(res.body.results[0].snippet).toContain('<mark>');
  });

  it('tenant fora do par tem 403 em todos os endpoints da conversa', async () => {
    const { conversationId } = await fixtures.createConversedPair(app);
    const c = await fixtures.createTenantWithAdmin(app);

    const endpoints = [
      ['get',  `/inter-tenant-chat/conversations/${conversationId}`],
      ['get',  `/inter-tenant-chat/conversations/${conversationId}/messages`],
      ['get',  `/inter-tenant-chat/conversations/${conversationId}/search?q=x`],
      ['post', `/inter-tenant-chat/conversations/${conversationId}/read`],
      ['post', `/inter-tenant-chat/conversations/${conversationId}/archive`],
      ['post', `/inter-tenant-chat/conversations/${conversationId}/unarchive`],
      ['delete', `/inter-tenant-chat/conversations/${conversationId}`],
    ];
    for (const [method, path] of endpoints) {
      let req = supertest(app.server)[method](path).set('Authorization', `Bearer ${c.token}`);
      if (method === 'post') req = req.send({ body: 'intruso' });
      const res = await req;
      expect(res.status).toBe(403);
    }
  });
});
