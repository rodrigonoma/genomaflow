const Fastify = require('fastify');

// Mock do withTenant pra não tocar DB
jest.mock('../../src/db/tenant', () => ({
  withTenant: jest.fn(async (pg, tid, fn) => fn({
    query: async () => ({ rows: [{ id: 'rx1' }] })
  })),
}));

describe('prescriptions routes — requireMedico gate', () => {
  function build(userOverride = {}) {
    const app = Fastify();
    app.decorate('authenticate', async (request) => {
      request.user = { user_id: 'u1', tenant_id: 't1', role: 'admin', professional_type: 'medico', ...userOverride };
    });
    app.decorate('pg', { query: jest.fn(async () => ({ rows: [] })) });
    app.register(require('../../src/routes/prescriptions'), { prefix: '/prescriptions' });
    return app;
  }

  it('POST /prescriptions — esteticista 403', async () => {
    const app = build({ professional_type: 'esteticista' });
    const r = await app.inject({
      method: 'POST', url: '/prescriptions',
      payload: { subject_id: 's1', exam_id: 'e1', agent_type: 'therapeutic', items: [] },
    });
    expect(r.statusCode).toBe(403);
  });

  it('PUT /prescriptions/:id — esteticista 403', async () => {
    const app = build({ professional_type: 'esteticista' });
    const r = await app.inject({
      method: 'PUT', url: '/prescriptions/abc',
      payload: { items: [] },
    });
    expect(r.statusCode).toBe(403);
  });

  it('POST /prescriptions — medico passa o gate (200/4xx do handler, não 403)', async () => {
    const app = build({ professional_type: 'medico' });
    const r = await app.inject({
      method: 'POST', url: '/prescriptions',
      payload: {},
    });
    expect(r.statusCode).not.toBe(403);
  });
});
