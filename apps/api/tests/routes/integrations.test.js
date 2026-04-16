'use strict';

const supertest = require('supertest');
const app = require('../../src/server');
const { setupTestDb, teardownTestDb } = require('../setup');

let token;
let connectorId;

beforeAll(async () => {
  await app.ready();
  await setupTestDb();

  // Login
  const loginRes = await supertest(app.server)
    .post('/auth/login')
    .send({ email: 'test@clinic.com', password: 'password123' });
  token = loginRes.body.token;

  // Seed a connector for tests that need one
  const createRes = await supertest(app.server)
    .post('/integrations')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Tasy Test',
      mode: 'swagger',
      config: { swagger_url: 'https://petstore.swagger.io/v2/swagger.json' },
      field_map: { 'patient.name': '$.name', 'patient.birth_date': '$.birth_date' }
    });
  connectorId = createRes.body.id;
});

afterAll(async () => {
  await teardownTestDb();
  await app.close();
});

describe('POST /integrations', () => {
  it('creates a swagger connector', async () => {
    const res = await supertest(app.server)
      .post('/integrations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Second Connector', mode: 'swagger' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Second Connector');
    expect(res.body.status).toBe('inactive');
  });

  it('rejects invalid mode', async () => {
    const res = await supertest(app.server)
      .post('/integrations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad', mode: 'fax' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mode/);
  });

  it('rejects missing name', async () => {
    const res = await supertest(app.server)
      .post('/integrations')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'swagger' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  it('returns 401 without token', async () => {
    const res = await supertest(app.server)
      .post('/integrations')
      .send({ name: 'X', mode: 'swagger' });
    expect(res.status).toBe(401);
  });
});

describe('GET /integrations', () => {
  it('returns connector list', async () => {
    const res = await supertest(app.server)
      .get('/integrations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // The connector seeded in beforeAll must be present
    const seeded = res.body.find(c => c.id === connectorId);
    expect(seeded).toBeDefined();
    expect(seeded.name).toBe('Tasy Test');
  });

  it('returns 401 without token', async () => {
    const res = await supertest(app.server).get('/integrations');
    expect(res.status).toBe(401);
  });
});

describe('GET /integrations/:id', () => {
  it('returns connector by id', async () => {
    const res = await supertest(app.server)
      .get(`/integrations/${connectorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(connectorId);
    expect(res.body.name).toBe('Tasy Test');
  });

  it('returns 404 for unknown id', async () => {
    const res = await supertest(app.server)
      .get('/integrations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /integrations/:id', () => {
  it('updates connector name', async () => {
    const res = await supertest(app.server)
      .put(`/integrations/${connectorId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Tasy Updated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Tasy Updated');
  });

  it('activates connector', async () => {
    const res = await supertest(app.server)
      .put(`/integrations/${connectorId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it('rejects invalid status', async () => {
    const res = await supertest(app.server)
      .put(`/integrations/${connectorId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'flying' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status/);
  });

  it('returns 401 without token', async () => {
    const res = await supertest(app.server)
      .put(`/integrations/${connectorId}`)
      .send({ name: 'Hack' });
    expect(res.status).toBe(401);
  });
});

describe('GET /integrations/:id/logs', () => {
  it('returns logs array for connector', async () => {
    const res = await supertest(app.server)
      .get(`/integrations/${connectorId}/logs`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 404 for unknown connector', async () => {
    const res = await supertest(app.server)
      .get('/integrations/00000000-0000-0000-0000-000000000000/logs')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 401 without token', async () => {
    const res = await supertest(app.server)
      .get(`/integrations/${connectorId}/logs`);
    expect(res.status).toBe(401);
  });
});

describe('POST /integrations/swagger/parse', () => {
  it('rejects missing url', async () => {
    const res = await supertest(app.server)
      .post('/integrations/swagger/parse')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/);
  });

  it('rejects private IP (SSRF protection)', async () => {
    const res = await supertest(app.server)
      .post('/integrations/swagger/parse')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'http://127.0.0.1/spec.json' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/loopback|Private/i);
  });

  // No positive test here: hitting external network (petstore.swagger.io) is
  // intentionally omitted from unit/integration tests to avoid network dependency.
});

describe('DELETE /integrations/:id', () => {
  it('returns 401 without token', async () => {
    const res = await supertest(app.server)
      .delete(`/integrations/${connectorId}`);
    expect(res.status).toBe(401);
  });

  it('deletes connector', async () => {
    const res = await supertest(app.server)
      .delete(`/integrations/${connectorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 after deletion', async () => {
    const res = await supertest(app.server)
      .get(`/integrations/${connectorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
