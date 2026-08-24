/**
 * Rotas de health — a única coisa que o Docker olha para decidir se o
 * contêiner está vivo. Se estes testes afrouxarem, o healthcheck volta a
 * mentir (era o caso até 24/08/2026: apontava para /api/auth/me, que exige
 * autenticação e nunca poderia passar).
 *
 * Contrato:
 *   GET /health        → liveness. 200 sempre que o processo responde.
 *                        NÃO toca em banco nem Redis de propósito: reiniciar
 *                        a API não conserta banco fora do ar.
 *   GET /health/ready  → readiness. 200 só com pg E redis respondendo; 503
 *                        caso contrário. Não vaza detalhe de infra.
 */

const Fastify = require('fastify');
const route = require('../../src/routes/health');

function buildApp({ pgOk = true, redisOk = true, pgHangs = false } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('pg', {
    query: jest.fn(() =>
      pgHangs
        ? new Promise(() => {}) // nunca resolve — simula banco pendurado
        : pgOk
          ? Promise.resolve({ rows: [{ ok: 1 }] })
          : Promise.reject(new Error('ECONNREFUSED 172.18.0.2:5432'))
    ),
  });
  app.decorate('redis', {
    ping: jest.fn(() =>
      redisOk ? Promise.resolve('PONG') : Promise.reject(new Error('Redis down'))
    ),
  });
  app.register(route, { prefix: '' });
  return app;
}

describe('GET /health (liveness)', () => {
  test('responde 200 sem autenticação', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  test('não consulta banco nem Redis', async () => {
    const app = buildApp(); await app.ready();
    await app.inject({ method: 'GET', url: '/health' });
    expect(app.pg.query).not.toHaveBeenCalled();
    expect(app.redis.ping).not.toHaveBeenCalled();
    await app.close();
  });

  test('responde 200 mesmo com banco e Redis fora', async () => {
    const app = buildApp({ pgOk: false, redisOk: false }); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  test('não vaza versão, hostname nem env no corpo', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(Object.keys(res.json())).toEqual(['status']);
    await app.close();
  });
});

describe('GET /health/ready (readiness)', () => {
  test('pg e redis ok → 200 com os dois checks true', async () => {
    const app = buildApp(); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ready',
      checks: { postgres: true, redis: true },
    });
    await app.close();
  });

  test('pg fora → 503', async () => {
    const app = buildApp({ pgOk: false }); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks).toEqual({ postgres: false, redis: true });
    await app.close();
  });

  test('redis fora → 503', async () => {
    const app = buildApp({ redisOk: false }); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks).toEqual({ postgres: true, redis: false });
    await app.close();
  });

  test('banco pendurado não segura a resposta — vira 503 pelo timeout', async () => {
    const app = buildApp({ pgHangs: true }); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.postgres).toBe(false);
    await app.close();
  }, 10000);

  test('falha não vaza mensagem de erro nem host interno', async () => {
    const app = buildApp({ pgOk: false }); await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.payload).not.toMatch(/ECONNREFUSED|172\.18|5432/);
    expect(Object.keys(res.json())).toEqual(['status', 'checks']);
    await app.close();
  });
});
