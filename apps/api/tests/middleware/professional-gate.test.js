const Fastify = require('fastify');
const { requireMedico } = require('../../src/middleware/professional-gate');

function buildApp(userOverride = {}) {
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { user_id: 'u1', tenant_id: 't1', role: 'admin', professional_type: 'medico', ...userOverride };
  });
  app.post('/test/prescribe', {
    preHandler: [app.authenticate, requireMedico],
  }, async () => ({ ok: true }));
  return app;
}

describe('requireMedico', () => {
  it('permite medico', async () => {
    const app = buildApp({ professional_type: 'medico' });
    const r = await app.inject({ method: 'POST', url: '/test/prescribe' });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
  });

  it('permite dentista', async () => {
    const app = buildApp({ professional_type: 'dentista' });
    const r = await app.inject({ method: 'POST', url: '/test/prescribe' });
    expect(r.statusCode).toBe(200);
  });

  it('bloqueia esteticista com 403', async () => {
    const app = buildApp({ professional_type: 'esteticista' });
    const r = await app.inject({ method: 'POST', url: '/test/prescribe' });
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).error).toMatch(/médico|dentista/i);
  });

  it('bloqueia biomedico com 403', async () => {
    const app = buildApp({ professional_type: 'biomedico' });
    const r = await app.inject({ method: 'POST', url: '/test/prescribe' });
    expect(r.statusCode).toBe(403);
  });

  it('bloqueia quando professional_type ausente', async () => {
    const app = buildApp({ professional_type: undefined });
    const r = await app.inject({ method: 'POST', url: '/test/prescribe' });
    expect(r.statusCode).toBe(403);
  });
});
