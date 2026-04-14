const supertest = require('supertest');
const app = require('../../src/server');
const { setupTestDb, teardownTestDb } = require('../setup');

let token;

beforeAll(async () => {
  await app.ready();
  await setupTestDb();
  const res = await supertest(app.server)
    .post('/auth/login')
    .send({ email: 'test@clinic.com', password: 'password123' });
  token = res.body.token;
});

afterAll(async () => { await teardownTestDb(); await app.close(); });

describe('GET /alerts', () => {
  it('returns an array for authenticated tenant', async () => {
    const res = await supertest(app.server)
      .get('/alerts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 401 without token', async () => {
    const res = await supertest(app.server).get('/alerts');
    expect(res.status).toBe(401);
  });
});
