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
