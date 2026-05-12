'use strict';
/**
 * Tests pra POST /agenda/appointments/series
 *
 * Cobre:
 *  1. count=4 interval=30 cria 4 rows com start_at espaçados de 30 dias
 *  2. count < 2 → 400
 *  3. count > 20 → 400
 *  4. interval_days inválido → 400
 *  5. subject_id ausente → 400
 *  6. Rollback chamado em mid-insert throw → 500
 *  7. Auth gate → 401 sem token
 *
 * Padrão isolado: Fastify sem DB real (mock pg.connect).
 */

const Fastify = require('fastify');

// ── Helpers ──────────────────────────────────────────────────────────

const TENANT_ID  = '00000000-0000-0000-0000-000000000099';
const USER_ID    = '00000000-0000-0000-0000-000000000088';
const SUBJECT_ID = '00000000-0000-0000-0000-000000000077';
const START_AT   = '2030-06-01T09:00:00.000Z';

function makeClient({ insertFail = false, subjectNotFound = false, rowsPerInsert = null } = {}) {
  let insertCount = 0;
  const client = {
    query: jest.fn(async (sql, params) => {
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('SET LOCAL')) {
        return { rows: [] };
      }
      // Subject validation
      if (sql.includes('FROM subjects')) {
        return { rows: subjectNotFound ? [] : [{ id: SUBJECT_ID }] };
      }
      // INSERT appointments
      if (sql.includes('INSERT INTO appointments')) {
        insertCount++;
        if (insertFail && insertCount >= 3) {
          const err = new Error('forced insert failure');
          throw err;
        }
        const row = rowsPerInsert ? rowsPerInsert[insertCount - 1] : {
          id: `apt-${insertCount}`,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          subject_id: SUBJECT_ID,
          series_id: null,
          start_at: params[3],
          duration_minutes: params[4],
          status: 'scheduled',
          appointment_type: params[5],
          reason: null,
          notes: null,
          created_by: USER_ID,
          created_at: '2030-01-01T00:00:00Z',
          updated_at: '2030-01-01T00:00:00Z',
          cancelled_at: null,
        };
        return { rows: [row] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  return client;
}

function buildApp({ client } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async function (request, reply) {
    const role = request.headers['x-test-role'];
    if (!role) return reply.status(401).send({ error: 'no auth' });
    request.user = { user_id: USER_ID, tenant_id: TENANT_ID, role, module: 'estetica' };
  });

  const mockClient = client || makeClient();
  app.decorate('pg', {
    query: jest.fn(async () => ({ rows: [] })),
    connect: jest.fn(async () => mockClient),
  });
  app.decorate('redis', { publish: jest.fn(async () => 1) });
  return app;
}

async function makeApp(opts = {}) {
  const app = buildApp(opts);
  await app.register(require('../../src/routes/agenda'), { prefix: '/agenda' });
  await app.ready();
  return app;
}

const validBody = {
  start_at: START_AT,
  duration_minutes: 60,
  count: 4,
  interval_days: 30,
  subject_id: SUBJECT_ID,
  appointment_type: 'procedimento',
};

// ── Test suite ────────────────────────────────────────────────────────

describe('POST /agenda/appointments/series — auth gate', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  test('sem auth → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agenda/appointments/series',
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /agenda/appointments/series — validação de count', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  const post = (payload) => app.inject({
    method: 'POST',
    url: '/agenda/appointments/series',
    headers: { 'x-test-role': 'admin' },
    payload,
  });

  test('count = 1 → 400', async () => {
    const res = await post({ ...validBody, count: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/count/);
  });

  test('count = 21 → 400', async () => {
    const res = await post({ ...validBody, count: 21 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/count/);
  });

  test('count = 0 → 400', async () => {
    const res = await post({ ...validBody, count: 0 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/count/);
  });

  test('count ausente → 400', async () => {
    const { count, ...rest } = validBody;
    const res = await post(rest);
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /agenda/appointments/series — validação de interval_days', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  const post = (payload) => app.inject({
    method: 'POST',
    url: '/agenda/appointments/series',
    headers: { 'x-test-role': 'admin' },
    payload,
  });

  test('interval_days = 0 → 400', async () => {
    const res = await post({ ...validBody, interval_days: 0 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/interval_days/);
  });

  test('interval_days = 366 → 400', async () => {
    const res = await post({ ...validBody, interval_days: 366 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/interval_days/);
  });

  test('interval_days = 365 → aceito (limite superior válido)', async () => {
    const res = await post({ ...validBody, interval_days: 365 });
    expect(res.statusCode).toBe(201);
  });

  test('interval_days = 1 → aceito (limite inferior válido)', async () => {
    const res = await post({ ...validBody, interval_days: 1 });
    expect(res.statusCode).toBe(201);
  });
});

describe('POST /agenda/appointments/series — cria N agendamentos espaçados', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  test('count=4 interval=30 retorna 4 agendamentos com start_at espaçados de 30 dias', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agenda/appointments/series',
      headers: { 'x-test-role': 'admin' },
      payload: { ...validBody, count: 4, interval_days: 30 },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.count).toBe(4);
    expect(body.appointments).toHaveLength(4);

    // Verifica espaçamento — cada appointment deve ter start_at separado por 30 dias
    const dates = body.appointments.map((a) => new Date(a.start_at).getTime());
    const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] - dates[i - 1]).toBe(MS_30_DAYS);
    }
  });

  test('count=2 interval=7 retorna 2 agendamentos', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agenda/appointments/series',
      headers: { 'x-test-role': 'admin' },
      payload: { ...validBody, count: 2, interval_days: 7 },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.count).toBe(2);
    expect(body.appointments).toHaveLength(2);

    const MS_7_DAYS = 7 * 24 * 60 * 60 * 1000;
    const t0 = new Date(body.appointments[0].start_at).getTime();
    const t1 = new Date(body.appointments[1].start_at).getTime();
    expect(t1 - t0).toBe(MS_7_DAYS);
  });

  test('count=20 (máximo) é aceito', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agenda/appointments/series',
      headers: { 'x-test-role': 'admin' },
      payload: { ...validBody, count: 20, interval_days: 14 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().count).toBe(20);
  });
});

describe('POST /agenda/appointments/series — validação de subject_id', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  test('subject_id ausente → 400', async () => {
    const { subject_id, ...rest } = validBody;
    const res = await app.inject({
      method: 'POST',
      url: '/agenda/appointments/series',
      headers: { 'x-test-role': 'admin' },
      payload: rest,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject_id/);
  });

  test('subject_id não pertence ao tenant → 400', async () => {
    const clientSubjectNotFound = makeClient({ subjectNotFound: true });
    const localApp = await makeApp({ client: clientSubjectNotFound });

    const res = await localApp.inject({
      method: 'POST',
      url: '/agenda/appointments/series',
      headers: { 'x-test-role': 'admin' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject_id/);
    await localApp.close();
  });
});

describe('POST /agenda/appointments/series — rollback em falha mid-insert', () => {
  test('lança erro no 3º insert → rollback chamado, retorna 500', async () => {
    const failClient = makeClient({ insertFail: true });
    const app = await makeApp({ client: failClient });

    const res = await app.inject({
      method: 'POST',
      url: '/agenda/appointments/series',
      headers: { 'x-test-role': 'admin' },
      payload: { ...validBody, count: 4, interval_days: 14 },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('SERIES_CREATION_FAILED');

    // Verifica que ROLLBACK foi chamado
    const calls = failClient.query.mock.calls.map(([sql]) => sql.trim());
    expect(calls).toContain('ROLLBACK');
    await app.close();
  });
});
