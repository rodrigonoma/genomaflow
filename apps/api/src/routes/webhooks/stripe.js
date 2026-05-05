'use strict';

const stripeClient = require('../../services/stripe-client');
const {
  handleCheckoutCompleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleSubscriptionDeleted,
} = require('../../services/billing-events');

module.exports = async function webhookRoutes(fastify) {
  fastify.post('/webhooks/stripe', {
    config: { rawBody: true }, // marker pra parser global
  }, async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (!signature) {
      return reply.status(400).send({ error: 'Missing Stripe-Signature header' });
    }

    let event;
    try {
      const rawBody = request.rawBody;
      if (!rawBody) {
        fastify.log.error('webhook: rawBody undefined — content type parser não executou');
        return reply.status(500).send({ error: 'rawBody not available' });
      }
      event = stripeClient.constructEvent(rawBody, signature);
    } catch (err) {
      fastify.log.warn({ err: err.message }, 'webhook signature inválida');
      return reply.status(400).send({ error: 'Invalid signature' });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(fastify.pg, event, fastify.redis);
          break;
        case 'invoice.paid':
          await handleInvoicePaid(fastify.pg, event, fastify.redis);
          break;
        case 'invoice.payment_failed':
          await handleInvoicePaymentFailed(fastify.pg, event, fastify.redis);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(fastify.pg, event, fastify.redis);
          break;
        default:
          // Stripe envia ~50 tipos de evento; ignoramos os que não interessam
          fastify.log.debug({ type: event.type }, 'evento ignorado');
      }
    } catch (err) {
      fastify.log.error({ err: err.message, eventType: event.type, eventId: event.id }, 'webhook handler erro');
      // Retorna 500 pra Stripe retentar (até 3 dias). Idempotência cobre dups.
      return reply.status(500).send({ error: 'Handler failed' });
    }

    return reply.status(200).send({ received: true });
  });
};
