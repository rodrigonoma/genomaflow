'use strict';

const { describe, test, expect } = require('@jest/globals');
const Fastify = require('fastify');

jest.mock('../../src/db/tenant', () => ({
  withTenant: jest.fn((pg, tid, fn, opts) => fn(pg)),
}));

async function buildApp({ role = 'admin', module = 'estetica' } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module };
  });
  app.decorate('pg', {
    connect: jest.fn(async () => app.pg),
    query: jest.fn(async (sql, params) => {
      if (/SELECT[\s\S]*FROM aesthetic_treatments/i.test(sql)) {
        return {
          rows: [
            {
              id: 'tx1', tenant_id: null, name: 'Criolipólise', category: 'corpo_modelagem',
              indications: ['gordura_localizada'], contraindications: [],
              typical_sessions: 1, interval_days: 90,
              cost_estimate_brl_min: 800, cost_estimate_brl_max: 2000,
              evidence_level: 'A', description: null, protocol_notes: null,
              requires_medico: false, usage_count_30d: 5,
              created_at: '2026-05-01', updated_at: '2026-05-01',
            },
          ],
        };
      }
      if (/INSERT INTO aesthetic_treatments/i.test(sql)) {
        return {
          rows: [
            {
              id: 'tx-new', tenant_id: 't1', name: params[1], category: params[2],
              indications: params[3], contraindications: params[4],
              typical_sessions: params[5], interval_days: params[6],
              cost_estimate_brl_min: params[7], cost_estimate_brl_max: params[8],
              evidence_level: params[9], description: params[10],
              protocol_notes: params[11], requires_medico: params[12],
              usage_count_30d: 0, created_at: '2026-05-11', updated_at: '2026-05-11',
            },
          ],
        };
      }
      if (/UPDATE aesthetic_treatments SET\s+name/i.test(sql)) {
        if (params[0] === 'tx-exists') {
          return { rows: [{ id: 'tx-exists', tenant_id: 't1', name: 'Updated' }] };
        }
        return { rows: [] };
      }
      if (/UPDATE aesthetic_treatments SET is_active/i.test(sql)) {
        if (params[0] === 'tx-exists') return { rowCount: 1 };
        return { rowCount: 0 };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  });
  app.register(require('../../src/routes/aesthetic-treatments'), { prefix: '/api/aesthetic' });
  return app;
}

describe('GET /aesthetic/treatments', () => {
  test('lista tratamentos globais + tenant (estetica admin)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/treatments' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe('Criolipólise');
  });

  test('403 para módulo human', async () => {
    const app = await buildApp({ module: 'human' });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/treatments' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /aesthetic/treatments', () => {
  test('admin cria tratamento proprietário e retorna 201', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/treatments',
      payload: {
        name: 'Novo Tratamento',
        category: 'facial_rejuvenescimento',
        indications: ['rugas'],
        contraindications: [],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('tx-new');
    expect(body.tenant_id).toBe('t1');
  });

  test('403 para role doctor', async () => {
    const app = await buildApp({ role: 'doctor' });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/treatments',
      payload: {
        name: 'Novo Tratamento',
        category: 'facial_rejuvenescimento',
        indications: ['rugas'],
        contraindications: [],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/admin/i);
  });

  test('400 para body inválido (sem name)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/treatments',
      payload: { category: 'outro', indications: [], contraindications: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /aesthetic/treatments/:id', () => {
  test('admin edita tratamento do próprio tenant', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT', url: '/api/aesthetic/treatments/tx-exists',
      payload: { name: 'Updated' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).name).toBe('Updated');
  });

  test('404 quando tratamento não pertence ao tenant', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT', url: '/api/aesthetic/treatments/tx-other',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /aesthetic/treatments/:id', () => {
  test('soft delete retorna 204', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/aesthetic/treatments/tx-exists' });
    expect(res.statusCode).toBe(204);
  });

  test('404 quando tratamento não existe', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/aesthetic/treatments/tx-missing' });
    expect(res.statusCode).toBe(404);
  });
});
