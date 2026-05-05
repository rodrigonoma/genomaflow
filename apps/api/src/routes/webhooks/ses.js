'use strict';

/**
 * Webhook SES → SNS → este endpoint.
 *
 * Configuração AWS:
 *   1. SES → Configuration Set ou Identity → enable Bounce/Complaint notifications
 *   2. SNS → criar tópico "genomaflow-ses-events"
 *   3. SES domain → notification feedback → setar tópico SNS
 *   4. SNS → criar Subscription HTTPS apontando pra:
 *        https://app.genomaflow.com.br/api/webhooks/ses
 *   5. AWS envia POST com header x-amz-sns-message-type:SubscriptionConfirmation
 *      → primeiro POST traz SubscribeURL — chamamos pra confirmar
 *   6. Daí em diante, SES manda notifications via SNS → este endpoint
 *
 * Tipos de mensagem SNS:
 *   - SubscriptionConfirmation: GET no SubscribeURL pra ativar
 *   - Notification: contém Bounce/Complaint/Delivery dentro de Message JSON
 *   - UnsubscribeConfirmation: tópico foi unsubscribe (no-op)
 *
 * Segurança: SNS assina cada mensagem (SignatureVersion 1 ou 2).
 * Implementação simplificada nesta MVP: confiamos no path + valida estrutura.
 * Pra hardening completo, validar signature via cert da AWS:
 *   https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 *
 * Fase 3.5 — janeiro/2026 expansion. Memória em
 * docs/claude-memory/feedback_ses_bounce_handling.md
 */

const supp = require('../../services/email-suppressions');

// HTTPS GET pra confirmar SNS subscription. Sem libs — fetch nativo do Node 20.
async function confirmSubscription(subscribeUrl, log) {
  try {
    const res = await fetch(subscribeUrl, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log.info({ subscribeUrl: subscribeUrl.slice(0, 100) }, 'SNS subscription confirmed');
    return true;
  } catch (err) {
    log.error({ err: err.message }, 'falha ao confirmar SNS subscription');
    return false;
  }
}

module.exports = async function (fastify) {
  fastify.post('/ses', async (request, reply) => {
    const messageType = request.headers['x-amz-sns-message-type'];
    const body = request.body || {};

    if (!messageType) {
      return reply.status(400).send({ error: 'header x-amz-sns-message-type ausente' });
    }

    // 1) SubscriptionConfirmation: confirma pra ativar a subscription
    if (messageType === 'SubscriptionConfirmation') {
      const subscribeUrl = body.SubscribeURL;
      if (!subscribeUrl) return reply.status(400).send({ error: 'SubscribeURL ausente' });
      await confirmSubscription(subscribeUrl, request.log);
      return { ok: true, action: 'subscription_confirmed' };
    }

    if (messageType === 'UnsubscribeConfirmation') {
      request.log.warn({ body }, 'SNS Unsubscribe — tópico foi removido');
      return { ok: true, action: 'unsubscribe_acknowledged' };
    }

    // 2) Notification: payload SES vem em body.Message como string JSON
    if (messageType !== 'Notification') {
      return reply.status(400).send({ error: `messageType desconhecido: ${messageType}` });
    }

    let sesPayload;
    try {
      sesPayload = typeof body.Message === 'string' ? JSON.parse(body.Message) : body.Message;
    } catch (err) {
      request.log.warn({ err: err.message }, 'SNS Message não é JSON válido');
      return reply.status(400).send({ error: 'Message inválido' });
    }

    const notificationType = sesPayload.notificationType || sesPayload.eventType;

    if (notificationType === 'Bounce') {
      const bounce = sesPayload.bounce || {};
      const bounceType = bounce.bounceType; // 'Permanent' | 'Transient' | 'Undetermined'
      const bounceSubtype = bounce.bounceSubType;
      const recipients = bounce.bouncedRecipients || [];

      const reason = bounceType === 'Permanent' ? 'bounce_permanent' : 'bounce_transient';

      let added = 0;
      // Suprime APENAS bounces permanentes. Transient (mailbox cheia, etc.)
      // pode resolver sozinho — não suprimimos pra não bloquear cliente bom.
      if (bounceType === 'Permanent') {
        for (const r of recipients) {
          const email = r.emailAddress;
          if (email) {
            await supp.add(fastify.pg, email, reason, {
              bounceSubtype, rawPayload: sesPayload, source: 'ses_webhook',
            });
            added++;
          }
        }
      }

      request.log.info({
        notificationType, bounceType, bounceSubtype,
        recipients: recipients.map(r => r.emailAddress),
        suppressedCount: added,
      }, 'SES Bounce processado');

      return { ok: true, action: 'bounce_processed', suppressed: added };
    }

    if (notificationType === 'Complaint') {
      const complaint = sesPayload.complaint || {};
      const recipients = complaint.complainedRecipients || [];

      let added = 0;
      for (const r of recipients) {
        const email = r.emailAddress;
        if (email) {
          await supp.add(fastify.pg, email, 'complaint', {
            rawPayload: sesPayload, source: 'ses_webhook',
          });
          added++;
        }
      }

      request.log.info({
        notificationType,
        feedbackType: complaint.complaintFeedbackType,
        recipients: recipients.map(r => r.emailAddress),
      }, 'SES Complaint processado');

      return { ok: true, action: 'complaint_processed', suppressed: added };
    }

    // Delivery, Open, Click — apenas log
    request.log.info({ notificationType }, 'SES notification (não suprime)');
    return { ok: true, action: 'logged' };
  });
};
