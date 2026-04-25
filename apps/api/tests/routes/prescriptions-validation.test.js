'use strict';
/**
 * Validation gate tests pra POST /prescriptions.
 *
 * Foco: agent_type whitelist + required fields + items=array. Receita errada
 * impacta tratamento clínico — gates devem ser rígidos.
 */

const Fastify = require('fastify');

function buildApp() {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async function (request) {
    request.user = {
      user_id: '00000000-0000-0000-0000-000000000099',
      tenant_id: '00000000-0000-0000-0000-000000000099',
      role: 'admin',
      module: 'human',
    };
  });

  app.decorate('pg', {
    query: jest.fn(async () => ({ rows: [{}] })),
    connect: jest.fn(async () => ({
      query: jest.fn(async () => ({ rows: [{}] })),
      release: jest.fn(),
    })),
  });

  return app;
}

async function makeApp() {
  const app = buildApp();
  await app.register(require('../../src/routes/prescriptions'), { prefix: '/prescriptions' });
  await app.ready();
  return app;
}

describe('POST /prescriptions — validation', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  const post = (payload) => app.inject({ method: 'POST', url: '/prescriptions', payload });

  test('body vazio → 400', async () => {
    const res = await post({});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject_id, exam_id, agent_type e items/);
  });

  test('sem subject_id → 400', async () => {
    const res = await post({ exam_id: 'e1', agent_type: 'therapeutic', items: [] });
    expect(res.statusCode).toBe(400);
  });

  test('sem exam_id → 400', async () => {
    const res = await post({ subject_id: 's1', agent_type: 'therapeutic', items: [] });
    expect(res.statusCode).toBe(400);
  });

  test('sem agent_type → 400', async () => {
    const res = await post({ subject_id: 's1', exam_id: 'e1', items: [] });
    expect(res.statusCode).toBe(400);
  });

  test('sem items → 400', async () => {
    const res = await post({ subject_id: 's1', exam_id: 'e1', agent_type: 'therapeutic' });
    expect(res.statusCode).toBe(400);
  });

  describe('agent_type whitelist', () => {
    test('agent_type=therapeutic aceito', async () => {
      const res = await post({ subject_id: 's1', exam_id: 'e1', agent_type: 'therapeutic', items: [{}] });
      expect(res.json().error || '').not.toMatch(/agent_type inválido/);
    });

    test('agent_type=nutrition aceito', async () => {
      const res = await post({ subject_id: 's1', exam_id: 'e1', agent_type: 'nutrition', items: [{}] });
      expect(res.json().error || '').not.toMatch(/agent_type inválido/);
    });

    // Receita só pra agentes que produzem plano de tratamento — não pra
    // diagnóstico (cardiovascular, metabolic, hematology, etc.).
    test.each(['cardiovascular', 'metabolic', 'hematology', 'small_animals', 'random'])(
      'agent_type=%s rejeitado — só therapeutic e nutrition emitem receita',
      async (agent_type) => {
        const res = await post({ subject_id: 's1', exam_id: 'e1', agent_type, items: [{}] });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toMatch(/agent_type inválido/);
      }
    );
  });

  describe('items shape', () => {
    test('items objeto (não array) → 400', async () => {
      const res = await post({ subject_id: 's1', exam_id: 'e1', agent_type: 'therapeutic', items: { foo: 'bar' } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/items deve ser um array/);
    });

    test('items string → 400', async () => {
      const res = await post({ subject_id: 's1', exam_id: 'e1', agent_type: 'therapeutic', items: 'medicamento' });
      expect(res.statusCode).toBe(400);
    });

    test('items number → 400', async () => {
      const res = await post({ subject_id: 's1', exam_id: 'e1', agent_type: 'therapeutic', items: 42 });
      expect(res.statusCode).toBe(400);
    });

    test('items array vazio aceito (médico pode criar receita vazia inicial)', async () => {
      const res = await post({ subject_id: 's1', exam_id: 'e1', agent_type: 'therapeutic', items: [] });
      expect(res.json().error || '').not.toMatch(/items deve ser um array/);
    });
  });
});
