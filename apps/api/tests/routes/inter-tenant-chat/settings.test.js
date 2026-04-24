const supertest = require('supertest');
const app = require('../../../src/server');
const fixtures = require('./fixtures');
const { withTenant } = require('../../../src/db/tenant');

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await fixtures.closePool(); await app.close(); });
afterEach(() => fixtures.cleanup());

describe('GET /inter-tenant-chat/settings', () => {
  it('401 sem token', async () => {
    const res = await supertest(app.server).get('/inter-tenant-chat/settings');
    expect(res.status).toBe(401);
  });

  it('403 para role master (chat é admin-only V1)', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    const masterToken = app.jwt.sign({
      user_id: t.userId, tenant_id: t.tenantId, role: 'master', module: 'human', jti: 'fake-master-jti'
    });
    if (app.redis) await app.redis.set(`session:${t.userId}`, 'fake-master-jti', 'EX', 60);
    const res = await supertest(app.server)
      .get('/inter-tenant-chat/settings')
      .set('Authorization', `Bearer ${masterToken}`);
    expect(res.status).toBe(403);
  });

  it('cria settings com defaults se não existir', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .get('/inter-tenant-chat/settings')
      .set('Authorization', `Bearer ${t.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      visible_in_directory: false,
      notify_on_invite_email: true,
      notify_on_message_email: false,
      message_email_quiet_after_minutes: 30,
    });
  });

  it('retorna settings existentes', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    await withTenant(fixtures.getPool(), t.tenantId, c => c.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)`,
      [t.tenantId]
    ));
    const res = await supertest(app.server)
      .get('/inter-tenant-chat/settings')
      .set('Authorization', `Bearer ${t.token}`);
    expect(res.status).toBe(200);
    expect(res.body.visible_in_directory).toBe(true);
  });
});

describe('PUT /inter-tenant-chat/settings', () => {
  it('atualiza visible_in_directory e dispara trigger de diretório', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .put('/inter-tenant-chat/settings')
      .set('Authorization', `Bearer ${t.token}`)
      .send({ visible_in_directory: true });
    expect(res.status).toBe(200);
    expect(res.body.visible_in_directory).toBe(true);

    // Trigger sync_tenant_directory deve ter inserido linha em directory_listing
    const { rows } = await fixtures.getPool().query(
      `SELECT 1 FROM tenant_directory_listing WHERE tenant_id = $1`, [t.tenantId]
    );
    expect(rows.length).toBe(1);
  });

  it('atualiza múltiplos campos de uma vez', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .put('/inter-tenant-chat/settings')
      .set('Authorization', `Bearer ${t.token}`)
      .send({
        visible_in_directory: true,
        notify_on_message_email: true,
        message_email_quiet_after_minutes: 60
      });
    expect(res.status).toBe(200);
    expect(res.body.visible_in_directory).toBe(true);
    expect(res.body.notify_on_message_email).toBe(true);
    expect(res.body.message_email_quiet_after_minutes).toBe(60);
  });

  it('400 com payload inválido (tipo errado)', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .put('/inter-tenant-chat/settings')
      .set('Authorization', `Bearer ${t.token}`)
      .send({ visible_in_directory: 'sim' });
    expect(res.status).toBe(400);
  });

  it('400 para message_email_quiet_after_minutes negativo', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .put('/inter-tenant-chat/settings')
      .set('Authorization', `Bearer ${t.token}`)
      .send({ message_email_quiet_after_minutes: -5 });
    expect(res.status).toBe(400);
  });

  it('400 para payload vazio', async () => {
    const t = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .put('/inter-tenant-chat/settings')
      .set('Authorization', `Bearer ${t.token}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
