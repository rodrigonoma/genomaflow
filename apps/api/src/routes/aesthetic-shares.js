'use strict';

/**
 * Routes /aesthetic/analyses/:id/share + /export-patient.pdf (V2 Fase 4)
 *
 * - GET  /aesthetic/analyses/:id/export-patient.pdf    download direto
 * - POST /aesthetic/analyses/:id/share                 envia por email/whatsapp
 *
 * PDF é cacheado em S3 — múltiplos shares da mesma análise não regeneram.
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase4-design.md §5
 */

const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { getDetail } = require('../services/aesthetic-analyses');
const {
  createShare, markSent, markFailed, findCachedPdfKey,
} = require('../services/aesthetic-analysis-shares');
const { buildPatientPDF } = require('../services/aesthetic-pdf-export-patient');
const { buildPatientHTML } = require('../services/aesthetic-html-export-patient');
const { uploadPhoto, signedUrlFor } = require('../services/aesthetic-s3');
const { sendEmail } = require('../mailer');
const { sendDocument, normalizePhone } = require('../services/whatsapp-client');

const PATIENT_PDF_PREFIX = 'aesthetic-patient-pdf';
const PDF_URL_TTL_SECONDS = 7 * 24 * 3600; // 7 dias (WhatsApp precisa abrir)

// Validação simples de email (RFC 5322 lite)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Garante PDF gerado e armazenado no S3. Retorna { s3Key, presignedUrl }.
 * Idempotente: usa cache do findCachedPdfKey se já existe.
 */
async function ensurePatientPdf(fastify, request, { tenantId, analysis }) {
  // 1. Tenta cache
  const cachedKey = await findCachedPdfKey(fastify.pg, {
    tenantId, analysisId: analysis.id,
  });
  let s3Key = cachedKey;

  if (!s3Key) {
    // 2. Gera novo PDF
    const { rows: tRows } = await fastify.pg.query(
      'SELECT id, name FROM tenants WHERE id = $1', [tenantId]);
    const { rows: sRows } = await fastify.pg.query(
      'SELECT id, name FROM subjects WHERE id = $1 AND tenant_id = $2',
      [analysis.subject_id, tenantId]);
    const tenant = tRows[0];
    const subject = sRows[0];

    const metricsObj = analysis.metrics || (analysis.result && analysis.result.metrics) || {};
    const pdfBytes = await buildPatientPDF({
      tenant, subject, analysis,
      metrics: metricsObj,
    });

    s3Key = `${PATIENT_PDF_PREFIX}/${tenantId}/${analysis.id}.pdf`;
    await uploadPhoto({
      key: s3Key,
      body: Buffer.from(pdfBytes),
      contentType: 'application/pdf',
    });
    request.log.info({ s3Key, size: pdfBytes.length }, 'F4 PDF paciente gerado');
  }

  const presignedUrl = await signedUrlFor({
    key: s3Key,
    ttlSeconds: PDF_URL_TTL_SECONDS,
  });
  return { s3Key, presignedUrl };
}

module.exports = async function (fastify) {
  // -------------------------------------------------------------------------
  // GET /aesthetic/analyses/:id/export-patient.pdf — download direto
  // -------------------------------------------------------------------------
  fastify.get('/analyses/:id/export-patient.pdf', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const tenantId = request.user.tenant_id;
    const analysisId = request.params.id;

    const analysis = await getDetail(fastify.pg, analysisId, tenantId);
    if (!analysis) return reply.status(404).send({ error: 'Análise não encontrada' });
    if (analysis.status !== 'done') {
      return reply.status(400).send({
        error: 'ANALYSIS_NOT_DONE',
        message: 'Análise precisa estar concluída antes de gerar PDF do paciente.',
      });
    }

    try {
      const { rows: tRows } = await fastify.pg.query(
        'SELECT id, name FROM tenants WHERE id = $1', [tenantId]);
      const { rows: sRows } = await fastify.pg.query(
        'SELECT id, name FROM subjects WHERE id = $1 AND tenant_id = $2',
        [analysis.subject_id, tenantId]);
      const metricsObj = analysis.metrics || (analysis.result && analysis.result.metrics) || {};
      const pdfBytes = await buildPatientPDF({
        tenant: tRows[0],
        subject: sRows[0],
        analysis,
        metrics: metricsObj,
      });
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="analise-paciente-${analysisId}.pdf"`)
        .send(Buffer.from(pdfBytes));
    } catch (e) {
      request.log.error({ err: e }, 'F4 PDF paciente falhou');
      return reply.status(500).send({ error: 'PATIENT_PDF_FAILED' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /aesthetic/analyses/:id/share — envia por email/whatsapp
  // -------------------------------------------------------------------------
  fastify.post('/analyses/:id/share', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const tenantId = request.user.tenant_id;
    const userId = request.user.user_id;
    const analysisId = request.params.id;

    const body = request.body || {};
    const channels = Array.isArray(body.channels) ? body.channels : [];
    const recipientEmail = (body.recipient_email || '').trim();
    const recipientPhone = (body.recipient_phone || '').trim();
    const customMessage = body.custom_message ? String(body.custom_message).slice(0, 500) : null;

    if (channels.length === 0) {
      return reply.status(400).send({ error: 'CHANNELS_REQUIRED', message: 'channels deve incluir pelo menos email ou whatsapp' });
    }
    if (channels.includes('email') && !EMAIL_RE.test(recipientEmail)) {
      return reply.status(400).send({ error: 'INVALID_EMAIL' });
    }
    if (channels.includes('whatsapp') && !normalizePhone(recipientPhone)) {
      return reply.status(400).send({ error: 'INVALID_PHONE' });
    }

    const analysis = await getDetail(fastify.pg, analysisId, tenantId);
    if (!analysis) return reply.status(404).send({ error: 'Análise não encontrada' });
    if (analysis.status !== 'done') {
      return reply.status(400).send({ error: 'ANALYSIS_NOT_DONE' });
    }

    // Gera/recupera PDF
    let pdfInfo;
    try {
      pdfInfo = await ensurePatientPdf(fastify, request, { tenantId, analysis });
    } catch (e) {
      request.log.error({ err: e }, 'F4 share: ensurePatientPdf falhou');
      return reply.status(500).send({ error: 'PATIENT_PDF_FAILED' });
    }
    const { s3Key: pdfS3Key, presignedUrl: pdfUrl } = pdfInfo;

    // Prepara HTML/text pra email
    const { rows: tRows } = await fastify.pg.query(
      'SELECT name FROM tenants WHERE id = $1', [tenantId]);
    const { rows: sRows } = await fastify.pg.query(
      'SELECT name FROM subjects WHERE id = $1 AND tenant_id = $2',
      [analysis.subject_id, tenantId]);
    const metricsObj = analysis.metrics || (analysis.result && analysis.result.metrics) || {};
    const html = buildPatientHTML({
      tenant: tRows[0],
      subject: sRows[0],
      analysis,
      metrics: metricsObj,
      customMessage,
    });
    const text = `Olá ${sRows[0]?.name || ''}! Sua análise estética está pronta. ` +
                 `Baixe o relatório: ${pdfUrl}`;

    const results = { email: null, whatsapp: null, share_ids: [] };

    // Email
    if (channels.includes('email')) {
      const share = await createShare(fastify.pg, {
        tenantId, analysisId, userId,
        channel: 'email',
        recipient: recipientEmail,
        s3KeyPdf: pdfS3Key,
        customMessage,
      });
      results.share_ids.push(share.id);
      try {
        // HTML inline + link de download no rodapé
        const htmlWithLink = html.replace(
          '</td></tr>',
          `<p style="font-size:13px;line-height:1.6;color:#3a3a44;margin:12px 0;">
            <a href="${pdfUrl}" style="color:#5a4490;text-decoration:underline;">📄 Baixar PDF da análise</a>
            (link válido por 7 dias)
          </p></td></tr>`,
        );
        const resp = await sendEmail({
          to: recipientEmail,
          subject: `Sua análise estética — ${tRows[0]?.name || 'GenomaFlow'}`,
          html: htmlWithLink,
          text,
          pg: fastify.pg,
          log: request.log,
        });
        await markSent(fastify.pg, share.id, resp?.MessageId || null);
        results.email = { sent: true, share_id: share.id, provider_id: resp?.MessageId };
      } catch (err) {
        request.log.warn({ err: err.message }, 'F4 email send falhou');
        await markFailed(fastify.pg, share.id, {
          errorCode: 'EMAIL_SEND_FAIL',
          errorMessage: err.message,
        });
        results.email = { sent: false, share_id: share.id, error: err.message };
      }
    }

    // WhatsApp
    if (channels.includes('whatsapp')) {
      const share = await createShare(fastify.pg, {
        tenantId, analysisId, userId,
        channel: 'whatsapp',
        recipient: recipientPhone,
        s3KeyPdf: pdfS3Key,
        customMessage,
      });
      results.share_ids.push(share.id);
      try {
        const caption = customMessage
          ? `${customMessage}\n\nSua análise estética está pronta.`
          : `Olá! Sua análise estética está pronta.`;
        const resp = await sendDocument({
          phone: recipientPhone,
          mediaUrl: pdfUrl,
          fileName: 'analise-estetica.pdf',
          caption,
          log: request.log,
        });
        await markSent(fastify.pg, share.id, resp.messageId);
        results.whatsapp = { sent: true, share_id: share.id, provider_id: resp.messageId };
      } catch (err) {
        request.log.warn({ err: err.message }, 'F4 whatsapp send falhou');
        await markFailed(fastify.pg, share.id, {
          errorCode: 'WHATSAPP_SEND_FAIL',
          errorMessage: err.message,
        });
        results.whatsapp = { sent: false, share_id: share.id, error: err.message };
      }
    }

    // 207 Multi-Status se algum canal falhou e outro passou; 200 se todos OK
    const allOk = (
      (channels.includes('email') ? results.email?.sent : true) &&
      (channels.includes('whatsapp') ? results.whatsapp?.sent : true)
    );
    const allFailed = (
      (channels.includes('email') ? !results.email?.sent : true) &&
      (channels.includes('whatsapp') ? !results.whatsapp?.sent : true)
    );
    if (allOk) return reply.status(200).send(results);
    if (allFailed) return reply.status(502).send(results);
    return reply.status(207).send(results);
  });
};
