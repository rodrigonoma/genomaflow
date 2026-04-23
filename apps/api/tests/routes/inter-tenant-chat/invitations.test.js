const supertest = require('supertest');
const app = require('../../../src/server');
const fixtures = require('./fixtures');

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await fixtures.closePool(); await app.close(); });
afterEach(() => fixtures.cleanup());

describe('POST /inter-tenant-chat/invitations', () => {
  it('201 cria convite pending', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId, message: 'Olá!' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('pending');
    expect(res.body.message).toBe('Olá!');
  });

  it('400 sem to_tenant_id', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('400 para self-invite', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: a.tenantId });
    expect(res.status).toBe(400);
  });

  it('400 cross-module', async () => {
    const a = await fixtures.createTenantWithAdmin(app, { module: 'human' });
    const b = await fixtures.createTenantWithAdmin(app, { module: 'veterinary' });
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    expect(res.status).toBe(400);
  });

  it('404 para tenant inexistente', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('409 se já tem convite pending para o mesmo destinatário', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    expect(res.status).toBe(409);
  });

  it('429 quando há bloqueio bilateral (recipient bloqueou sender)', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    await fixtures.getPool().query(
      `INSERT INTO tenant_blocks (blocker_tenant_id, blocked_tenant_id) VALUES ($1, $2)`,
      [b.tenantId, a.tenantId]
    );
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    expect(res.status).toBe(429);
  });

  it('429 quando cooldown ativo (3+ rejeições)', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    // Cria 3 convites rejeitados recentes
    for (let i = 0; i < 3; i++) {
      await fixtures.getPool().query(
        `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id, responded_at)
         VALUES ($1, $2, 'human', 'rejected', $3, NOW())`,
        [a.tenantId, b.tenantId, a.userId]
      );
    }
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    expect(res.status).toBe(429);
  });
});

describe('GET /inter-tenant-chat/invitations', () => {
  it('lista incoming', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    const res = await supertest(app.server)
      .get('/inter-tenant-chat/invitations?direction=incoming')
      .set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThanOrEqual(1);
    expect(res.body.results[0].to_tenant_id).toBe(b.tenantId);
  });

  it('lista outgoing', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    const res = await supertest(app.server)
      .get('/inter-tenant-chat/invitations?direction=outgoing')
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThanOrEqual(1);
    expect(res.body.results[0].from_tenant_id).toBe(a.tenantId);
  });
});

describe('POST /inter-tenant-chat/invitations/:id/accept', () => {
  it('cria conversation e marca accepted', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    const inv = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    const res = await supertest(app.server)
      .post(`/inter-tenant-chat/invitations/${inv.body.id}/accept`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(201);
    expect(res.body.conversation_id).toBeDefined();
  });

  it('404 se não é o destinatário', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    const inv = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    const res = await supertest(app.server)
      .post(`/inter-tenant-chat/invitations/${inv.body.id}/accept`)
      .set('Authorization', `Bearer ${a.token}`);  // sender tentando aceitar
    expect(res.status).toBe(404);
  });

  it('404 se já não está pending', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    const inv = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    await supertest(app.server)
      .post(`/inter-tenant-chat/invitations/${inv.body.id}/accept`)
      .set('Authorization', `Bearer ${b.token}`);
    const res = await supertest(app.server)
      .post(`/inter-tenant-chat/invitations/${inv.body.id}/accept`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /inter-tenant-chat/invitations/:id/reject', () => {
  it('204 marca como rejected', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    const inv = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    const res = await supertest(app.server)
      .post(`/inter-tenant-chat/invitations/${inv.body.id}/reject`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(204);
  });
});

describe('DELETE /inter-tenant-chat/invitations/:id', () => {
  it('204 cancela se sender e pending', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    const inv = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    const res = await supertest(app.server)
      .delete(`/inter-tenant-chat/invitations/${inv.body.id}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(204);
  });

  it('404 se não sender', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    const inv = await supertest(app.server)
      .post('/inter-tenant-chat/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ to_tenant_id: b.tenantId });
    const res = await supertest(app.server)
      .delete(`/inter-tenant-chat/invitations/${inv.body.id}`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(404);
  });
});
