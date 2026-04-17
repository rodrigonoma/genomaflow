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

describe('POST /patients — human module', () => {
  it('creates a human subject with required fields', async () => {
    const res = await supertest(app.server)
      .post('/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'João Silva', birth_date: '1980-05-15', sex: 'M' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('João Silva');
    expect(res.body.subject_type).toBe('human');
  });

  it('returns 401 without token', async () => {
    const res = await supertest(app.server)
      .post('/patients')
      .send({ name: 'Ana', birth_date: '1990-01-01', sex: 'F' });
    expect(res.status).toBe(401);
  });
});

describe('GET /patients', () => {
  it('returns subjects for the tenant', async () => {
    const res = await supertest(app.server)
      .get('/patients')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /patients/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await supertest(app.server)
      .get('/patients/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
