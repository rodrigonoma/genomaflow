'use strict';
const { randomUUID } = require('crypto');
const { redactPiiFromImage } = require('../../imaging/redactor');
const { redactPiiInTextLayerPdf } = require('../../imaging/pdf-text-redactor');
const { uploadFile, getSignedDownloadUrl } = require('../../storage/s3');

const ADMIN_ONLY = async function (request, reply) {
  if (request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Chat entre tenants é restrito a admins.' });
  }
};

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/jpg'];
const TEMP_PREFIX = 'inter-tenant-chat-redact';

module.exports = async function (fastify) {
  /**
   * POST /inter-tenant-chat/images/redact
   *
   * Body: { filename, mime_type, data_base64 }
   * Response: {
   *   redact_id: string,
   *   original_url: string (signed URL, TTL 30min),
   *   redacted_url: string (signed URL, TTL 30min),
   *   regions: Array<{x,y,w,h,kind,text,confidence}>,
   *   width: number,
   *   height: number,
   *   engine: 'tesseract+regex' | 'tesseract+haiku',
   *   ocr_word_count: number
   * }
   *
   * Arquivos temp no S3 com prefix inter-tenant-chat-redact/ (lifecycle 1h na
   * bucket — depois do prazo, objetos somem automaticamente).
   *
   * Rate limit: 10 redações/hora por usuário (Tesseract é CPU-intensivo e OpenAI
   * tem custo).
   */
  fastify.post('/redact', {
    preHandler: [fastify.authenticate, ADMIN_ONLY],
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { filename, mime_type, data_base64 } = request.body || {};

    // ── Validação de input ──
    if (!data_base64 || typeof data_base64 !== 'string') {
      return reply.status(400).send({ error: 'data_base64 obrigatório' });
    }
    if (!ALLOWED_MIMES.includes(mime_type)) {
      return reply.status(400).send({ error: 'Apenas PNG e JPEG aceitos pra redação' });
    }

    let buffer;
    try {
      buffer = Buffer.from(data_base64, 'base64');
    } catch (_) {
      return reply.status(400).send({ error: 'data_base64 inválido' });
    }
    if (buffer.length > MAX_BYTES) {
      return reply.status(400).send({ error: 'Imagem maior que 10MB' });
    }

    // ── Pipeline de OCR + classificação + redação ──
    let result;
    try {
      result = await redactPiiFromImage(buffer);
    } catch (err) {
      request.log.error({ err }, 'redact-image: pipeline failed');
      return reply.status(500).send({
        error: 'Falha ao processar a imagem. Tente novamente ou anonimize manualmente antes de enviar.',
      });
    }

    // ── Metadata da imagem pro front dimensionar canvas ──
    let width = 0, height = 0;
    try {
      const sharp = require('sharp');
      const meta = await sharp(buffer).metadata();
      width = meta.width || 0;
      height = meta.height || 0;
    } catch (_) {}

    // ── Upload das duas versões em S3 temp ──
    const redactId = randomUUID();
    const safeName = (filename || 'image').replace(/[^\w.-]/g, '_').slice(0, 80);
    const keyOriginal = `${TEMP_PREFIX}/${tenant_id}/${redactId}/original-${safeName}`;
    const keyRedacted = `${TEMP_PREFIX}/${tenant_id}/${redactId}/redacted-${safeName}`;

    try {
      await uploadFile(keyOriginal, buffer, mime_type);
      await uploadFile(keyRedacted, result.redactedBuffer, mime_type);
    } catch (err) {
      request.log.error({ err }, 'redact-image: S3 upload failed');
      return reply.status(500).send({ error: 'Falha ao armazenar a imagem temporariamente.' });
    }

    const [originalUrl, redactedUrl] = await Promise.all([
      getSignedDownloadUrl(keyOriginal, 1800),  // 30 min
      getSignedDownloadUrl(keyRedacted, 1800),
    ]);

    // Log pra analytics (sem dado sensível — só stats)
    request.log.info({
      tenant_id, user_id,
      redact_id: redactId,
      regions_count: result.regions.length,
      ocr_words: result.ocrWordCount,
      engine: result.engine,
      image_bytes: buffer.length,
    }, 'redact-image: ok');

    return {
      redact_id: redactId,
      original_url: originalUrl,
      redacted_url: redactedUrl,
      regions: result.regions,
      width,
      height,
      engine: result.engine,
      ocr_word_count: result.ocrWordCount,
    };
  });

  /**
   * POST /inter-tenant-chat/images/redact-pdf-text-layer
   *
   * Body: { filename, mime_type='application/pdf', data_base64 }
   *
   * Resposta dependendo do PDF:
   *
   * (1) PDF com text layer (digital, ~95% dos casos):
   *     Retorna o PDF redigido (retângulos pretos sobre os tokens de PII)
   *     e signed URLs pra preview do original e do redigido.
   *     {
   *       has_text_layer: true,
   *       redact_id, original_url, redacted_url,
   *       redacted_data_base64,   // pra reuso direto pelo client (preview)
   *       summary: { name: 3, cpf: 1, ... },
   *       total_regions, page_count
   *     }
   *
   * (2) PDF escaneado (sem text layer suficiente):
   *     Não redige. Front mostra modal de confirmação de responsabilidade.
   *     {
   *       has_text_layer: false,
   *       page_count, reasoning
   *     }
   *
   * Rate limit 10/hora — pdfjs+pdf-lib é leve (1-3s pro PDF típico).
   */
  fastify.post('/redact-pdf-text-layer', {
    preHandler: [fastify.authenticate, ADMIN_ONLY],
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { filename, mime_type, data_base64 } = request.body || {};

    if (!data_base64 || typeof data_base64 !== 'string') {
      return reply.status(400).send({ error: 'data_base64 obrigatório' });
    }
    if (mime_type !== 'application/pdf') {
      return reply.status(400).send({ error: 'Apenas PDF aceito neste endpoint' });
    }

    let buffer;
    try { buffer = Buffer.from(data_base64, 'base64'); }
    catch (_) { return reply.status(400).send({ error: 'data_base64 inválido' }); }

    if (buffer.length > MAX_BYTES) {
      return reply.status(400).send({ error: 'PDF maior que 10MB' });
    }

    let result;
    try {
      result = await redactPiiInTextLayerPdf(buffer);
    } catch (err) {
      request.log.error({ err }, 'redact-pdf-text-layer: pipeline failed');
      return reply.status(500).send({
        error: 'Falha ao processar o PDF. Tente novamente.',
      });
    }

    if (!result.hasTextLayer) {
      request.log.info({
        tenant_id, user_id,
        page_count: result.pageCount,
        reasoning: result.reasoning,
      }, 'redact-pdf-text-layer: scanned (no text)');
      return {
        has_text_layer: false,
        page_count: result.pageCount,
        reasoning: result.reasoning,
      };
    }

    // PDF com text layer — sobe original + redigido em S3 temp pra preview
    const redactId = randomUUID();
    const safeName = (filename || 'document').replace(/[^\w.-]/g, '_').slice(0, 80);
    const keyOriginal = `${TEMP_PREFIX}/${tenant_id}/${redactId}/original-${safeName}`;
    const keyRedacted = `${TEMP_PREFIX}/${tenant_id}/${redactId}/redacted-${safeName}`;

    try {
      await Promise.all([
        uploadFile(keyOriginal, buffer, 'application/pdf'),
        uploadFile(keyRedacted, result.redactedBuffer, 'application/pdf'),
      ]);
    } catch (err) {
      request.log.error({ err }, 'redact-pdf-text-layer: S3 upload failed');
      return reply.status(500).send({ error: 'Falha ao armazenar PDF temporariamente.' });
    }

    const [originalUrl, redactedUrl] = await Promise.all([
      getSignedDownloadUrl(keyOriginal, 1800),
      getSignedDownloadUrl(keyRedacted, 1800),
    ]);

    request.log.info({
      tenant_id, user_id,
      redact_id: redactId,
      filename: safeName,
      page_count: result.pageCount,
      total_regions: result.totalRegions,
      summary: result.summary,
      pdf_bytes_in: buffer.length,
      pdf_bytes_out: result.redactedBuffer.length,
    }, 'redact-pdf-text-layer: ok');

    return {
      has_text_layer: true,
      redact_id: redactId,
      original_url: originalUrl,
      redacted_url: redactedUrl,
      redacted_data_base64: result.redactedBuffer.toString('base64'),
      summary: result.summary,
      total_regions: result.totalRegions,
      page_count: result.pageCount,
    };
  });
};
