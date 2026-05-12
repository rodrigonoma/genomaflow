'use strict';

const { describe, test, expect } = require('@jest/globals');
const Fastify = require('fastify');
const multipart = require('@fastify/multipart');

// Mock S3 antes do require da rota
jest.mock('../../src/services/aesthetic-s3', () => ({
  buildKey: jest.fn(({ tenantId, subjectId, photoId, ext = 'jpg' }) => `aesthetic-photos/${tenantId}/${subjectId}/${photoId}.${ext}`),
  uploadPhoto: jest.fn(async ({ key }) => ({ s3_key: key })),
  signedUrlFor: jest.fn(async ({ key }) => `https://s3.example/${key}?signed=1`),
  deletePhoto: jest.fn(async () => ({ deleted: true })),
}));

jest.mock('../../src/db/tenant', () => ({
  withTenant: (pg, tid, fn, opts) => fn(pg),
}));

// Mock aesthetic-auto-crop — padrão spy controlável por teste
const mockAutoCropSensitive = jest.fn();
jest.mock('../../src/services/aesthetic-auto-crop', () => ({
  autoCropSensitive: mockAutoCropSensitive,
}));

// Mock aesthetic-consent — controlável por teste
const mockGetConsent = jest.fn();
jest.mock('../../src/services/aesthetic-consent', () => ({
  getConsent: mockGetConsent,
  createConsent: jest.fn(),
}));

async function buildApp(role = 'admin', module = 'estetica') {
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  const queries = [];
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module };
  });
  app.decorate('pg', {
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/INSERT INTO aesthetic_photos/i.test(sql)) {
        return { rows: [{ id: 'photo-1', s3_key: params[3], photo_type: params[4], is_sensitive: false, taken_at: new Date().toISOString() }] };
      }
      if (/SELECT .* FROM aesthetic_photos/i.test(sql)) {
        if (params[0] === 'photo-yes') return { rows: [{ id: 'photo-yes', s3_key: 'aesthetic-photos/t1/sub1/photo-yes.jpg', tenant_id: 't1', deleted_at: null }] };
        return { rows: [] };
      }
      if (/UPDATE aesthetic_photos SET deleted_at/i.test(sql)) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    }),
  });
  app._queries = queries;
  app.register(require('../../src/routes/aesthetic-photos'), { prefix: '/api/aesthetic' });
  return app;
}

function buildMultipart(boundary, fields, fileField) {
  const lines = [];
  for (const [name, value] of Object.entries(fields)) {
    lines.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  if (fileField) {
    lines.push(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.contentType}\r\n\r\n${fileField.content}\r\n`);
  }
  lines.push(`--${boundary}--\r\n`);
  return Buffer.from(lines.join(''));
}

describe('POST /aesthetic/photos', () => {
  test('aceita upload válido', async () => {
    const app = await buildApp();
    const boundary = 'testboundary123';
    const payload = buildMultipart(boundary,
      { subject_id: 'sub1', photo_type: 'facial_front' },
      { name: 'file', filename: 'photo.jpg', contentType: 'image/jpeg', content: 'fakejpgbytes' }
    );
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/photos',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect([201, 200]).toContain(res.statusCode);
  });

  test('bloqueia 403 pra módulo human', async () => {
    const app = await buildApp('admin', 'human');
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/photos',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /aesthetic/photos/:id/url', () => {
  test('retorna URL signed válida pra foto do tenant', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/photos/photo-yes/url',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).url).toMatch(/^https:/);
  });

  test('404 se photo não existe ou outro tenant', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/aesthetic/photos/photo-other/url',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /aesthetic/photos/:id', () => {
  test('marca deleted_at e retorna 204', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE', url: '/api/aesthetic/photos/photo-yes',
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('POST /aesthetic/photos — auto-crop (F5)', () => {
  beforeEach(() => {
    mockAutoCropSensitive.mockReset();
    // Default: consent with a reinforced region so the consent gate (F5.2) doesn't block these tests
    mockGetConsent.mockResolvedValue({ id: 'c1', created_at: '2026-05-11T00:00:00Z', reinforced_regions: ['breast'] });
  });

  test('is_sensitive=true + auto_crop omitido → autoCropSensitive é chamado, response inclui auto_crop_applied', async () => {
    // Retorna buffer idêntico (simula detecção sem regiões), applied=0
    mockAutoCropSensitive.mockResolvedValue({ buffer: Buffer.from('fakeimg'), applied: 1, regions: [{ type: 'nipple', x: 0.3, y: 0.3, w: 0.1, h: 0.1 }] });

    const app = await buildApp();
    const boundary = 'boundary456';
    const payload = buildMultipart(boundary,
      { subject_id: 'sub1', photo_type: 'breast_front', is_sensitive: 'true' },
      { name: 'file', filename: 'photo.jpg', contentType: 'image/jpeg', content: 'fakejpgbytes' }
    );
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/photos',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect([201, 200]).toContain(res.statusCode);
    expect(mockAutoCropSensitive).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('auto_crop_applied', 1);
  });

  test('is_sensitive=false → autoCropSensitive NÃO é chamado, comportamento legado inalterado', async () => {
    mockAutoCropSensitive.mockResolvedValue({ buffer: Buffer.from('ignored'), applied: 0, regions: [] });

    const app = await buildApp();
    const boundary = 'boundary789';
    const payload = buildMultipart(boundary,
      { subject_id: 'sub1', photo_type: 'facial_front', is_sensitive: 'false' },
      { name: 'file', filename: 'photo.jpg', contentType: 'image/jpeg', content: 'fakejpgbytes' }
    );
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/photos',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect([201, 200]).toContain(res.statusCode);
    expect(mockAutoCropSensitive).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('auto_crop_applied', 0);
  });

  test('is_sensitive=true + auto_crop=false → autoCropSensitive NÃO é chamado', async () => {
    const app = await buildApp();
    const boundary = 'boundary000';
    const payload = buildMultipart(boundary,
      { subject_id: 'sub1', photo_type: 'breast_front', is_sensitive: 'true', auto_crop: 'false' },
      { name: 'file', filename: 'photo.jpg', contentType: 'image/jpeg', content: 'fakejpgbytes' }
    );
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/photos',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect([201, 200]).toContain(res.statusCode);
    expect(mockAutoCropSensitive).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('auto_crop_applied', 0);
  });

  test('autoCropSensitive falha → upload continua, auto_crop_applied=0', async () => {
    mockAutoCropSensitive.mockRejectedValue(new Error('unexpected failure'));

    const app = await buildApp();
    const boundary = 'boundaryErrr';
    const payload = buildMultipart(boundary,
      { subject_id: 'sub1', photo_type: 'breast_front', is_sensitive: 'true' },
      { name: 'file', filename: 'photo.jpg', contentType: 'image/jpeg', content: 'fakejpgbytes' }
    );
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/photos',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    // Upload must succeed despite auto-crop failure
    expect([201, 200]).toContain(res.statusCode);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('auto_crop_applied', 0);
  });

  test('is_sensitive omitido (default) → autoCropSensitive NÃO é chamado', async () => {
    const app = await buildApp();
    const boundary = 'boundaryDef';
    const payload = buildMultipart(boundary,
      { subject_id: 'sub1', photo_type: 'facial_front' },
      { name: 'file', filename: 'photo.jpg', contentType: 'image/jpeg', content: 'fakejpgbytes' }
    );
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/photos',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect([201, 200]).toContain(res.statusCode);
    expect(mockAutoCropSensitive).not.toHaveBeenCalled();
  });
});

describe('POST /aesthetic/photos — reinforced consent gate (F5.2)', () => {
  beforeEach(() => {
    mockAutoCropSensitive.mockReset();
    mockGetConsent.mockReset();
    // Reset S3 mocks so call counts are clean per-test
    const { uploadPhoto } = require('../../src/services/aesthetic-s3');
    uploadPhoto.mockClear();
  });

  test('403 CONSENT_REINFORCED_MISSING — is_sensitive=true sem consent reforçado; autoCrop e S3 NÃO chamados', async () => {
    // No consent on file
    mockGetConsent.mockResolvedValue(null);

    const app = await buildApp();
    const boundary = 'consentGate1';
    const payload = buildMultipart(boundary,
      { subject_id: 'sub1', photo_type: 'breast_front', is_sensitive: 'true' },
      { name: 'file', filename: 'photo.jpg', contentType: 'image/jpeg', content: 'fakejpgbytes' }
    );
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/photos',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('CONSENT_REINFORCED_MISSING');
    // Auto-crop must NOT have been called (fail fast before Vision)
    expect(mockAutoCropSensitive).not.toHaveBeenCalled();
    // S3 upload must NOT have been called
    const { uploadPhoto } = require('../../src/services/aesthetic-s3');
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  test('201 — is_sensitive=true COM consent reforçado existente; auto-crop dispara, upload prossegue', async () => {
    // Consent with at least one reinforced region
    mockGetConsent.mockResolvedValue({ id: 'c1', created_at: '2026-05-11T00:00:00Z', reinforced_regions: ['breast'] });
    mockAutoCropSensitive.mockResolvedValue({ buffer: Buffer.from('croppedimg'), applied: 1, regions: [] });

    const app = await buildApp();
    const boundary = 'consentGate2';
    const payload = buildMultipart(boundary,
      { subject_id: 'sub1', photo_type: 'breast_front', is_sensitive: 'true' },
      { name: 'file', filename: 'photo.jpg', contentType: 'image/jpeg', content: 'fakejpgbytes' }
    );
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/photos',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect([201, 200]).toContain(res.statusCode);
    expect(mockAutoCropSensitive).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('auto_crop_applied', 1);
  });
});
