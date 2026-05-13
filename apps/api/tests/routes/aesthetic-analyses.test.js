'use strict';

const { describe, test, expect } = require('@jest/globals');
const Fastify = require('fastify');

jest.mock('../../src/queues/aesthetic-analysis-queue', () => ({
  enqueue: jest.fn(async () => 'job-123'),
}));

// Mock pdf-lib para o teste de rota (evita I/O pesado nos testes de rota)
jest.mock('../../src/services/aesthetic-pdf-export', () => ({
  buildAnalysisPDF: jest.fn(async () => Buffer.from('%PDF-1.4 mock-pdf-content')),
}));

async function buildApp({
  balance = 100, hasConsent = true, photosOk = true,
  role = 'admin', module = 'estetica', consentRow = null,
  // V2 advanced tier mocks
  advancedPhotosComplete = true,
  advancedPhotosSessionId = 'sess-1',
} = {}) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module, professional_type: 'medico' };
  });
  const queries = [];
  app.decorate('pg', {
    connect: jest.fn(async () => app.pg),
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/COALESCE\(SUM\(amount\)/i.test(sql)) return { rows: [{ balance: String(balance) }] };
      if (/SELECT .* FROM aesthetic_consent/i.test(sql)) {
        if (!hasConsent) return { rows: [] };
        const row = consentRow !== null ? consentRow : { id: 'c1', created_at: '2026-05-11T00:00:00Z', reinforced_regions: [] };
        return { rows: [row] };
      }
      // validatePhotosForAdvanced (V2) — distinguir pelo SELECT incluir pose
      if (/SELECT id, pose, landmarks, session_id\s+FROM aesthetic_photos/i.test(sql)) {
        if (!photosOk) return { rows: [] };
        return {
          rows: params[0].map((id) => ({
            id,
            pose: advancedPhotosComplete ? 'frontal' : null,
            landmarks: advancedPhotosComplete ? { type: 'face' } : null,
            session_id: advancedPhotosSessionId,
          })),
        };
      }
      if (/SELECT id FROM aesthetic_photos/i.test(sql)) {
        if (!photosOk) return { rows: [] };
        return { rows: params[0].map((id) => ({ id })) };
      }
      if (/INSERT INTO aesthetic_analyses/i.test(sql)) {
        return { rows: [{ id: 'a-new', tier: params[8] || 'standard', session_id: params[7] }] };
      }
      if (/INSERT INTO credit_ledger/i.test(sql)) return { rows: [{ id: 'cl1' }] };
      return { rows: [] };
    }),
    release: jest.fn(),
  });
  app._queries = queries;
  app.register(require('../../src/routes/aesthetic-analyses'), { prefix: '/api/aesthetic' });
  return app;
}

describe('POST /aesthetic/analyses', () => {
  test('cria análise + enqueue + debita créditos', async () => {
    const app = await buildApp();
    const { enqueue } = require('../../src/queues/aesthetic-analysis-queue');
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1','p2'] },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({ analysis_id: 'a-new', status: 'pending' });
    expect(enqueue).toHaveBeenCalled();
    const debitCall = app._queries.find(q => /INSERT INTO credit_ledger/.test(q.sql));
    expect(debitCall.params[1]).toBe(-5);
  });

  test('402 sem créditos suficientes', async () => {
    const app = await buildApp({ balance: 2 });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1'] },
    });
    expect(res.statusCode).toBe(402);
    expect(JSON.parse(res.body).error).toBe('INSUFFICIENT_CREDITS');
  });

  test('403 sem consent', async () => {
    const app = await buildApp({ hasConsent: false });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1'] },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('CONSENT_MISSING');
  });

  test('400 photo_ids vazio', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 photos_ids > 3', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1','p2','p3','p4'] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 analysis_type inválido', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'invalid', subject_id: 'sub1', photo_ids: ['p1'] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 photo_id não pertence ao tenant', async () => {
    const app = await buildApp({ photosOk: false });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['stranger-photo'] },
    });
    expect(res.statusCode).toBe(400);
  });

  // Pre-flight 2b: reinforced consent gate (F5.2)
  test('403 CONSENT_REINFORCED_MISSING — breast sem reinforced_regions cobrindo breast', async () => {
    // Consent exists but reinforced_regions is empty
    const app = await buildApp({
      consentRow: { id: 'c1', created_at: '2026-05-11T00:00:00Z', reinforced_regions: [] },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'breast', subject_id: 'sub1', photo_ids: ['p1'] },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('CONSENT_REINFORCED_MISSING');
    expect(body.analysis_type).toBe('breast');
    expect(body.missing_reinforced_region).toBe('breast');
  });

  test('201 breast COM reinforced_regions incluindo breast', async () => {
    const app = await buildApp({
      consentRow: { id: 'c1', created_at: '2026-05-11T00:00:00Z', reinforced_regions: ['breast'] },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'breast', subject_id: 'sub1', photo_ids: ['p1'] },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).status).toBe('pending');
  });

  test('201 facial (não sensível) sem reinforced_regions — gate não dispara', async () => {
    // Consent exists with empty reinforced_regions; facial is not in SENSITIVE_REGIONS
    const app = await buildApp({
      consentRow: { id: 'c1', created_at: '2026-05-11T00:00:00Z', reinforced_regions: [] },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1'] },
    });
    expect(res.statusCode).toBe(201);
  });

  // -------------------------------------------------------------------------
  // V2 tier-aware — standard backward compat + advanced new path
  // -------------------------------------------------------------------------

  test('V2: tier=standard explícito mantém custo 5 + kind aesthetic_facial_analysis', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: {
        analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1','p2'],
        tier: 'standard',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.tier).toBe('standard');
    expect(body.credits_charged).toBe(5);
    const debit = app._queries.find(q => /INSERT INTO credit_ledger/.test(q.sql));
    expect(debit.params[1]).toBe(-5);
    expect(debit.params[2]).toBe('aesthetic_facial_analysis');
  });

  test('V2: payload sem tier defaults para standard (backward compat)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: { analysis_type: 'facial', subject_id: 'sub1', photo_ids: ['p1'] },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).tier).toBe('standard');
  });

  test('V2: tier=advanced facial com 5 fotos válidas → 201 + custo 10 + kind *_advanced', async () => {
    const app = await buildApp({
      consentRow: { id: 'c1', created_at: '2026-05-11', reinforced_regions: [] },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: {
        analysis_type: 'facial', subject_id: 'sub1',
        photo_ids: ['p1','p2','p3','p4','p5'],
        tier: 'advanced',
        session_id: 'sess-1',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.tier).toBe('advanced');
    expect(body.credits_charged).toBe(10);
    expect(body.session_id).toBe('sess-1');
    const debit = app._queries.find(q => /INSERT INTO credit_ledger/.test(q.sql));
    expect(debit.params[1]).toBe(-10);
    expect(debit.params[2]).toBe('aesthetic_facial_analysis_advanced');
  });

  test('V2: tier=advanced sem session_id → 400 SESSION_REQUIRED', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: {
        analysis_type: 'facial', subject_id: 'sub1',
        photo_ids: ['p1','p2','p3','p4','p5'],
        tier: 'advanced',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('SESSION_REQUIRED');
  });

  test('V2: tier=advanced facial com 3 fotos → 400 PHOTO_COUNT_MISMATCH', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: {
        analysis_type: 'facial', subject_id: 'sub1',
        photo_ids: ['p1','p2','p3'],
        tier: 'advanced',
        session_id: 'sess-1',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('PHOTO_COUNT_MISMATCH');
    expect(body.expected).toBe(5);
    expect(body.received).toBe(3);
  });

  test('V2: tier=advanced body_measurements com 4 fotos → 201', async () => {
    const app = await buildApp({
      consentRow: { id: 'c1', created_at: '2026-05-11', reinforced_regions: [] },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: {
        analysis_type: 'full_body', subject_id: 'sub1',
        photo_ids: ['p1','p2','p3','p4'],
        tier: 'advanced',
        session_id: 'sess-1',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).tier).toBe('advanced');
  });

  test('V2: tier=advanced photo sem pose/landmarks → 400 PHOTOS_INCOMPLETE_FOR_ADVANCED', async () => {
    const app = await buildApp({ advancedPhotosComplete: false });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: {
        analysis_type: 'facial', subject_id: 'sub1',
        photo_ids: ['p1','p2','p3','p4','p5'],
        tier: 'advanced',
        session_id: 'sess-1',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('PHOTOS_INCOMPLETE_FOR_ADVANCED');
  });

  test('V2: tier=advanced photo de outra session → 400 PHOTOS_INCOMPLETE_FOR_ADVANCED', async () => {
    const app = await buildApp({ advancedPhotosSessionId: 'sess-OTHER' });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: {
        analysis_type: 'facial', subject_id: 'sub1',
        photo_ids: ['p1','p2','p3','p4','p5'],
        tier: 'advanced',
        session_id: 'sess-1',  // não bate com sess-OTHER do mock
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('PHOTOS_INCOMPLETE_FOR_ADVANCED');
  });

  test('V2: tier=standard com 4+ fotos → 400 PHOTO_COUNT_OUT_OF_RANGE', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses',
      payload: {
        analysis_type: 'facial', subject_id: 'sub1',
        photo_ids: ['p1','p2','p3','p4'],
        tier: 'standard',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('PHOTO_COUNT_OUT_OF_RANGE');
  });

  test('V2: env override AESTHETIC_FACIAL_COST_ADVANCED=15 → cobra 15', async () => {
    const original = process.env.AESTHETIC_FACIAL_COST_ADVANCED;
    process.env.AESTHETIC_FACIAL_COST_ADVANCED = '15';
    try {
      // Re-require pra pegar novo valor da env (route lê no module load)
      jest.resetModules();
      jest.mock('../../src/queues/aesthetic-analysis-queue', () => ({
        enqueue: jest.fn(async () => 'job-123'),
      }));
      jest.mock('../../src/services/aesthetic-pdf-export', () => ({
        buildAnalysisPDF: jest.fn(async () => Buffer.from('%PDF')),
      }));
      // Build fresh app reusando mesmo factory pattern via fresh require
      const Fastify2 = require('fastify');
      const app = Fastify2({ logger: false });
      app.decorate('authenticate', async (req) => {
        req.user = { user_id: 'u1', tenant_id: 't1', role: 'admin', module: 'estetica', professional_type: 'medico' };
      });
      app.decorate('pg', {
        connect: jest.fn(async () => app.pg),
        query: jest.fn(async (sql, params) => {
          if (/COALESCE\(SUM\(amount\)/i.test(sql)) return { rows: [{ balance: '100' }] };
          if (/SELECT .* FROM aesthetic_consent/i.test(sql)) return { rows: [{ id: 'c1', reinforced_regions: [] }] };
          if (/SELECT id, pose, landmarks, session_id\s+FROM aesthetic_photos/i.test(sql)) {
            return { rows: params[0].map(id => ({ id, pose: 'frontal', landmarks: {type:'face'}, session_id: 'sess-1' })) };
          }
          if (/SELECT id FROM aesthetic_photos/i.test(sql)) return { rows: params[0].map(id => ({ id })) };
          if (/INSERT INTO aesthetic_analyses/i.test(sql)) return { rows: [{ id: 'a-new', tier: 'advanced' }] };
          if (/INSERT INTO credit_ledger/i.test(sql)) return { rows: [{ id: 'cl1' }] };
          return { rows: [] };
        }),
        release: jest.fn(),
      });
      app.register(require('../../src/routes/aesthetic-analyses'), { prefix: '/api/aesthetic' });

      const res = await app.inject({
        method: 'POST', url: '/api/aesthetic/analyses',
        payload: {
          analysis_type: 'facial', subject_id: 'sub1',
          photo_ids: ['p1','p2','p3','p4','p5'],
          tier: 'advanced', session_id: 'sess-1',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(JSON.parse(res.body).credits_charged).toBe(15);
    } finally {
      if (original === undefined) delete process.env.AESTHETIC_FACIAL_COST_ADVANCED;
      else process.env.AESTHETIC_FACIAL_COST_ADVANCED = original;
      jest.resetModules();
    }
  });
});

describe('GET /aesthetic/analyses', () => {
  test('lista com filtro de subject_id', async () => {
    const app = await buildApp();
    app.pg.query.mockImplementation(async (sql, params) => {
      if (/SELECT id, analysis_type, status, created_at/i.test(sql)) {
        return { rows: [{ id: 'a1', analysis_type: 'facial', status: 'done', created_at: '2026-05-11' }] };
      }
      return { rows: [] };
    });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/analyses?subject_id=sub1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).items).toHaveLength(1);
  });
});

describe('GET /aesthetic/analyses/:id', () => {
  test('retorna detalhe da análise do tenant', async () => {
    const app = await buildApp();
    app.pg.query.mockImplementation(async (sql, params) => {
      if (/SELECT \* FROM aesthetic_analyses/i.test(sql)) {
        if (params[0] === 'a-yes' && params[1] === 't1') {
          return { rows: [{ id: 'a-yes', analysis_type: 'facial', status: 'done', metrics: { rugas: { score: 72 } }, photo_ids: ['p1'] }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/analyses/a-yes' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).metrics.rugas.score).toBe(72);
  });

  test('404 se não é do tenant', async () => {
    const app = await buildApp();
    app.pg.query.mockImplementation(async () => ({ rows: [] }));
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/analyses/a-no' });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /aesthetic/analyses/:id', () => {
  test('soft delete e 204', async () => {
    const app = await buildApp();
    app.pg.query.mockImplementation(async (sql) => {
      if (/UPDATE aesthetic_analyses SET deleted_at/i.test(sql)) return { rowCount: 1 };
      return { rows: [] };
    });
    const res = await app.inject({ method: 'DELETE', url: '/api/aesthetic/analyses/a1' });
    expect(res.statusCode).toBe(204);
  });
});

describe('POST /aesthetic/analyses/:id/compare', () => {
  test('computa delta matemático entre baseline e atual', async () => {
    const app = await buildApp();
    app.pg.query.mockImplementation(async (sql, params) => {
      if (/SELECT id, metrics FROM aesthetic_analyses/i.test(sql)) {
        if (params[0] === 'baseline') return { rows: [{ id: 'baseline', metrics: { rugas: { score: 70 }, firmeza: { score: 60 } } }] };
        if (params[0] === 'current') return { rows: [{ id: 'current', metrics: { rugas: { score: 50 }, firmeza: { score: 80 } } }] };
        return { rows: [] };
      }
      return { rows: [] };
    });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/current/compare',
      payload: { baseline_id: 'baseline' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.deltas.rugas).toBe(-20);
    expect(body.deltas.firmeza).toBe(+20);
    expect(body.overall_change).toBeDefined();
  });
});

describe('GET /aesthetic/analyses/:id/export.pdf', () => {
  test('retorna 200 + Content-Type application/pdf + corpo iniciando com %PDF', async () => {
    const app = await buildApp();
    app.pg.query.mockImplementation(async (sql, params) => {
      if (/SELECT \* FROM aesthetic_analyses/i.test(sql)) {
        return { rows: [{ id: 'a-pdf', subject_id: 'sub1', analysis_type: 'facial', status: 'done', metrics: {}, result: {} }] };
      }
      if (/SELECT id, name FROM tenants/i.test(sql)) {
        return { rows: [{ id: 't1', name: 'Clinica PDF Test' }] };
      }
      if (/SELECT id, name, birth_date, sex FROM subjects/i.test(sql)) {
        return { rows: [{ id: 'sub1', name: 'Paciente Teste', birth_date: '1985-01-15', sex: 'F' }] };
      }
      return { rows: [] };
    });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/analyses/a-pdf/export.pdf' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.body.startsWith('%PDF')).toBe(true);
  });

  test('404 para análise inexistente', async () => {
    const app = await buildApp();
    app.pg.query.mockImplementation(async (sql) => {
      if (/SELECT \* FROM aesthetic_analyses/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/analyses/nao-existe/export.pdf' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('Análise não encontrada');
  });

  test('500 BAD_PDF_GENERATION quando buildAnalysisPDF lanca erro', async () => {
    const { buildAnalysisPDF } = require('../../src/services/aesthetic-pdf-export');
    buildAnalysisPDF.mockRejectedValueOnce(new Error('pdf render failed'));
    const app = await buildApp();
    app.pg.query.mockImplementation(async (sql) => {
      if (/SELECT \* FROM aesthetic_analyses/i.test(sql)) {
        return { rows: [{ id: 'a-err', subject_id: 'sub1', analysis_type: 'facial', status: 'done', metrics: {}, result: {} }] };
      }
      return { rows: [] };
    });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/analyses/a-err/export.pdf' });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('BAD_PDF_GENERATION');
  });
});
