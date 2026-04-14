const supertest = require('supertest');
const app = require('../../src/server');
const { setupTestDb, teardownTestDb } = require('../setup');

beforeAll(async () => { await app.ready(); await setupTestDb(); });
afterAll(async () => { await teardownTestDb(); await app.close(); });

describe('POST /auth/login', () => {
  it('returns JWT for valid credentials', async () => {
    const res = await supertest(app.server)
      .post('/auth/login')
      .send({ email: 'test@clinic.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
  });

  it('returns 401 for wrong password', async () => {
    const res = await supertest(app.server)
      .post('/auth/login')
      .send({ email: 'test@clinic.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for unknown email', async () => {
    const res = await supertest(app.server)
      .post('/auth/login')
      .send({ email: 'nobody@test.com', password: 'password123' });
    expect(res.status).toBe(401);
  });
});
