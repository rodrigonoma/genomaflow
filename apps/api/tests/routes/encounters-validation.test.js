/**
 * Validação isolada das rotas /encounters (Fastify isolado, sem DB).
 * Modelo: tests/routes/billing-validation.test.js.
 *
 * Cobre:
 * - subject_id obrigatório em POST
 * - cross-module rejection (medical_history em vet, hydration em human)
 * - encounter_type whitelist
 * - vital_signs ranges
 * - cursor pagination shape (cursor inválido → 400 silencioso? Implementação retorna sem cursor + ignora)
 */

const Fastify = require('fastify');
const encountersRoute = require('../../src/routes/encounters');

function buildApp({ module = 'human', role = 'admin', user_id = 'u1', tenant_id = 't1' } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('pg', { query: jest.fn().mockResolvedValue({ rows: [] }) });
  app.decorate('authenticate', async (req) => {
    req.user = { tenant_id, user_id, role, module };
  });
  app.register(encountersRoute, { prefix: '/encounters' });
  return app;
}

describe('POST /encounters — validation', () => {
  test('sem subject_id → 400', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/encounters', payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject_id/);
    await app.close();
  });

  test('encounter_type inválido → 400', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/encounters',
      payload: { subject_id: 's1', encounter_type: 'banana' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/encounter_type/);
    await app.close();
  });

  test('module=veterinary com medical_history preenchido → 400', async () => {
    const app = buildApp({ module: 'veterinary' });
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/encounters',
      payload: { subject_id: 's1', medical_history: 'antecedentes' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/medical_history/);
    await app.close();
  });

  test('module=veterinary com medical_history null → OK no validator (segue pra DB)', async () => {
    const app = buildApp({ module: 'veterinary' });
    // Mock pg pra simular subject_id válido + insert
    app.pg.query.mockImplementation((sql) => {
      if (sql.includes('FROM subjects WHERE')) return Promise.resolve({ rows: [{ id: 's1' }] });
      if (sql.includes('INSERT INTO clinical_encounters')) {
        return Promise.resolve({ rows: [{ id: 'e1', subject_id: 's1' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/encounters',
      payload: { subject_id: 's1', medical_history: null, chief_complaint: 'tosse' },
    });
    // Não cai em 400 de cross-module; segue. Pode dar 500 por mock de withTenant —
    // o ponto do teste é só o validator não rejeitar null/empty cross-module.
    expect([201, 500]).toContain(res.statusCode);
    expect(res.json().error || '').not.toMatch(/medical_history/);
    await app.close();
  });

  test('vital_signs.hydration em module=human → 400', async () => {
    const app = buildApp({ module: 'human' });
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/encounters',
      payload: { subject_id: 's1', vital_signs: { hydration: 'normal' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/hydration/);
    await app.close();
  });

  test('vital_signs.blood_pressure_systolic em module=veterinary → 400', async () => {
    const app = buildApp({ module: 'veterinary' });
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/encounters',
      payload: { subject_id: 's1', vital_signs: { blood_pressure_systolic: 120 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/blood_pressure_systolic/);
    await app.close();
  });

  test('vital_signs.weight_kg fora do range → 400', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/encounters',
      payload: { subject_id: 's1', vital_signs: { weight_kg: 9999 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/weight_kg/);
    await app.close();
  });

  test('vital_signs.pain_score 11 → 400', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/encounters',
      payload: { subject_id: 's1', vital_signs: { pain_score: 11 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/pain_score/);
    await app.close();
  });

  test('attachments com 21 itens → 400', async () => {
    const app = buildApp();
    await app.ready();
    const att = Array(21).fill({ filename: 'x', s3_key: 'k', mime: 'application/pdf' });
    const res = await app.inject({
      method: 'POST', url: '/encounters',
      payload: { subject_id: 's1', attachments: att },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/máximo 20/);
    await app.close();
  });

  test('attachment sem s3_key → 400', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/encounters',
      payload: { subject_id: 's1', attachments: [{ filename: 'x', mime: 'application/pdf' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/attachment requer/);
    await app.close();
  });

  test('hydration "extreme" inválido → 400', async () => {
    const app = buildApp({ module: 'veterinary' });
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/encounters',
      payload: { subject_id: 's1', vital_signs: { hydration: 'extreme' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/hydration/);
    await app.close();
  });
});

describe('GET /encounters — pagination', () => {
  test('sem subject_id → 400', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/encounters' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject_id/);
    await app.close();
  });

  test('limit clamp 200 max', async () => {
    const app = buildApp();
    app.pg.query.mockResolvedValue({ rows: [] });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/encounters?subject_id=s1&limit=99999' });
    // Não rejeita, só clamp internamente — sucesso
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  test('cursor inválido (não-base64) é ignorado, não retorna 500', async () => {
    const app = buildApp();
    app.pg.query.mockResolvedValue({ rows: [] });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/encounters?subject_id=s1&cursor=garbage!' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
    await app.close();
  });
});
