'use strict';
/**
 * Tests for POST /master/aesthetic-purge-sensitive/run-now.
 *
 * Verifies:
 *   1. Non-master role → 403
 *   2. Master role → publishes to Redis + 200 ok
 *   3. Redis publish failure → 500
 */

const Fastify = require('fastify');

const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const MASTER_USER_ID   = 'master-user-id';

function buildApp({ role = 'master', redisPublishImpl } = {}) {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async function (request) {
    request.user = {
      user_id:   MASTER_USER_ID,
      tenant_id: MASTER_TENANT_ID,
      role,
      module:    'estetica',
    };
  });

  // Minimal pg mock (this endpoint doesn't touch pg)
  app.decorate('pg', {
    query: jest.fn(async () => ({ rows: [] })),
    connect: jest.fn(async () => ({
      query: jest.fn(async () => ({})),
      release: jest.fn(),
    })),
  });

  const redisMock = {
    publish: jest.fn(
      redisPublishImpl || (async () => 1)
    ),
  };
  app.decorate('redis', redisMock);

  return { app, redisMock };
}

async function withApp(opts) {
  const ctx = buildApp(opts);
  await ctx.app.register(require('../../src/routes/master'), { prefix: '/master' });
  await ctx.app.ready();
  return ctx;
}

// ---------------------------------------------------------------------------

describe('POST /master/aesthetic-purge-sensitive/run-now — ACL', () => {
  test('role=admin → 403 Forbidden', async () => {
    const { app } = await withApp({ role: 'admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/master/aesthetic-purge-sensitive/run-now',
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('role=doctor → 403 Forbidden', async () => {
    const { app } = await withApp({ role: 'doctor' });
    const res = await app.inject({
      method: 'POST',
      url: '/master/aesthetic-purge-sensitive/run-now',
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('POST /master/aesthetic-purge-sensitive/run-now — happy path', () => {
  test('master role → publishes to admin:purge-sensitive-trigger + returns 200 ok', async () => {
    const { app, redisMock } = await withApp({ role: 'master' });
    const res = await app.inject({
      method: 'POST',
      url: '/master/aesthetic-purge-sensitive/run-now',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.message).toBe('string');

    // Verify redis.publish was called with the correct channel
    expect(redisMock.publish).toHaveBeenCalledTimes(1);
    const [channel, payload] = redisMock.publish.mock.calls[0];
    expect(channel).toBe('admin:purge-sensitive-trigger');
    const parsed = JSON.parse(payload);
    expect(parsed.triggered_by).toBe(MASTER_USER_ID);
    expect(typeof parsed.triggered_at).toBe('string');
    await app.close();
  });
});

describe('POST /master/aesthetic-purge-sensitive/run-now — Redis failure', () => {
  test('Redis publish throws → 500 TRIGGER_FAILED', async () => {
    const { app } = await withApp({
      role: 'master',
      redisPublishImpl: async () => { throw new Error('Redis connection lost'); },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/master/aesthetic-purge-sensitive/run-now',
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe('TRIGGER_FAILED');
    expect(body.message).toMatch(/Redis connection lost/);
    await app.close();
  });
});
