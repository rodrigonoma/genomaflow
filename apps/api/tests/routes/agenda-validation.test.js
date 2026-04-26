'use strict';
/**
 * Validation tests pra /agenda — paths que rodam ANTES de qualquer DB op.
 *
 * Cobre:
 *  - Validators puros (validateBusinessHours, validateAppointmentBody, isHHMM)
 *  - Auth gate em todos endpoints
 *  - Body validation strict (settings + appointments)
 */

const Fastify = require('fastify');

const { _internals: { validateBusinessHours, validateAppointmentBody, isHHMM } } =
  require('../../src/routes/agenda');

// ── Validators puros ────────────────────────────────────────────────

describe('agenda — isHHMM', () => {
  test.each(['00:00', '09:30', '23:59', '14:00'])('aceita %s', (s) => {
    expect(isHHMM(s)).toBe(true);
  });
  test.each(['24:00', '9:30', '09:60', '09:30:00', '', null, undefined, 1230])('rejeita %j', (s) => {
    expect(isHHMM(s)).toBe(false);
  });
});

describe('agenda — validateBusinessHours', () => {
  const validBh = {
    mon: [['09:00', '12:00'], ['14:00', '18:00']],
    tue: [['09:00', '17:00']],
    wed: [], thu: [], fri: [], sat: [], sun: [],
  };

  test('aceita estrutura válida', () => {
    expect(validateBusinessHours(validBh)).toBeNull();
  });

  test('rejeita não-objeto', () => {
    expect(validateBusinessHours(null)).toBeTruthy();
    expect(validateBusinessHours([])).toBeTruthy();
    expect(validateBusinessHours('string')).toBeTruthy();
  });

  test('rejeita dia faltando', () => {
    const bh = { ...validBh };
    delete bh.sat;
    expect(validateBusinessHours(bh)).toMatch(/sat/);
  });

  test('rejeita window com formato inválido', () => {
    expect(validateBusinessHours({ ...validBh, mon: [['9:00', '12:00']] })).toMatch(/mon/);
    expect(validateBusinessHours({ ...validBh, mon: [['09:00']] })).toMatch(/mon/);
    expect(validateBusinessHours({ ...validBh, mon: [['09:00', 'noon']] })).toMatch(/mon/);
  });

  test('rejeita start >= end', () => {
    expect(validateBusinessHours({ ...validBh, mon: [['12:00', '09:00']] })).toMatch(/start.*end/);
    expect(validateBusinessHours({ ...validBh, mon: [['09:00', '09:00']] })).toMatch(/start.*end/);
  });
});

describe('agenda — validateAppointmentBody', () => {
  const valid = {
    start_at: '2030-06-01T10:00:00Z',
    duration_minutes: 30,
    status: 'scheduled',
    subject_id: '00000000-0000-0000-0000-000000000001',
  };

  test('aceita body válido', () => {
    expect(validateAppointmentBody(valid)).toBeNull();
  });

  test('rejeita start_at ausente', () => {
    const b = { ...valid }; delete b.start_at;
    expect(validateAppointmentBody(b)).toMatch(/start_at/);
  });

  test('rejeita start_at inválido', () => {
    expect(validateAppointmentBody({ ...valid, start_at: 'not-a-date' })).toMatch(/start_at/);
  });

  test('rejeita duration < 5 ou > 480', () => {
    expect(validateAppointmentBody({ ...valid, duration_minutes: 4 })).toMatch(/duration/);
    expect(validateAppointmentBody({ ...valid, duration_minutes: 481 })).toMatch(/duration/);
    expect(validateAppointmentBody({ ...valid, duration_minutes: 30.5 })).toMatch(/duration/);
  });

  test('rejeita status fora do enum', () => {
    expect(validateAppointmentBody({ ...valid, status: 'unknown' })).toMatch(/status/);
  });

  test('blocked sem reason rejeitado', () => {
    expect(validateAppointmentBody({ ...valid, status: 'blocked', subject_id: null }))
      .toMatch(/reason/);
  });

  test('blocked com subject_id rejeitado', () => {
    expect(validateAppointmentBody({ ...valid, status: 'blocked', reason: 'congresso' }))
      .toMatch(/blocked.*subject_id/);
  });

  test('scheduled sem subject_id rejeitado', () => {
    expect(validateAppointmentBody({ ...valid, subject_id: null }))
      .toMatch(/subject_id/);
  });

  test('confirmed sem subject_id rejeitado', () => {
    expect(validateAppointmentBody({ ...valid, status: 'confirmed', subject_id: null }))
      .toMatch(/subject_id/);
  });

  test('completed sem subject_id aceito (atendimento histórico)', () => {
    // Completed não exige subject_id porque pode ser registro manual de atendimento passado
    // (decisão V1: validador só rigoroso pra scheduled/confirmed)
    expect(validateAppointmentBody({ ...valid, status: 'completed', subject_id: null }))
      .toBeNull();
  });

  test('isUpdate=true permite campos parciais', () => {
    expect(validateAppointmentBody({ status: 'completed' }, true)).toBeNull();
    expect(validateAppointmentBody({ duration_minutes: 60 }, true)).toBeNull();
  });

  test('isUpdate=true ainda valida duration range', () => {
    expect(validateAppointmentBody({ duration_minutes: 4 }, true)).toMatch(/duration/);
  });
});

// ── Auth + body validation via Fastify isolado ─────────────────────

function buildApp(role = 'admin') {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async function (request, reply) {
    const r = request.headers['x-test-role'];
    if (!r) return reply.status(401).send({ error: 'no auth' });
    request.user = {
      user_id: '00000000-0000-0000-0000-000000000099',
      tenant_id: '00000000-0000-0000-0000-000000000099',
      role: r,
      module: 'human',
    };
  });
  app.decorate('pg', {
    query: jest.fn(async () => ({ rows: [] })),
    connect: jest.fn(async () => ({
      query: jest.fn(async () => ({ rows: [{}] })),
      release: jest.fn(),
    })),
  });
  app.decorate('redis', { publish: jest.fn(async () => 1) });
  return app;
}

async function makeApp() {
  const app = buildApp();
  await app.register(require('../../src/routes/agenda'), { prefix: '/agenda' });
  await app.ready();
  return app;
}

describe('agenda — auth gate', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  test.each([
    ['GET',    '/agenda/settings'],
    ['PUT',    '/agenda/settings'],
    ['GET',    '/agenda/appointments'],
    ['POST',   '/agenda/appointments'],
    ['PATCH',  '/agenda/appointments/abc'],
    ['POST',   '/agenda/appointments/abc/cancel'],
    ['DELETE', '/agenda/appointments/abc'],
    ['GET',    '/agenda/appointments/free-slots?date=2030-01-01'],
  ])('%s %s sem auth → 401', async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(401);
  });
});

describe('agenda — PUT /settings validation', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  const put = (payload) => app.inject({
    method: 'PUT',
    url: '/agenda/settings',
    headers: { 'x-test-role': 'admin' },
    payload,
  });

  test('default_slot_minutes fora da whitelist → 400', async () => {
    const res = await put({ default_slot_minutes: 35, business_hours: {
      mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: []
    } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/default_slot_minutes/);
  });

  test('default_slot_minutes=20 (deprecated, fora da lista) → 400', async () => {
    const res = await put({ default_slot_minutes: 20, business_hours: {
      mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: []
    } });
    expect(res.statusCode).toBe(400);
  });

  test.each([30, 45, 60, 75, 90, 105, 120])('default_slot_minutes=%i aceito', async (minutes) => {
    const res = await put({ default_slot_minutes: minutes, business_hours: {
      mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: []
    } });
    expect(res.json().error || '').not.toMatch(/default_slot_minutes/);
  });

  test('business_hours malformado → 400', async () => {
    const res = await put({ default_slot_minutes: 30, business_hours: { mon: 'invalid' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('agenda — POST /appointments validation', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  const post = (payload) => app.inject({
    method: 'POST',
    url: '/agenda/appointments',
    headers: { 'x-test-role': 'admin' },
    payload,
  });

  test('body vazio → 400', async () => {
    const res = await post({});
    expect(res.statusCode).toBe(400);
  });

  test('status=blocked sem reason → 400', async () => {
    const res = await post({
      start_at: '2030-06-01T10:00:00Z',
      duration_minutes: 60,
      status: 'blocked',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/reason/);
  });

  test('status=scheduled sem subject_id → 400', async () => {
    const res = await post({
      start_at: '2030-06-01T10:00:00Z',
      duration_minutes: 30,
      status: 'scheduled',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject_id/);
  });

  test('duration > 480 → 400', async () => {
    const res = await post({
      start_at: '2030-06-01T10:00:00Z',
      duration_minutes: 500,
      status: 'scheduled',
      subject_id: 'abc',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/duration/);
  });
});

describe('agenda — GET /appointments query validation', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  test('range > 90 dias → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/agenda/appointments?from=2030-01-01T00:00:00Z&to=2030-12-31T00:00:00Z',
      headers: { 'x-test-role': 'admin' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/90/);
  });

  test('to <= from → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/agenda/appointments?from=2030-06-01T00:00:00Z&to=2030-05-01T00:00:00Z',
      headers: { 'x-test-role': 'admin' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('agenda — GET /appointments/free-slots validation', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  test('sem date → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/agenda/appointments/free-slots',
      headers: { 'x-test-role': 'admin' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('date com formato errado → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/agenda/appointments/free-slots?date=01/01/2030',
      headers: { 'x-test-role': 'admin' },
    });
    expect(res.statusCode).toBe(400);
  });
});
