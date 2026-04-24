const supertest = require('supertest');
const app = require('../../../src/server');
const fixtures = require('./fixtures');

beforeAll(async () => { await app.ready(); });
afterAll(async () => {
  const p = fixtures.getPool();
  await p.query(`DELETE FROM tenant_chat_reports WHERE reporter_tenant_id IN (SELECT id FROM tenants WHERE name LIKE 'chat-api-test-%')`);
  await fixtures.closePool();
  await app.close();
});
afterEach(async () => {
  const p = fixtures.getPool();
  await p.query(`DELETE FROM tenant_chat_reports WHERE reporter_tenant_id IN (SELECT id FROM tenants WHERE name LIKE 'chat-api-test-%')`);
  await fixtures.cleanup();
});

describe('POST /inter-tenant-chat/reports', () => {
  it('201 cria denúncia', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/reports')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ reported_tenant_id: b.tenantId, reason: 'Comportamento abusivo no chat' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
  });

  it('400 para self-report', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/reports')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ reported_tenant_id: a.tenantId, reason: 'tentando self' });
    expect(res.status).toBe(400);
  });

  it('400 reason curta', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/reports')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ reported_tenant_id: b.tenantId, reason: 'x' });
    expect(res.status).toBe(400);
  });

  it('409 denúncia duplicada pendente do mesmo par', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    await supertest(app.server)
      .post('/inter-tenant-chat/reports')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ reported_tenant_id: b.tenantId, reason: 'motivo válido 1' });
    const res = await supertest(app.server)
      .post('/inter-tenant-chat/reports')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ reported_tenant_id: b.tenantId, reason: 'motivo válido 2' });
    expect(res.status).toBe(409);
  });
});

describe('GET /inter-tenant-chat/reports', () => {
  it('lista denúncias do reporter', async () => {
    const a = await fixtures.createTenantWithAdmin(app);
    const b = await fixtures.createTenantWithAdmin(app);
    await supertest(app.server)
      .post('/inter-tenant-chat/reports')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ reported_tenant_id: b.tenantId, reason: 'motivo válido' });
    const res = await supertest(app.server)
      .get('/inter-tenant-chat/reports')
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThanOrEqual(1);
    expect(res.body.results[0].reported_tenant_id).toBe(b.tenantId);
  });
});

describe('Suspensão por denúncias', () => {
  it('tenant com 3+ reporters distintos pendentes é suspenso em POST /messages', async () => {
    const { a, b, conversationId } = await fixtures.createConversedPair(app);
    const pool = fixtures.getPool();
    // cria 3 reporters distintos denunciando b
    for (let i = 0; i < 3; i++) {
      const reporter = await fixtures.createTenantWithAdmin(app);
      await pool.query(
        `INSERT INTO tenant_chat_reports (reporter_tenant_id, reported_tenant_id, reason, status, created_by_user_id)
         VALUES ($1, $2, 'abuso detectado', 'pending', $3)`,
        [reporter.tenantId, b.tenantId, reporter.userId]
      );
    }
    // b tenta enviar mensagem → bloqueado
    const res = await supertest(app.server)
      .post(`/inter-tenant-chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ body: 'tentativa' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspensa/i);
  });

  it('tenant com menos de 3 reporters NÃO é suspenso', async () => {
    const { a, b, conversationId } = await fixtures.createConversedPair(app);
    const pool = fixtures.getPool();
    for (let i = 0; i < 2; i++) {
      const reporter = await fixtures.createTenantWithAdmin(app);
      await pool.query(
        `INSERT INTO tenant_chat_reports (reporter_tenant_id, reported_tenant_id, reason, status, created_by_user_id)
         VALUES ($1, $2, 'abuso', 'pending', $3)`,
        [reporter.tenantId, b.tenantId, reporter.userId]
      );
    }
    const res = await supertest(app.server)
      .post(`/inter-tenant-chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ body: 'ok' });
    expect(res.status).toBe(201);
  });
});
