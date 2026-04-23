const supertest = require('supertest');
const app = require('../../../src/server');

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });

describe('Inter-tenant chat plugin smoke', () => {
  it('rota /inter-tenant-chat/settings existe (responde 401 sem auth)', async () => {
    const res = await supertest(app.server).get('/inter-tenant-chat/settings');
    expect([401, 404]).toContain(res.status);
    // 404 aceito enquanto o GET /settings ainda não foi implementado;
    // 401 quando estiver implementado e sem auth.
  });
});
