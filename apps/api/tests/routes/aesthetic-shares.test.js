'use strict';

const { describe, test, expect } = require('@jest/globals');
const Fastify = require('fastify');

// Mocks de IO externos
jest.mock('../../src/services/aesthetic-s3', () => ({
  uploadPhoto: jest.fn(async ({ key }) => ({ s3_key: key })),
  signedUrlFor: jest.fn(async ({ key }) => `https://s3.example/${key}?signed=1`),
}));

const mockSendEmail = jest.fn();
jest.mock('../../src/mailer', () => ({
  sendEmail: (...args) => mockSendEmail(...args),
}));

const mockSendDocument = jest.fn();
jest.mock('../../src/services/whatsapp-client', () => {
  const real = jest.requireActual('../../src/services/whatsapp-client');
  return {
    ...real,
    sendDocument: (...args) => mockSendDocument(...args),
  };
});

jest.mock('../../src/db/tenant', () => ({
  withTenant: jest.fn(async (pg, _t, fn) => fn(pg)),
}));

const ANALYSIS_DONE = {
  id: 'a-1', tenant_id: 't1', subject_id: 'sub1',
  status: 'done', tier: 'advanced',
  metrics: {
    aggregate_skin_texture: { score: 75, source: 'aggregate' },
    aggregate_spots: { score: 55, source: 'aggregate' },
  },
};

async function buildApp({
  role = 'admin', moduleName = 'estetica',
  analysisStatus = 'done',
  cachedPdfKey = null,
} = {}) {
  mockSendEmail.mockReset();
  mockSendDocument.mockReset();

  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module: moduleName };
  });
  app.decorate('pg', {
    query: jest.fn(async (sql, params) => {
      // getDetail analyses
      if (/SELECT \* FROM aesthetic_analyses/i.test(sql)) {
        if (params[0] === 'not-found') return { rows: [] };
        return { rows: [{ ...ANALYSIS_DONE, id: params[0], status: analysisStatus }] };
      }
      // tenants
      if (/FROM tenants/i.test(sql)) {
        return { rows: [{ id: 't1', name: 'Clínica Demo' }] };
      }
      // subjects
      if (/FROM subjects/i.test(sql)) {
        return { rows: [{ id: 'sub1', name: 'Ana Silva' }] };
      }
      // findCachedPdfKey
      if (/SELECT s3_key_pdf[\s\S]+FROM aesthetic_analysis_shares/i.test(sql)) {
        return { rows: cachedPdfKey ? [{ s3_key_pdf: cachedPdfKey }] : [] };
      }
      // createShare INSERT
      if (/INSERT INTO aesthetic_analysis_shares/i.test(sql)) {
        return { rows: [{
          id: 'share-' + params[3], analysis_id: params[1], channel: params[3],
          recipient: params[4], status: 'queued', sent_at: 'now',
        }] };
      }
      // markSent/markFailed UPDATE
      if (/UPDATE aesthetic_analysis_shares/i.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }),
  });
  app.register(require('../../src/routes/aesthetic-shares'), { prefix: '/api/aesthetic' });
  return app;
}

// ---------------------------------------------------------------------------
// GET /aesthetic/analyses/:id/export-patient.pdf
// ---------------------------------------------------------------------------

describe('GET /aesthetic/analyses/:id/export-patient.pdf', () => {
  test('200 retorna PDF buffer válido', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/analyses/a-1/export-patient.pdf' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.rawPayload[0]).toBe(0x25); // %
    expect(res.rawPayload[1]).toBe(0x50); // P
  });

  test('404 análise inexistente', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/analyses/not-found/export-patient.pdf' });
    expect(res.statusCode).toBe(404);
  });

  test('400 análise não-done', async () => {
    const app = await buildApp({ analysisStatus: 'pending' });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/analyses/a-1/export-patient.pdf' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ANALYSIS_NOT_DONE');
  });

  test('403 módulo human', async () => {
    const app = await buildApp({ moduleName: 'human' });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/analyses/a-1/export-patient.pdf' });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /aesthetic/analyses/:id/share
// ---------------------------------------------------------------------------

describe('POST /aesthetic/analyses/:id/share', () => {
  test('happy path email+whatsapp → 200', async () => {
    const app = await buildApp();
    mockSendEmail.mockResolvedValueOnce({ MessageId: 'ses-xyz' });
    mockSendDocument.mockResolvedValueOnce({ messageId: 'zapi-abc', status: 'sent' });

    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/share',
      payload: {
        channels: ['email', 'whatsapp'],
        recipient_email: 'paciente@gmail.com',
        recipient_phone: '+5511999998888',
        custom_message: 'Olá!',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email.sent).toBe(true);
    expect(body.email.provider_id).toBe('ses-xyz');
    expect(body.whatsapp.sent).toBe(true);
    expect(body.whatsapp.provider_id).toBe('zapi-abc');
    expect(body.share_ids.length).toBe(2);
  });

  test('400 channels vazio', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/share',
      payload: { channels: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('CHANNELS_REQUIRED');
  });

  test('400 email inválido', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/share',
      payload: { channels: ['email'], recipient_email: 'invalid' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_EMAIL');
  });

  test('400 phone inválido', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/share',
      payload: { channels: ['whatsapp'], recipient_phone: 'abc' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_PHONE');
  });

  test('207 multi-status quando 1 falha', async () => {
    const app = await buildApp();
    mockSendEmail.mockResolvedValueOnce({ MessageId: 'ses-ok' });
    mockSendDocument.mockRejectedValueOnce(new Error('Z-API down'));

    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/share',
      payload: {
        channels: ['email', 'whatsapp'],
        recipient_email: 'p@x.com',
        recipient_phone: '+5511999998888',
      },
    });
    expect(res.statusCode).toBe(207);
    const body = res.json();
    expect(body.email.sent).toBe(true);
    expect(body.whatsapp.sent).toBe(false);
  });

  test('502 quando ambos canais falham', async () => {
    const app = await buildApp();
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP down'));
    mockSendDocument.mockRejectedValueOnce(new Error('Z-API down'));

    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/share',
      payload: {
        channels: ['email', 'whatsapp'],
        recipient_email: 'p@x.com',
        recipient_phone: '+5511999998888',
      },
    });
    expect(res.statusCode).toBe(502);
  });

  test('PDF cacheado não regenera', async () => {
    const app = await buildApp({
      cachedPdfKey: 'aesthetic-patient-pdf/t1/a-1.pdf',
    });
    mockSendEmail.mockResolvedValueOnce({ MessageId: 'ses-ok' });
    const { uploadPhoto } = require('../../src/services/aesthetic-s3');
    uploadPhoto.mockClear();

    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/share',
      payload: { channels: ['email'], recipient_email: 'p@x.com' },
    });
    expect(res.statusCode).toBe(200);
    // Idempotente: uploadPhoto NÃO foi chamado (PDF reutilizado)
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  test('403 módulo human', async () => {
    const app = await buildApp({ moduleName: 'human' });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/share',
      payload: { channels: ['email'], recipient_email: 'p@x.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('400 análise não-done', async () => {
    const app = await buildApp({ analysisStatus: 'pending' });
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/analyses/a-1/share',
      payload: { channels: ['email'], recipient_email: 'p@x.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ANALYSIS_NOT_DONE');
  });
});
