'use strict';
/**
 * Tests pra POST /onboarding/checkout — rota single-shot que cria Stripe Checkout
 * Session com toda info do onboarding na metadata. Valida que professional_type
 * é propagado pra metadata.
 *
 * Padrão: build Fastify isolado + mock do Stripe SDK + inject (sem rede, sem DB).
 */

jest.mock('stripe', () => {
  const mock = {
    customers: {
      create: jest.fn(async () => ({ id: 'cus_test_001' })),
    },
    checkout: {
      sessions: {
        create: jest.fn(async () => ({ id: 'cs_test_001', url: 'https://stripe.test/s/cs_test_001' })),
      },
    },
  };
  const Mock = jest.fn(() => mock);
  Mock._mock = mock;
  return Mock;
});

// bcrypt.hash é lento (~80ms) — mock pra acelerar testes
jest.mock('bcrypt', () => ({
  hash: jest.fn(async () => '$2b$12$mockedhashvaluefortestsdoesnotmatter1234567890ABCDEF'),
}));

const Fastify = require('fastify');
const Stripe = require('stripe');

function buildApp({ existingEmail = false } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('pg', {
    query: jest.fn(async (sql) => {
      // Pré-check de email duplicado
      if (/SELECT id FROM users WHERE LOWER\(email\)/i.test(sql)) {
        return { rows: existingEmail ? [{ id: 'u-existing' }] : [] };
      }
      return { rows: [] };
    }),
  });
  return app;
}

describe('POST /onboarding/checkout — propaga professional_type pra Stripe metadata', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_SUBSCRIPTION = 'price_test_001';
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.FRONTEND_URL = 'https://app.test';
    jest.clearAllMocks();
    require('../../src/services/stripe-client')._resetClient();
  });

  test('aceita professional_type=esteticista no payload e propaga pra Stripe metadata', async () => {
    const app = buildApp();
    await app.register(require('../../src/routes/onboarding-checkout'));

    const res = await app.inject({
      method: 'POST',
      url: '/onboarding/checkout',
      payload: {
        clinic_name: 'Clínica Estética X',
        email: 'admin@x.com',
        password: 'pass1234',
        module: 'estetica',
        specialties: ['metabolic'],
        professional_type: 'esteticista',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().url).toMatch(/stripe\.test/);

    // Stripe.checkout.sessions.create chamado com metadata.professional_type='esteticista'
    const sessionCreateCall = Stripe._mock.checkout.sessions.create.mock.calls[0][0];
    expect(sessionCreateCall.metadata).toMatchObject({
      origin: 'onboarding',
      email: 'admin@x.com',
      module: 'estetica',
      professional_type: 'esteticista',
    });

    await app.close();
  });

  test('professional_type ausente → default medico na metadata', async () => {
    const app = buildApp();
    await app.register(require('../../src/routes/onboarding-checkout'));

    const res = await app.inject({
      method: 'POST',
      url: '/onboarding/checkout',
      payload: {
        clinic_name: 'Clínica Y',
        email: 'admin@y.com',
        password: 'pass1234',
        module: 'human',
        specialties: ['metabolic'],
        // sem professional_type
      },
    });

    expect(res.statusCode).toBe(200);
    const sessionCreateCall = Stripe._mock.checkout.sessions.create.mock.calls[0][0];
    expect(sessionCreateCall.metadata.professional_type).toBe('medico');
    await app.close();
  });

  test('professional_type inválido (hacker) → fallback medico', async () => {
    const app = buildApp();
    await app.register(require('../../src/routes/onboarding-checkout'));

    const res = await app.inject({
      method: 'POST',
      url: '/onboarding/checkout',
      payload: {
        clinic_name: 'Clínica Z',
        email: 'admin@z.com',
        password: 'pass1234',
        module: 'human',
        specialties: ['metabolic'],
        professional_type: 'hacker',
      },
    });

    expect(res.statusCode).toBe(200);
    const sessionCreateCall = Stripe._mock.checkout.sessions.create.mock.calls[0][0];
    expect(sessionCreateCall.metadata.professional_type).toBe('medico');
    await app.close();
  });

  test('todos os 5 professional_types válidos da whitelist passam', async () => {
    const types = ['medico', 'esteticista', 'dentista', 'biomedico', 'outro'];
    for (const ptype of types) {
      const app = buildApp();
      await app.register(require('../../src/routes/onboarding-checkout'));
      const res = await app.inject({
        method: 'POST',
        url: '/onboarding/checkout',
        payload: {
          clinic_name: 'X',
          email: `${ptype}@x.com`,
          password: 'pass1234',
          module: 'estetica',
          specialties: ['metabolic'],
          professional_type: ptype,
        },
      });
      expect(res.statusCode).toBe(200);
      const lastCall = Stripe._mock.checkout.sessions.create.mock.calls.slice(-1)[0][0];
      expect(lastCall.metadata.professional_type).toBe(ptype);
      await app.close();
    }
  });

  test('esteticista aceita specialties: [] (não exige especialidade médica)', async () => {
    const app = buildApp();
    await app.register(require('../../src/routes/onboarding-checkout'));
    const res = await app.inject({
      method: 'POST',
      url: '/onboarding/checkout',
      payload: {
        clinic_name: 'Clínica X',
        email: 'esteticista@x.com',
        password: 'pass1234',
        module: 'estetica',
        specialties: [],
        professional_type: 'esteticista',
      },
    });
    expect(res.statusCode).toBe(200);
    const lastCall = Stripe._mock.checkout.sessions.create.mock.calls.slice(-1)[0][0];
    expect(lastCall.metadata.professional_type).toBe('esteticista');
    expect(lastCall.metadata.specialties).toBe('');
    await app.close();
  });

  test('biomedico/outro também aceita specialties vazio', async () => {
    for (const ptype of ['biomedico', 'outro']) {
      const app = buildApp();
      await app.register(require('../../src/routes/onboarding-checkout'));
      const res = await app.inject({
        method: 'POST',
        url: '/onboarding/checkout',
        payload: {
          clinic_name: 'X', email: `${ptype}@x.com`, password: 'pass1234',
          module: 'estetica', specialties: [], professional_type: ptype,
        },
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    }
  });

  test('medico ainda exige specialties: [] retorna 400', async () => {
    const app = buildApp();
    await app.register(require('../../src/routes/onboarding-checkout'));
    const res = await app.inject({
      method: 'POST',
      url: '/onboarding/checkout',
      payload: {
        clinic_name: 'X', email: 'medico@x.com', password: 'pass1234',
        module: 'estetica', specialties: [], professional_type: 'medico',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/especialidade/i);
    await app.close();
  });

  test('dentista também exige specialties (não pode vazio)', async () => {
    const app = buildApp();
    await app.register(require('../../src/routes/onboarding-checkout'));
    const res = await app.inject({
      method: 'POST',
      url: '/onboarding/checkout',
      payload: {
        clinic_name: 'X', email: 'dentista@x.com', password: 'pass1234',
        module: 'estetica', specialties: [], professional_type: 'dentista',
      },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
