'use strict';

const { describe, test, expect } = require('@jest/globals');
const Fastify = require('fastify');

jest.mock('../../src/db/tenant', () => ({
  withTenant: jest.fn((pg, tid, fn, opts) => fn(pg)),
}));

// Perfil preenchido para uso nos mocks
const FULL_PROFILE = {
  height_cm: 165,
  weight_kg: 65,
  age: 30,
  sex: 'F',
  activity_level: 'moderate',
  goals: ['fat_loss'],
  allergies: [],
  medical_conditions: [],
  dietary_restrictions: ['vegan'],
  updated_at: '2026-05-11T00:00:00.000Z',
};

async function buildApp({ role = 'admin', module: mod = 'estetica', mockRows = null, mockUpdateRows = null } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module: mod };
  });
  app.decorate('pg', {
    connect: jest.fn(async function () { return app.pg; }),
    query: jest.fn(async (sql, params) => {
      if (/SELECT aesthetic_profile FROM subjects/i.test(sql)) {
        if (mockRows !== null) return { rows: mockRows };
        // default: subject found with full profile
        return { rows: [{ aesthetic_profile: FULL_PROFILE }] };
      }
      if (/UPDATE subjects SET aesthetic_profile/i.test(sql)) {
        if (mockUpdateRows !== null) return { rows: mockUpdateRows };
        // default: subject found — echo back the profile we received
        const profileArg = JSON.parse(params[0]);
        return { rows: [{ id: params[1], aesthetic_profile: profileArg }] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  });
  app.register(require('../../src/routes/aesthetic-profile'), { prefix: '/api/aesthetic' });
  return app;
}

// ─── GET /aesthetic/profile/:subject_id ───────────────────────────────────────

describe('GET /aesthetic/profile/:subject_id', () => {
  test('200 com profile preenchido + computed não-null', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/profile/sub1' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile).toMatchObject({ height_cm: 165, sex: 'F' });
    expect(body.computed).not.toBeNull();
    expect(body.computed.tmb).toBeGreaterThan(0);
    expect(body.computed.calories).toBeGreaterThan(0);
    expect(body.computed.macros).toBeDefined();
  });

  test('200 com profile vazio → computed null', async () => {
    const app = await buildApp({ mockRows: [{ aesthetic_profile: {} }] });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/profile/sub1' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile).toEqual({});
    expect(body.computed).toBeNull();
  });

  test('404 paciente não existe (no rows)', async () => {
    const app = await buildApp({ mockRows: [] });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/profile/no-exist' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toMatch(/não encontrado/i);
  });

  test('403 módulo diferente de estetica', async () => {
    const app = await buildApp({ module: 'human' });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/profile/sub1' });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/estetica/i);
  });

  test('master role bypassa o gate de módulo (200)', async () => {
    const app = await buildApp({ role: 'master', module: 'human' });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/profile/sub1' });
    expect(res.statusCode).toBe(200);
  });
});

// ─── PUT /aesthetic/profile/:subject_id ───────────────────────────────────────

describe('PUT /aesthetic/profile/:subject_id', () => {
  test('200 atualiza perfil válido e retorna computed', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: {
        height_cm: 170,
        weight_kg: 70,
        age: 28,
        sex: 'M',
        activity_level: 'active',
        goals: ['mass'],
        allergies: ['amendoim'],
        medical_conditions: [],
        dietary_restrictions: ['none'],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile).toBeDefined();
    expect(body.computed).not.toBeNull();
    expect(body.computed.tmb).toBeGreaterThan(0);
  });

  test('400 height_cm inválido (string não-numérica)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { height_cm: 'abc' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/height_cm/i);
  });

  test('400 sex inválido', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { sex: 'X' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/sex/i);
  });

  test('400 goals não-array', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { goals: 'fat_loss' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/goals/i);
  });

  test('400 dietary_restrictions não-array', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { dietary_restrictions: 'vegan' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/dietary_restrictions/i);
  });

  test('404 paciente não existe (UPDATE retorna 0 rows)', async () => {
    const app = await buildApp({ mockUpdateRows: [] });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/no-exist',
      payload: { sex: 'F' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toMatch(/não encontrado/i);
  });

  test('200 campos extras são stripped e não persistidos', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: {
        sex: 'F',
        foo: 'bar',           // campo extra — deve ser ignorado
        injected_field: 999,  // campo extra — deve ser ignorado
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // profile retornado não deve conter campos extras
    expect(body.profile.foo).toBeUndefined();
    expect(body.profile.injected_field).toBeUndefined();
  });

  test('goals: valores inválidos são filtrados, válidos mantidos', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { goals: ['fat_loss', 'invalid_goal', 'wellness'] },
    });
    expect(res.statusCode).toBe(200);
    // Verificar que o payload enviado ao UPDATE não inclui 'invalid_goal'
    // O pg.query mock ecoa de volta params[0] (o JSON.stringify do profile)
    const body = JSON.parse(res.body);
    const persistedGoals = body.profile.goals;
    expect(persistedGoals).toContain('fat_loss');
    expect(persistedGoals).toContain('wellness');
    expect(persistedGoals).not.toContain('invalid_goal');
  });

  test('403 módulo diferente de estetica no PUT', async () => {
    const app = await buildApp({ module: 'veterinary' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { sex: 'F' },
    });
    expect(res.statusCode).toBe(403);
  });
});
