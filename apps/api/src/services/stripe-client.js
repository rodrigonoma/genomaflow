'use strict';

const Stripe = require('stripe');

let _client = null;

/**
 * Lazy singleton — evita instanciar Stripe se STRIPE_SECRET_KEY não está
 * setada (testes sem env por exemplo). Lança erro só quando alguém
 * tenta usar de verdade.
 */
function getClient() {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY não configurada');
  _client = new Stripe(key, {
    apiVersion: '2024-11-20.acacia',
    timeout: 10000,  // 10s — Stripe API é fast, timeout conservador
    maxNetworkRetries: 2,
  });
  return _client;
}

/**
 * Cria Customer no Stripe ou retorna o existente via metadata.tenant_id.
 * Idempotente — busca antes de criar.
 */
async function findOrCreateCustomer({ tenantId, email, name }) {
  const stripe = getClient();
  // Busca por metadata.tenant_id (usamos como chave estável)
  const existing = await stripe.customers.search({
    query: `metadata['tenant_id']:'${tenantId}'`,
    limit: 1,
  });
  if (existing.data.length > 0) return existing.data[0];
  return stripe.customers.create({
    email,
    name,
    metadata: { tenant_id: tenantId },
  });
}

async function createSubscriptionCheckoutSession({ customerId, tenantId, priceId, successUrl, cancelUrl }) {
  const stripe = getClient();
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    payment_method_types: ['card'],
    client_reference_id: tenantId,
    metadata: { tenant_id: tenantId, plan: 'starter' },
    subscription_data: { metadata: { tenant_id: tenantId } },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

async function createTopupCheckoutSession({ customerId, tenantId, credits, unitAmount, paymentMethod, successUrl, cancelUrl }) {
  const stripe = getClient();
  const methods = paymentMethod === 'pix' ? ['pix'] : ['card', 'pix'];
  return stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{
      price_data: {
        currency: 'brl',
        product_data: { name: `Créditos GenomaFlow (${credits})` },
        unit_amount: unitAmount,
      },
      quantity: 1,
    }],
    payment_method_types: methods,
    client_reference_id: tenantId,
    metadata: { tenant_id: tenantId, credits: String(credits), kind: 'topup' },
    expires_at: Math.floor(Date.now() / 1000) + 1800, // 30min — PIX expira
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

async function createPortalSession({ customerId, returnUrl }) {
  const stripe = getClient();
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

/**
 * Valida assinatura do webhook. Retorna o evento parseado ou lança erro.
 * rawBody = Buffer ou string com o body original (não-parseado).
 */
function constructEvent(rawBody, signature) {
  const stripe = getClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET não configurada');
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

module.exports = {
  getClient,
  findOrCreateCustomer,
  createSubscriptionCheckoutSession,
  createTopupCheckoutSession,
  createPortalSession,
  constructEvent,
  // Exposed só pra tests resetarem singleton
  _resetClient: () => { _client = null; },
};
