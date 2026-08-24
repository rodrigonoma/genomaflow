/**
 * Trava de indisponibilidade da consulta por vídeo.
 *
 * Contexto: o Chime perdeu a credencial no cleanup da AWS (08/2026). Sem esta
 * trava, criar uma consulta debita crédito e depois estoura 500 opaco vindo do
 * SDK. A trava tem que vir ANTES de qualquer validação ou débito.
 *
 * O gate é no backend de propósito: o APK já instalado carrega o bundle
 * Angular antigo, com o botão de vídeo ainda visível. Esconder só na web não
 * protege quem está no celular.
 */

const Fastify = require('fastify');

function buildApp() {
  // VIDEO_ENABLED é lido no carregamento do módulo — o require tem que
  // acontecer depois de mexer no env, e com o cache do módulo limpo.
  jest.resetModules();
  const route = require('../../src/routes/video');
  const app = Fastify({ logger: false });
  app.decorate('pg', { query: jest.fn().mockResolvedValue({ rows: [] }) });
  app.decorate('authenticate', async (req) => {
    req.user = { tenant_id: 't1', user_id: 'u1', role: 'admin', module: 'human' };
  });
  app.register(route, { prefix: '/video' });
  return app;
}

const ORIGINAL = process.env.VIDEO_CONSULTATION_ENABLED;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VIDEO_CONSULTATION_ENABLED;
  else process.env.VIDEO_CONSULTATION_ENABLED = ORIGINAL;
});

describe('VIDEO_CONSULTATION_ENABLED=false', () => {
  test('POST /video/consultations → 503 com código explícito', async () => {
    process.env.VIDEO_CONSULTATION_ENABLED = 'false';
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/video/consultations',
      payload: { appointment_id: 'a1', modality: 'simple' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('VIDEO_CONSULTATION_DISABLED');
    await app.close();
  });

  test('não toca no banco — logo não debita crédito', async () => {
    process.env.VIDEO_CONSULTATION_ENABLED = 'false';
    const app = buildApp(); await app.ready();
    await app.inject({
      method: 'POST', url: '/video/consultations',
      payload: { appointment_id: 'a1', modality: 'simple' },
    });
    expect(app.pg.query).not.toHaveBeenCalled();
    await app.close();
  });

  test('a trava vem antes da validação de payload (503, não 400)', async () => {
    process.env.VIDEO_CONSULTATION_ENABLED = 'false';
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/video/consultations', payload: {},
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

describe('sem a variável (padrão: ligado)', () => {
  test('não devolve 503 — segue para a validação normal', async () => {
    delete process.env.VIDEO_CONSULTATION_ENABLED;
    const app = buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/video/consultations', payload: {},
    });
    expect(res.statusCode).toBe(400); // appointment_id obrigatório
    await app.close();
  });
});
