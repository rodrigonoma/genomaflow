const supertest = require('supertest');
const app = require('../../../src/server');
const fixtures = require('./fixtures');

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await fixtures.closePool(); await app.close(); });
afterEach(() => fixtures.cleanup());

describe('GET /inter-tenant-chat/blocks', () => {
  it('lista bloqueios do tenant', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    await fixtures.getPool().query(
      `INSERT INTO tenant_blocks (blocker_tenant_id, blocked_tenant_id, reason) VALUES ($1, $2, 'spam')`,
      [a.tenantId, b.tenantId]
    );
    const res = await supertest(app.server)
      .get('/inter-tenant-chat/blocks')
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThanOrEqual(1);
    expect(res.body.results[0].blocked_tenant_id).toBe(b.tenantId);
  });
});

describe('POST /inter-tenant-chat/blocks', () => {
  it('201 cria bloqueio', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/blocks')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ blocked_tenant_id: b.tenantId, reason: 'motivo' });
    expect(res.status).toBe(201);
  });

  it('400 para self-block', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/blocks')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ blocked_tenant_id: a.tenantId });
    expect(res.status).toBe(400);
  });

  it('400 sem blocked_tenant_id', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/blocks')
      .set('Authorization', `Bearer ${a.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('201 idempotente (ON CONFLICT DO NOTHING)', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    await supertest(app.server)
      .post('/inter-tenant-chat/blocks')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ blocked_tenant_id: b.tenantId });
    const res2 = await supertest(app.server)
      .post('/inter-tenant-chat/blocks')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ blocked_tenant_id: b.tenantId });
    expect(res2.status).toBe(201);
  });
});

describe('DELETE /inter-tenant-chat/blocks/:tenant_id', () => {
  it('204 remove bloqueio', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    await fixtures.getPool().query(
      `INSERT INTO tenant_blocks (blocker_tenant_id, blocked_tenant_id) VALUES ($1, $2)`,
      [a.tenantId, b.tenantId]
    );
    const res = await supertest(app.server)
      .delete(`/inter-tenant-chat/blocks/${b.tenantId}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(204);
  });

  it('404 se bloqueio não existe', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .delete(`/inter-tenant-chat/blocks/${b.tenantId}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(404);
  });
});
