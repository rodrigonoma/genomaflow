const supertest = require('supertest');
const app = require('../../../src/server');
const fixtures = require('./fixtures');
const { withTenant } = require('../../../src/db/tenant');

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await fixtures.closePool(); await app.close(); });
afterEach(() => fixtures.cleanup());

async function makeVisible(tenantId) {
  await withTenant(fixtures.getPool(), tenantId, c => c.query(
    `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)
     ON CONFLICT (tenant_id) DO UPDATE SET visible_in_directory = true`, [tenantId]
  ));
}

describe('GET /inter-tenant-chat/directory', () => {
  it('401 sem token', async () => {
    const res = await supertest(app.server).get('/inter-tenant-chat/directory');
    expect(res.status).toBe(401);
  });

  it('lista clínicas opt-in do mesmo módulo e exclui cross-module', async () => {
    const me = await fixtures.createTenantWithAdmin(app, { module: 'human' });
    const other = await fixtures.createTenantWithAdmin(app, { module: 'human' });
    const otherModule = await fixtures.createTenantWithAdmin(app, { module: 'veterinary' });
    await makeVisible(other.tenantId);
    await makeVisible(otherModule.tenantId);

    const res = await supertest(app.server)
      .get('/inter-tenant-chat/directory')
      .set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toBeInstanceOf(Array);
    const ids = res.body.results.map(r => r.tenant_id);
    expect(ids).toContain(other.tenantId);
    expect(ids).not.toContain(otherModule.tenantId);
  });

  it('exclui o próprio tenant', async () => {
    const me = await fixtures.createTenantWithAdmin(app);
    await makeVisible(me.tenantId);
    const res = await supertest(app.server)
      .get('/inter-tenant-chat/directory')
      .set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.results.map(r => r.tenant_id);
    expect(ids).not.toContain(me.tenantId);
  });

  it('filtro por uf não quebra (retorna vazio ou filtrado)', async () => {
    const me = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .get('/inter-tenant-chat/directory?uf=SP')
      .set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toBeInstanceOf(Array);
  });

  it('busca por nome (q) usa ILIKE/trigram', async () => {
    const me = await fixtures.createTenantWithAdmin(app);
    const t1 = await fixtures.createTenantWithAdmin(app, { name: 'Cardio-' + Date.now() });
    const t2 = await fixtures.createTenantWithAdmin(app, { name: 'Pediatria-' + Date.now() });
    await makeVisible(t1.tenantId);
    await makeVisible(t2.tenantId);

    const res = await supertest(app.server)
      .get('/inter-tenant-chat/directory?q=cardio')
      .set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.results.map(r => r.tenant_id);
    expect(ids).toContain(t1.tenantId);
    expect(ids).not.toContain(t2.tenantId);
  });

  it('paginação respeita page e page_size', async () => {
    const me = await fixtures.createTenantWithAdmin(app);
    for (let i = 0; i < 5; i++) {
      const x = await fixtures.createTenantWithAdmin(app);
      await makeVisible(x.tenantId);
    }
    const res = await supertest(app.server)
      .get('/inter-tenant-chat/directory?page=1&page_size=2')
      .set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(2);
    expect(res.body.page).toBe(1);
    expect(res.body.page_size).toBe(2);
  });
});
