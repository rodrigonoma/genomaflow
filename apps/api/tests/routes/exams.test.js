const supertest = require('supertest');
const path = require('path');
const fs = require('fs');
const app = require('../../src/server');
const { setupTestDb, teardownTestDb } = require('../setup');

let token;
let patientId;

beforeAll(async () => {
  await app.ready();
  await setupTestDb();

  const loginRes = await supertest(app.server)
    .post('/auth/login')
    .send({ email: 'test@clinic.com', password: 'password123' });
  token = loginRes.body.token;

  const patientRes = await supertest(app.server)
    .post('/patients')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Maria Teste', birth_date: '1975-03-20', sex: 'F' });
  patientId = patientRes.body.id;

  const fixturePath = path.join(__dirname, 'fixtures', 'test-exam.pdf');
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, '%PDF-1.4 Glicemia: 126 mg/dL');
});

describe('WS /exams/subscribe', () => {
  it('rejects subscribe without any token', async () => {
    const res = await supertest(app.server)
      .get('/exams/subscribe');
    // Without upgrade headers supertest treats WS as HTTP — expects 401 or 400
    expect([400, 401]).toContain(res.status);
  });
});

afterAll(async () => { await teardownTestDb(); await app.close(); });

describe('POST /exams', () => {
  it('uploads exam PDF and returns pending status', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'test-exam.pdf');
    const res = await supertest(app.server)
      .post('/exams')
      .set('Authorization', `Bearer ${token}`)
      .field('patient_id', patientId)
      .attach('file', fixturePath);

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('exam_id');
    expect(res.body.status).toBe('pending');
  });

  it('returns 401 without token', async () => {
    const res = await supertest(app.server).post('/exams');
    expect(res.status).toBe(401);
  });
});

describe('GET /exams/:id', () => {
  it('returns exam status and id', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'test-exam.pdf');
    const uploadRes = await supertest(app.server)
      .post('/exams')
      .set('Authorization', `Bearer ${token}`)
      .field('patient_id', patientId)
      .attach('file', fixturePath);

    const res = await supertest(app.server)
      .get(`/exams/${uploadRes.body.exam_id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(uploadRes.body.exam_id);
    expect(['pending', 'processing', 'done', 'error']).toContain(res.body.status);
  });

  it('returns 404 for unknown exam', async () => {
    const res = await supertest(app.server)
      .get('/exams/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
