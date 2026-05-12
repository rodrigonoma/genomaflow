'use strict';

/**
 * Fastify minimal app pra integration tests.
 *
 * Por que existe: o `src/server.js` registra 45+ rotas + plugins (websocket,
 * rate-limit, multipart, etc.) e o cold boot no CI excede 180s. A maioria
 * desses plugins não importa pra integration tests aesthetic.
 *
 * Este app inclui APENAS:
 * - postgres plugin (conexão pg pool)
 * - redis decorate mínimo (alguns audit/ratelimit consumers podem usar)
 * - auth plugin (JWT verify) + decorator authenticate/authenticateMaster
 * - rate-limit registrado mas globalmente desligado (config: false)
 * - cors básico (não estritamente necessário em supertest mas inofensivo)
 * - middleware aesthetic-module-gate (decorator)
 * - rotas aesthetic (consent, photos, analyses, treatments, profile)
 * - rota patients (necessário pra RLS smoke test)
 *
 * NÃO inclui: websocket, multipart pesado, webhooks Stripe/SES, master
 * broadcasts, chat, agenda, video, etc.
 *
 * Boot esperado: <5s no CI vs 180s+ do server.js completo.
 */

const Fastify = require('fastify');

async function buildTestServer() {
  const app = Fastify({
    logger: false,            // silent no test
    trustProxy: true,
    maxParamLength: 500,
    pluginTimeout: 0,         // sem timeout — Jest controla via beforeAll
  });

  // CORS minimal (tests via supertest não precisam mas é leve)
  await app.register(require('@fastify/cors'), { origin: true });

  // Postgres pool
  await app.register(require('../../src/plugins/postgres'));

  // Redis decorator — alguns audit_trigger_fn consultam `app.redis` opcionalmente.
  // Usa ioredis com lazyConnect=true pra não bloquear boot se Redis não estiver up.
  await app.register(async function (fastify) {
    const Redis = require('ioredis');
    const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    fastify.decorate('redis', client);
    fastify.addHook('onClose', async () => { try { await client.quit(); } catch {} });
  });

  // Auth (JWT) + decorators authenticate / authenticateMaster
  await app.register(require('../../src/plugins/auth'));

  // Multipart pra rotas que recebem upload (photos)
  await app.register(require('@fastify/multipart'), {
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  // Rate-limit — necessário porque rotas declaram `config: { rateLimit: ... }`.
  // Sem o plugin, Fastify falha no register das rotas. Configuramos com limite
  // ALTÍSSIMO pra não atrapalhar testes.
  await app.register(require('@fastify/rate-limit'), {
    global: false,
    max: 100000,
    timeWindow: '1 hour',
  });

  // Pubsub plugin (registra notifyTenant + subscribers Redis).
  // Necessário pq rotas notificam tenant via WS.
  await app.register(require('../../src/plugins/pubsub'));

  // Rotas aesthetic + dependências mínimas
  const API_PREFIX = process.env.API_PREFIX || '';
  await app.register(async function (fastify) {
    fastify.register(require('../../src/routes/auth'),                { prefix: '/auth' });
    fastify.register(require('../../src/routes/patients'),            { prefix: '/patients' });
    fastify.register(require('../../src/routes/aesthetic-consent'),   { prefix: '/aesthetic' });
    fastify.register(require('../../src/routes/aesthetic-photos'),    { prefix: '/aesthetic' });
    fastify.register(require('../../src/routes/aesthetic-analyses'),  { prefix: '/aesthetic' });
    fastify.register(require('../../src/routes/aesthetic-treatments'),{ prefix: '/aesthetic' });
    fastify.register(require('../../src/routes/aesthetic-profile'),   { prefix: '/aesthetic' });
  }, { prefix: API_PREFIX });

  return app;
}

module.exports = { buildTestServer };
