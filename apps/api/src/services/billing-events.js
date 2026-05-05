'use strict';

const { withTenant } = require('../db/tenant');

const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ONBOARDING_BONUS_CREDITS = 122; // 30% de R$ 199 / R$ 0,49 ≈ 122

/**
 * Insere evento na tabela payment_events com idempotência.
 * Retorna { isNew: boolean, eventRowId } — se isNew=false, evento duplicado, não processar de novo.
 */
async function recordPaymentEvent(client, { gateway, eventId, kind, tenantId, amountBrl = null, creditsGranted = null }) {
  const { rows } = await client.query(
    `INSERT INTO payment_events (gateway, gateway_event_id, kind, tenant_id, amount_brl, credits_granted, processed_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (gateway, gateway_event_id) DO NOTHING
     RETURNING id`,
    [gateway, eventId, kind, tenantId, amountBrl, creditsGranted]
  );
  return { isNew: rows.length > 0, eventRowId: rows[0]?.id ?? null };
}

/**
 * Handler de checkout.session.completed. Despacha por session.mode.
 *
 * @param {object} pg — Fastify postgres pool
 * @param {object} event — Stripe event object
 * @param {object} redis — opcional, pra publish WS event
 */
async function handleCheckoutCompleted(pg, event, redis) {
  const session = event.data.object;
  const tenantId = session.client_reference_id || session.metadata?.tenant_id;
  if (!tenantId) {
    throw new Error(`checkout.session.completed sem tenant_id (session ${session.id})`);
  }

  if (session.mode === 'subscription') {
    return handleSubscriptionCompleted(pg, event, session, tenantId, redis);
  }
  if (session.mode === 'payment') {
    return handleTopupCompleted(pg, event, session, tenantId, redis);
  }
  // outros modes (setup) — no-op
  return { handled: false, reason: `mode=${session.mode} not handled` };
}

async function handleSubscriptionCompleted(pg, event, session, tenantId, redis) {
  return withTenant(pg, MASTER_TENANT_ID, async (client) => {
    const { isNew } = await recordPaymentEvent(client, {
      gateway: 'stripe',
      eventId: event.id,
      kind: 'subscription_started',
      tenantId,
      amountBrl: session.amount_total ? session.amount_total / 100 : 199,
      creditsGranted: ONBOARDING_BONUS_CREDITS,
    });
    if (!isNew) return { handled: true, idempotent: true };

    await client.query(
      `UPDATE tenants SET active = true, billing_status = 'active' WHERE id = $1`,
      [tenantId]
    );

    // Subscription detail — Stripe expand foi pedido no Checkout Session se necessário,
    // aqui pegamos do session.subscription (string ID)
    const subscriptionId = session.subscription;
    await client.query(
      `INSERT INTO subscriptions (tenant_id, gateway, gateway_subscription_id, gateway_customer_id, plan, status)
       VALUES ($1, 'stripe', $2, $3, 'starter', 'active')
       ON CONFLICT (tenant_id) DO UPDATE
       SET gateway_subscription_id = EXCLUDED.gateway_subscription_id,
           gateway_customer_id = EXCLUDED.gateway_customer_id,
           status = 'active',
           updated_at = NOW()`,
      [tenantId, subscriptionId, session.customer]
    );

    await client.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description)
       VALUES ($1, $2, 'subscription_bonus', 'Bônus 30% do onboarding R$ 199 — Stripe')`,
      [tenantId, ONBOARDING_BONUS_CREDITS]
    );

    if (redis) {
      await redis.publish(`billing:activated:${tenantId}`, JSON.stringify({ credits: ONBOARDING_BONUS_CREDITS }));
    }

    return { handled: true, idempotent: false, credits: ONBOARDING_BONUS_CREDITS };
  }, { userId: null, channel: 'system' });
}

async function handleTopupCompleted(pg, event, session, tenantId, redis) {
  const credits = parseInt(session.metadata?.credits, 10);
  if (!credits || credits <= 0) {
    throw new Error(`topup sem metadata.credits válido (session ${session.id})`);
  }

  return withTenant(pg, MASTER_TENANT_ID, async (client) => {
    const { isNew, eventRowId } = await recordPaymentEvent(client, {
      gateway: 'stripe',
      eventId: event.id,
      kind: 'topup',
      tenantId,
      amountBrl: session.amount_total ? session.amount_total / 100 : null,
      creditsGranted: credits,
    });
    if (!isNew) return { handled: true, idempotent: true };

    await client.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description, payment_event_id)
       VALUES ($1, $2, 'topup', 'Compra de créditos — Stripe', $3)`,
      [tenantId, credits, eventRowId]
    );

    if (redis) {
      await redis.publish(`billing:credited:${tenantId}`, JSON.stringify({ credits }));
    }

    return { handled: true, idempotent: false, credits };
  }, { userId: null, channel: 'system' });
}

const RECURRING_BONUS_CREDITS = 122; // mesmo bônus mensal de subscriber ativo

async function handleInvoicePaid(pg, event, redis) {
  const invoice = event.data.object;
  // Subscription invoices têm subscription_id; one-off não
  if (!invoice.subscription) return { handled: false, reason: 'no subscription' };

  const tenantId = invoice.subscription_details?.metadata?.tenant_id || invoice.metadata?.tenant_id;
  if (!tenantId) {
    // Stripe não devolve metadata na invoice por default — buscar via subscription
    // Aqui aceitamos pular (próximo retry vai trazer) ou expandir
    return { handled: false, reason: 'tenant_id ausente — checar expand[]' };
  }

  return withTenant(pg, MASTER_TENANT_ID, async (client) => {
    const { isNew } = await recordPaymentEvent(client, {
      gateway: 'stripe',
      eventId: event.id,
      kind: 'invoice_paid',
      tenantId,
      amountBrl: invoice.amount_paid ? invoice.amount_paid / 100 : null,
      creditsGranted: RECURRING_BONUS_CREDITS,
    });
    if (!isNew) return { handled: true, idempotent: true };

    await client.query(
      `UPDATE subscriptions SET status = 'active', current_period_end = to_timestamp($2), updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId, invoice.lines?.data?.[0]?.period?.end || Math.floor(Date.now() / 1000) + 30 * 86400]
    );

    await client.query(
      `UPDATE tenants SET billing_status = 'active' WHERE id = $1`,
      [tenantId]
    );

    await client.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description)
       VALUES ($1, $2, 'topup_recurring', 'Renovação mensal Stripe')`,
      [tenantId, RECURRING_BONUS_CREDITS]
    );

    if (redis) {
      await redis.publish(`billing:renewed:${tenantId}`, JSON.stringify({ credits: RECURRING_BONUS_CREDITS }));
    }

    return { handled: true, idempotent: false, credits: RECURRING_BONUS_CREDITS };
  }, { userId: null, channel: 'system' });
}

async function handleInvoicePaymentFailed(pg, event, redis) {
  const invoice = event.data.object;
  const tenantId = invoice.subscription_details?.metadata?.tenant_id || invoice.metadata?.tenant_id;
  if (!tenantId) return { handled: false, reason: 'no tenant_id' };

  return withTenant(pg, MASTER_TENANT_ID, async (client) => {
    const { isNew } = await recordPaymentEvent(client, {
      gateway: 'stripe',
      eventId: event.id,
      kind: 'invoice_payment_failed',
      tenantId,
    });
    if (!isNew) return { handled: true, idempotent: true };

    await client.query(
      `UPDATE subscriptions SET status = 'past_due', updated_at = NOW() WHERE tenant_id = $1`,
      [tenantId]
    );
    await client.query(
      `UPDATE tenants SET billing_status = 'past_due' WHERE id = $1`,
      [tenantId]
    );

    if (redis) {
      await redis.publish(`billing:payment_failed:${tenantId}`, JSON.stringify({}));
    }
    return { handled: true, idempotent: false };
  }, { userId: null, channel: 'system' });
}

async function handleSubscriptionDeleted(pg, event, redis) {
  const subscription = event.data.object;
  const tenantId = subscription.metadata?.tenant_id;
  if (!tenantId) return { handled: false, reason: 'no tenant_id' };

  return withTenant(pg, MASTER_TENANT_ID, async (client) => {
    const { isNew } = await recordPaymentEvent(client, {
      gateway: 'stripe',
      eventId: event.id,
      kind: 'subscription_cancelled',
      tenantId,
    });
    if (!isNew) return { handled: true, idempotent: true };

    await client.query(
      `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId]
    );
    await client.query(
      `UPDATE tenants SET active = false, billing_status = 'cancelled' WHERE id = $1`,
      [tenantId]
    );

    if (redis) {
      await redis.publish(`billing:cancelled:${tenantId}`, JSON.stringify({}));
    }
    return { handled: true, idempotent: false };
  }, { userId: null, channel: 'system' });
}

module.exports = {
  handleCheckoutCompleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleSubscriptionDeleted,
  recordPaymentEvent,
  ONBOARDING_BONUS_CREDITS,
  RECURRING_BONUS_CREDITS,
};
