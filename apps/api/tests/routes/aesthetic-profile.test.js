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

// Histórico de audit_log para uso nos mocks de history
const HISTORY_ROWS = [
  {
    id: 'a1',
    action: 'update',
    actor_user_id: 'u1',
    actor_channel: 'ui',
    changed_fields: ['aesthetic_profile'],
    created_at: '2026-05-11T10:00:00.000Z',
    aesthetic_profile_after: { height_cm: 165, weight_kg: 65 },
    aesthetic_profile_before: { height_cm: 165, weight_kg: 62 },
    actor_email: 'profissional@clinica.com',
  },
];

async function buildApp({
  role = 'admin',
  module: mod = 'estetica',
  mockRows = null,
  mockUpdateRows = null,
  mockHistorySubjectRows = null,
  mockHistoryRows = null,
} = {}) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module: mod };
  });
  app.decorate('pg', {
    connect: jest.fn(async function () { return app.pg; }),
    query: jest.fn(async (sql, params) => {
      if (/SELECT aesthetic_profile/i.test(sql) && /FROM subjects/i.test(sql)) {
        if (mockRows !== null) return { rows: mockRows };
        // default: subject found with full profile + sex/birth_date/weight/height
        return { rows: [{
          aesthetic_profile: FULL_PROFILE,
          sex: 'F',
          birth_date: '1996-01-01',
          weight: null,
          height: null,
        }] };
      }
      if (/UPDATE subjects SET aesthetic_profile/i.test(sql)) {
        if (mockUpdateRows !== null) return { rows: mockUpdateRows };
        // default: subject found — echo back the profile we received
        const profileArg = JSON.parse(params[0]);
        return { rows: [{ id: params[1], aesthetic_profile: profileArg }] };
      }
      // History endpoint: subject existence check
      if (/SELECT id FROM subjects WHERE id/i.test(sql)) {
        if (mockHistorySubjectRows !== null) return { rows: mockHistorySubjectRows };
        return { rows: [{ id: params[0] }] };
      }
      // History endpoint: audit_log query
      if (/FROM audit_log a/i.test(sql)) {
        if (mockHistoryRows !== null) return { rows: mockHistoryRows };
        return { rows: HISTORY_ROWS };
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
    const app = await buildApp({ mockRows: [{ aesthetic_profile: {}, sex: null, birth_date: null, weight: null, height: null }] });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/profile/sub1' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile).toEqual({});
    expect(body.computed).toBeNull();
  });

  test('200 profile vazio + subject com height/weight/sex/birth_date → hidrata defaults', async () => {
    const app = await buildApp({ mockRows: [{
      aesthetic_profile: {},
      sex: 'F',
      birth_date: '1990-05-15',
      weight: '65.5',
      height: '165',
    }] });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/profile/sub1' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile.height_cm).toBe(165);
    expect(body.profile.weight_kg).toBe(65.5);
    expect(body.profile.sex).toBe('F');
    expect(body.profile.age).toBeGreaterThanOrEqual(35); // 1990 → 2026+
  });

  test('200 aesthetic_profile preenchido tem precedência sobre subject', async () => {
    const app = await buildApp({ mockRows: [{
      aesthetic_profile: { height_cm: 170, weight_kg: 70, age: 40, sex: 'M' },
      sex: 'F',          // conflito intencional
      birth_date: '1990-01-01',
      weight: '60',
      height: '160',
    }] });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/profile/sub1' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile.height_cm).toBe(170);
    expect(body.profile.weight_kg).toBe(70);
    expect(body.profile.age).toBe(40);
    expect(body.profile.sex).toBe('M');
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

// ─── PUT /aesthetic/profile — extreme ranges (TODO#13) ────────────────────────

describe('PUT /aesthetic/profile — extreme ranges', () => {
  test('400 weight_kg=30 sem flag (fora do range padrão 35-200)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { weight_kg: 30 },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/weight_kg.*35-200/i);
  });

  test('200 weight_kg=30 COM allow_extreme_ranges → persiste 30, warning PT-BR', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { weight_kg: 30, allow_extreme_ranges: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile.weight_kg).toBe(30);
    expect(body.profile.extreme_ranges_used).toBe(true);
    expect(body.warnings).toBeInstanceOf(Array);
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.warnings[0]).toMatch(/peso.*faixa.*padrão/i);
  });

  test('400 weight_kg=20 COM flag (fora do extreme range 25-300)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { weight_kg: 20, allow_extreme_ranges: true },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/weight_kg.*25-300/i);
  });

  test('200 weight_kg=70 COM flag → sem warning (peso dentro da faixa padrão)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { weight_kg: 70, allow_extreme_ranges: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile.weight_kg).toBe(70);
    expect(body.profile.extreme_ranges_used).toBe(true);
    expect(body.warnings).toEqual([]);
  });

  test('200 age=8 COM flag → warning de idade', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { age: 8, allow_extreme_ranges: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile.age).toBe(8);
    expect(body.warnings.some(w => /idade.*faixa.*padrão/i.test(w))).toBe(true);
  });

  test('200 height_cm=120 COM flag → warning de altura', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { height_cm: 120, allow_extreme_ranges: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile.height_cm).toBe(120);
    expect(body.warnings.some(w => /altura.*faixa.*padrão/i.test(w))).toBe(true);
  });

  test('400 height_cm=120 SEM flag (fora do range padrão 140-220)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { height_cm: 120 },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/height_cm.*140-220/i);
  });

  test('200 sem flag → warnings array vazio na resposta', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aesthetic/profile/sub1',
      payload: { sex: 'F', height_cm: 165, weight_kg: 65, age: 30 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.warnings).toEqual([]);
    expect(body.profile.extreme_ranges_used).toBeUndefined();
  });
});

// ─── GET /aesthetic/profile/:subject_id/history ───────────────────────────────

describe('GET /aesthetic/profile/:subject_id/history', () => {
  test('200 retorna items quando subject pertence ao tenant', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/aesthetic/profile/sub1/history',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toBeInstanceOf(Array);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0].action).toBe('update');
    expect(body.items[0].actor_email).toBe('profissional@clinica.com');
    expect(body.items[0].aesthetic_profile_after).toBeDefined();
    expect(body.items[0].aesthetic_profile_before).toBeDefined();
  });

  test('404 quando subject não pertence ao tenant (ou não existe)', async () => {
    const app = await buildApp({ mockHistorySubjectRows: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/api/aesthetic/profile/no-exist/history',
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toMatch(/não encontrado/i);
  });

  test('403 quando module !== estetica', async () => {
    const app = await buildApp({ module: 'human' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/aesthetic/profile/sub1/history',
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/estetica/i);
  });

  test('200 retorna lista vazia quando sem entradas no audit_log para aesthetic_profile', async () => {
    const app = await buildApp({ mockHistoryRows: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/api/aesthetic/profile/sub1/history',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toEqual([]);
  });
});

// Source inspection — prevenção de regressão para bug 2026-05-12:
// UPDATE original incluía `updated_at = NOW()` mas tabela `subjects` (migration 003)
// não tem coluna updated_at — só created_at. Em prod, query falhava com
// 'column updated_at does not exist' → 500. Tests mockam pg.query e não pegam.
describe('aesthetic-profile.js update() SQL — regression guard (2026-05-12)', () => {
  const fs = require('fs');
  const path = require('path');
  const SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'services', 'aesthetic-profile.js'),
    'utf8'
  );

  test('UPDATE NÃO referencia coluna updated_at em subjects', () => {
    // subjects.updated_at NÃO existe — updated_at vai dentro do JSONB
    expect(SOURCE).not.toMatch(/UPDATE subjects[\s\S]*?updated_at\s*=\s*NOW\(\)/);
  });

  test('updated_at é gravado dentro do JSONB aesthetic_profile', () => {
    // Persiste timestamp dentro do JSONB pra UI mostrar última edição
    expect(SOURCE).toMatch(/enriched\s*=\s*\{[\s\S]*?updated_at:/);
  });

  test('JSONB cast explícito $1::jsonb', () => {
    // Postgres JSONB columns precisam de cast quando o param é string JSON
    expect(SOURCE).toMatch(/aesthetic_profile\s*=\s*\$1::jsonb/);
  });
});
