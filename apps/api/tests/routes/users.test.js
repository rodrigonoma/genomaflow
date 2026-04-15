const supertest = require('supertest');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const app = require('../../src/server');
const { setupTestDb, teardownTestDb } = require('../setup');

let adminToken, doctorToken, tenantId;

beforeAll(async () => {
  await app.ready();
  const result = await setupTestDb();
  tenantId = result.tenantId;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
  const hash = await bcrypt.hash('admin123', 10);
  await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
    [tenantId, 'admin@clinic.com', hash]
  );
  await pool.end();

  const adminRes = await supertest(app.server)
    .post('/auth/login').send({ email: 'admin@clinic.com', password: 'admin123' });
  adminToken = adminRes.body.token;

  const docRes = await supertest(app.server)
    .post('/auth/login').send({ email: 'test@clinic.com', password: 'password123' });
  doctorToken = docRes.body.token;
});

describe('auth required', () => {
  it('returns 401 for unauthenticated GET', async () => {
    const res = await supertest(app.server).get('/users');
    expect(res.status).toBe(401);
  });

  it('returns 401 for unauthenticated POST', async () => {
    const res = await supertest(app.server).post('/users')
      .send({ email: 'x@y.com', password: 'pass', role: 'doctor' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for unauthenticated DELETE', async () => {
    const res = await supertest(app.server)
      .delete('/users/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(401);
  });
});

afterAll(async () => { await teardownTestDb(); await app.close(); });

describe('GET /users', () => {
  it('returns users list for admin', async () => {
    const res = await supertest(app.server)
      .get('/users').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 403 for non-admin', async () => {
    const res = await supertest(app.server)
      .get('/users').set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /users', () => {
  it('creates a user as admin', async () => {
    const res = await supertest(app.server)
      .post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'newdoc@clinic.com', password: 'pass123', role: 'doctor' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('newdoc@clinic.com');
    expect(res.body.role).toBe('doctor');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  it('returns 403 for non-admin', async () => {
    const res = await supertest(app.server)
      .post('/users').set('Authorization', `Bearer ${doctorToken}`)
      .send({ email: 'x@clinic.com', password: 'pass', role: 'doctor' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid role', async () => {
    const res = await supertest(app.server)
      .post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'y@clinic.com', password: 'pass', role: 'superuser' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /users/:id', () => {
  it('deletes a user as admin', async () => {
    const created = await supertest(app.server)
      .post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'todel@clinic.com', password: 'pass123', role: 'lab_tech' });

    const res = await supertest(app.server)
      .delete(`/users/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 for unknown user', async () => {
    const res = await supertest(app.server)
      .delete('/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
