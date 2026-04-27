'use strict';
/**
 * Unit tests pra validação de body do POST /conversations/:id/messages.
 *
 * Foco: validações que rodam ANTES de qualquer query DB ou upload S3 — são
 * as únicas testáveis sem ambiente integrado. Cobertura específica do
 * `pdf.user_confirmed_scanned` (campo novo da V2 PDF redaction) + image
 * mime_type whitelist + ai_analysis_card shape.
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

  // Stub pg — `isTenantSuspended` chama pg.query(...) e checa rows[0].n
  app.decorate('pg', {
    query: jest.fn(async () => ({ rows: [{ n: 0 }] })),
  });

  return app;
}

async function makeApp() {
  const app = buildApp();
  await app.register(require('../../../src/routes/inter-tenant-chat/messages'), {
    prefix: '/inter-tenant-chat',
  });
  await app.ready();
  return app;
}

describe('POST /conversations/:id/messages — validation', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  const post = (body) => app.inject({
    method: 'POST',
    url: '/inter-tenant-chat/conversations/conv1/messages',
    payload: body,
  });

  describe('empty body', () => {
    test('body vazio sem attachment → 400', async () => {
      const res = await post({});
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/body ou attachment obrigatório/);
    });

    test('body só com whitespace e sem attachment → 400', async () => {
      const res = await post({ body: '   \n\t  ' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('body length', () => {
    test('body acima de 5000 chars → 400', async () => {
      const res = await post({ body: 'a'.repeat(5001) });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/muito longo/);
    });
  });

  describe('ai_analysis_card', () => {
    test('sem exam_id → 400', async () => {
      const res = await post({ ai_analysis_card: { agent_types: ['cardiovascular'] } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/exam_id obrigatório/);
    });

    test('exam_id não-string → 400', async () => {
      const res = await post({ ai_analysis_card: { exam_id: 123, agent_types: ['x'] } });
      expect(res.statusCode).toBe(400);
    });

    test('agent_types vazio → 400', async () => {
      const res = await post({ ai_analysis_card: { exam_id: 'e1', agent_types: [] } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/agent_types deve ser array não-vazio/);
    });

    test('agent_types não-array → 400', async () => {
      const res = await post({ ai_analysis_card: { exam_id: 'e1', agent_types: 'cardio' } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('pdf', () => {
    test('pdf sem filename → 400', async () => {
      const res = await post({ pdf: { data_base64: 'JVBE' } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/filename/);
    });

    test('pdf sem data_base64 → 400', async () => {
      const res = await post({ pdf: { filename: 'a.pdf' } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/data_base64/);
    });

    test('pdf.mime_type não pdf → 400', async () => {
      const res = await post({ pdf: { filename: 'a.pdf', data_base64: 'X', mime_type: 'text/plain' } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/somente PDF/);
    });

    // user_confirmed_scanned — campo novo da V2 (modal LGPD pra PDF escaneado).
    // strict equality === true. Qualquer outro valor (truthy ou falsy) é rejeitado
    // pra evitar bypass acidental do PII check via `1`, `"yes"`, `{flag:true}`.
    test('pdf.user_confirmed_scanned = "true" (string) → 400', async () => {
      const res = await post({ pdf: { filename: 'a.pdf', data_base64: 'X', user_confirmed_scanned: 'true' } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/user_confirmed_scanned deve ser true/);
    });

    test('pdf.user_confirmed_scanned = 1 → 400', async () => {
      const res = await post({ pdf: { filename: 'a.pdf', data_base64: 'X', user_confirmed_scanned: 1 } });
      expect(res.statusCode).toBe(400);
    });

    test('pdf.user_confirmed_scanned = false → 400', async () => {
      const res = await post({ pdf: { filename: 'a.pdf', data_base64: 'X', user_confirmed_scanned: false } });
      expect(res.statusCode).toBe(400);
    });

    test('pdf.user_confirmed_scanned ausente → não rejeita por esse campo (segue caminho normal)', async () => {
      // Sem flag, validação passa pra próxima etapa (decode base64 → erro de buffer vazio)
      // O importante é que a mensagem de erro NÃO seja "user_confirmed_scanned deve ser true".
      const res = await post({ pdf: { filename: 'a.pdf', data_base64: 'AAAA' } });
      expect(res.json().error || '').not.toMatch(/user_confirmed_scanned/);
    });
  });

  describe('image', () => {
    test('image sem filename → 400', async () => {
      const res = await post({ image: { data_base64: 'X', mime_type: 'image/png', user_confirmed_anonymized: true } });
      expect(res.statusCode).toBe(400);
    });

    test('image sem data_base64 → 400', async () => {
      const res = await post({ image: { filename: 'x.png', mime_type: 'image/png', user_confirmed_anonymized: true } });
      expect(res.statusCode).toBe(400);
    });

    test('image.mime_type fora da whitelist (gif) → 400', async () => {
      const res = await post({
        image: { filename: 'x.gif', data_base64: 'X', mime_type: 'image/gif', user_confirmed_anonymized: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/image\/png ou image\/jpeg/);
    });

    test('image.mime_type=image/jpeg aceito (V2 default)', async () => {
      // Valida que JPEG passa o validador (V2 imagem agora exporta JPEG q=0.85).
      // Vai falhar mais adiante por outras razões mas não pela validação de mime_type.
      const res = await post({
        image: { filename: 'x.jpg', data_base64: 'AAAA', mime_type: 'image/jpeg', user_confirmed_anonymized: true },
      });
      expect(res.json().error || '').not.toMatch(/mime_type/);
    });

    test('image.user_confirmed_anonymized ausente → 400', async () => {
      const res = await post({
        image: { filename: 'x.png', data_base64: 'X', mime_type: 'image/png' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/user_confirmed_anonymized/);
    });

    test('image.user_confirmed_anonymized = "true" string → 400 (strict equality)', async () => {
      const res = await post({
        image: { filename: 'x.png', data_base64: 'X', mime_type: 'image/png', user_confirmed_anonymized: 'true' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('image.user_confirmed_anonymized = 1 → 400', async () => {
      const res = await post({
        image: { filename: 'x.png', data_base64: 'X', mime_type: 'image/png', user_confirmed_anonymized: 1 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('suspension gate', () => {
    test('tenant suspenso → 403', async () => {
      const localApp = buildApp();
      // Query 1: SELECT kind (não é master_broadcast → segue gate)
      // Query 2: isTenantSuspended → 5 reporters → suspenso
      localApp.pg.query
        .mockResolvedValueOnce({ rows: [{ kind: 'tenant_to_tenant' }] })
        .mockResolvedValueOnce({ rows: [{ n: 5 }] });
      await localApp.register(require('../../../src/routes/inter-tenant-chat/messages'), {
        prefix: '/inter-tenant-chat',
      });
      await localApp.ready();

      const res = await localApp.inject({
        method: 'POST',
        url: '/inter-tenant-chat/conversations/conv1/messages',
        payload: { body: 'oi' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/suspensa/i);
      await localApp.close();
    });

    test('master_broadcast: tenant NÃO pode responder — 403 informativo', async () => {
      // Mudança 2026-04-27: canal master é informativo apenas. Tenants
      // devem usar "Reportar erro" / "Sugerir melhoria" pra escalar.
      const localApp = buildApp();
      localApp.pg.query.mockResolvedValueOnce({ rows: [{ kind: 'master_broadcast' }] });
      await localApp.register(require('../../../src/routes/inter-tenant-chat/messages'), {
        prefix: '/inter-tenant-chat',
      });
      await localApp.ready();

      const res = await localApp.inject({
        method: 'POST',
        url: '/inter-tenant-chat/conversations/conv1/messages',
        payload: { body: 'oi pro admin' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/Canal informativo/);
      expect(res.json().hint).toMatch(/Reportar erro|Sugerir melhoria/);

      // isTenantSuspended NÃO foi chamado (curto-circuito antes)
      const calls = localApp.pg.query.mock.calls;
      const suspensionCheckCall = calls.find(c =>
        typeof c[0] === 'string' && c[0].toLowerCase().includes('chat_reports')
      );
      expect(suspensionCheckCall).toBeUndefined();
      await localApp.close();
    });
  });
});
