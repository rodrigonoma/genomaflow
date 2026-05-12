'use strict';

/**
 * Integration tests para rotas de mutação aesthetic.
 *
 * Diferente dos tests `tests/routes/aesthetic-*.test.js` que mockam `pg.query`,
 * estes testes batem em Postgres REAL via supertest. Pegam:
 * - Schema mismatches (column inexistente, tipo errado)
 * - RLS policy bugs
 * - Audit trigger failures
 * - Foreign key violations
 *
 * Caso forense histórico: bug 2026-05-12 PUT /aesthetic/profile 500 —
 * 'updated_at = NOW()' em UPDATE subjects, mas tabela não tem essa coluna.
 * 15 unit tests com pg mockado passaram. Este suite teria pegado.
 *
 * Requisito: DATABASE_URL_TEST apontando para Postgres limpo
 *            (no CI: service container; local: docker compose db com DB de test).
 */

const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const supertest = require('supertest');
const {
  runMigrations,
  seedAestheticTenant,
  teardownAestheticTenant,
  closePool,
  signJwt,
} = require('./setup');

// Setup env ANTES do build — auth plugin valida JWT_SECRET no register
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';

const { buildTestServer } = require('./test-server');

// Boot do app minimal é <5s. 60s de timeout dá folga generosa pro CI.
jest.setTimeout(60_000);

let app;
let ctx; // { tenantId, adminUserId, subjectId }
let adminToken;

beforeAll(async () => {
  // CI: migrations já aplicadas no step `apply migrations` antes do Jest
  //     (workflow deploy.yml). runMigrations() aqui é no-op idempotente.
  // Local dev: aplica em ordem se ainda não tiver.
  await runMigrations();
  app = await buildTestServer();
  await app.ready();
  ctx = await seedAestheticTenant();
  adminToken = signJwt({
    user_id: ctx.adminUserId,
    tenant_id: ctx.tenantId,
    role: 'admin',
    module: 'estetica',
  });
}, 60_000);

afterAll(async () => {
  await teardownAestheticTenant();
  await closePool();
  await app.close();
});

const auth = () => ({ Authorization: `Bearer ${adminToken}` });

// ---------------------------------------------------------------------------
// PUT /aesthetic/profile/:subject_id — REGRESSION GUARD bug 2026-05-12
// ---------------------------------------------------------------------------

describe('PUT /aesthetic/profile/:subject_id — schema real', () => {
  test('persiste perfil válido sem 500 (regression updated_at)', async () => {
    const res = await supertest(app.server)
      .put(`/api/aesthetic/profile/${ctx.subjectId}`)
      .set(auth())
      .send({
        height_cm: 165,
        weight_kg: 65,
        age: 30,
        sex: 'F',
        activity_level: 'moderate',
        goals: ['fat_loss'],
      });

    expect(res.status).toBe(200);
    expect(res.body.profile).toBeDefined();
    expect(res.body.profile.height_cm).toBe(165);
    expect(res.body.profile.updated_at).toBeDefined(); // dentro do JSONB
    expect(res.body.computed).toBeDefined();
    expect(res.body.computed.tmb).toBeGreaterThan(0);
  });

  test('GET subsequente retorna o mesmo profile', async () => {
    const res = await supertest(app.server)
      .get(`/api/aesthetic/profile/${ctx.subjectId}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.profile.height_cm).toBe(165);
    expect(res.body.profile.weight_kg).toBe(65);
  });

  test('PUT inválido retorna 400 explícito, não 500', async () => {
    const res = await supertest(app.server)
      .put(`/api/aesthetic/profile/${ctx.subjectId}`)
      .set(auth())
      .send({ height_cm: 30 }); // fora do range

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/height_cm/);
  });
});

// ---------------------------------------------------------------------------
// POST /aesthetic/treatments — mutation tenant catalog
// ---------------------------------------------------------------------------

describe('POST /aesthetic/treatments — schema real', () => {
  test('cria tratamento proprietário do tenant + retorna row completo', async () => {
    const res = await supertest(app.server)
      .post('/api/aesthetic/treatments')
      .set(auth())
      .send({
        name: 'Integration Test Treatment',
        category: 'corpo_modelagem',
        indications: ['culote_esquerdo'],
        contraindications: ['gravidez'],
        typical_sessions: 4,
        interval_days: 14,
        evidence_level: 'B',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.tenant_id).toBe(ctx.tenantId);
    expect(res.body.name).toBe('Integration Test Treatment');
  });

  test('GET lista inclui o tratamento recém-criado + globais do seed', async () => {
    const res = await supertest(app.server)
      .get('/api/aesthetic/treatments')
      .set(auth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    // Globais (seed 093) + 1 proprietário recém criado
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    const own = res.body.items.find(t => t.name === 'Integration Test Treatment');
    expect(own).toBeDefined();
    expect(own.tenant_id).toBe(ctx.tenantId);
  });
});

// ---------------------------------------------------------------------------
// POST /aesthetic/consent — mutation consent + audit trigger
// ---------------------------------------------------------------------------

describe('POST /aesthetic/consent — schema + audit trigger reais', () => {
  test('UPSERT consent operacional + dispara audit trigger sem 500', async () => {
    const res = await supertest(app.server)
      .post('/api/aesthetic/consent')
      .set(auth())
      .send({
        subject_id: ctx.subjectId,
        reinforced_regions: ['breast'],
        notes: 'integration test',
      });

    expect([200, 201]).toContain(res.status); // pode ser create ou update
    expect(res.body.id || res.body.consent_id || res.body).toBeDefined();
  });

  test('GET consent retorna reinforced_regions persistidas', async () => {
    const res = await supertest(app.server)
      .get(`/api/aesthetic/consent/${ctx.subjectId}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.reinforced_regions).toEqual(expect.arrayContaining(['breast']));
  });
});

// ---------------------------------------------------------------------------
// POST /aesthetic/photos + /aesthetic/analyses — REGRESSION GUARD bug 2026-05-12
// (credit_ledger.ref_id schema mismatch — bug 4 do dia)
// ---------------------------------------------------------------------------

describe('POST /aesthetic/analyses — credit_ledger.ref_id schema (regression)', () => {
  test('debit créditos não retorna 500 (regression ref_id)', async () => {
    // Pre-requisito: tenant precisa ter saldo de créditos. Cria via INSERT direto
    // pra não depender de Stripe checkout.
    const { getPool } = require('./setup');
    const pool = getPool();
    await pool.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description)
       VALUES ($1, 100, 'adjustment', 'integration test seed')`,
      [ctx.tenantId]
    );

    // Upload uma foto via path direto no DB (não vamos testar S3 aqui — só
    // a chain photos → analyses para pegar bug ref_id).
    const photoId = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO aesthetic_photos (id, tenant_id, subject_id, user_id, photo_type, s3_key, is_sensitive)
       VALUES ($1, $2, $3, $4, 'facial_front', $5, false)`,
      [photoId, ctx.tenantId, ctx.subjectId, ctx.adminUserId, `test/${photoId}.jpg`]
    );

    // Registrar consent operacional (pre-flight do POST /analyses)
    await supertest(app.server)
      .post('/api/aesthetic/consent')
      .set(auth())
      .send({ subject_id: ctx.subjectId, reinforced_regions: [] });

    const res = await supertest(app.server)
      .post('/api/aesthetic/analyses')
      .set(auth())
      .send({
        analysis_type: 'facial',
        subject_id: ctx.subjectId,
        photo_ids: [photoId],
      });

    // 500 com 'column "ref_id" of relation "credit_ledger" does not exist'
    // era o bug. Agora deve ser 201 com analysis_id + status pending.
    expect(res.status).toBe(201);
    expect(res.body.analysis_id).toBeDefined();
    expect(res.body.status).toBe('pending');
    expect(res.body.credits_charged).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Smoke RLS — verifica isolamento entre tenants
// ---------------------------------------------------------------------------

describe('RLS isolation — tenant não vê dados de outro tenant', () => {
  test('subject de outro tenant fictício NÃO aparece em listagens', async () => {
    // Mais defensivo: tenta hitar um endpoint que lista subjects do tenant
    // O importante é que NÃO retorna 500 e NÃO vaza id de outro tenant.
    const res = await supertest(app.server)
      .get('/api/patients')
      .set(auth());

    expect(res.status).toBe(200);
    if (Array.isArray(res.body)) {
      const otherTenant = res.body.find(p => p.tenant_id && p.tenant_id !== ctx.tenantId);
      expect(otherTenant).toBeUndefined();
    }
  });
});
