'use strict';

const { VALID_AGENT_TYPES } = require('../constants');

module.exports = async function billingRoutes(fastify) {

  // GET /billing/balance
  fastify.get('/billing/balance', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const res = await fastify.pg.query(
      'SELECT COALESCE(balance, 0) AS balance FROM tenant_credit_balance WHERE tenant_id = $1',
      [tenant_id]
    );
    return { balance: Number(res.rows[0]?.balance ?? 0) };
  });

  // GET /billing/history
  fastify.get('/billing/history', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const page      = Math.max(1, parseInt(request.query.page)  || 1);
    const limit     = Math.min(100, parseInt(request.query.limit) || 20);
    const offset    = (page - 1) * limit;
    const dateFrom  = request.query.date_from || null;
    const dateTo    = request.query.date_to   || null;

    const itemsFilter = `
      AND ($4::date IS NULL OR cl.created_at >= $4::date)
      AND ($5::date IS NULL OR cl.created_at <  ($5::date + INTERVAL '1 day'))
    `;
    const aggFilter = `
      AND ($2::date IS NULL OR cl.created_at >= $2::date)
      AND ($3::date IS NULL OR cl.created_at <  ($3::date + INTERVAL '1 day'))
    `;

    const [itemsRes, countRes, summaryRes] = await Promise.all([
      fastify.pg.query(
        `SELECT cl.id, cl.amount::int AS amount, cl.kind, cl.description,
                cl.exam_id, cl.created_at,
                s.name AS subject_name,
                split_part(e.file_path, '/', -1) AS file_name
         FROM credit_ledger cl
         LEFT JOIN exams    e ON e.id = cl.exam_id
         LEFT JOIN subjects s ON s.id = e.subject_id
         WHERE cl.tenant_id = $1 ${itemsFilter}
         ORDER BY cl.created_at DESC LIMIT $2 OFFSET $3`,
        [tenant_id, limit, offset, dateFrom, dateTo]
      ),
      fastify.pg.query(
        `SELECT COUNT(*) FROM credit_ledger cl
         WHERE cl.tenant_id = $1 ${aggFilter}`,
        [tenant_id, dateFrom, dateTo]
      ),
      fastify.pg.query(
        `SELECT
           COALESCE(SUM(cl.amount) FILTER (WHERE cl.amount < 0), 0)::int AS credits_consumed,
           COALESCE(SUM(cl.amount) FILTER (WHERE cl.amount > 0), 0)::int AS credits_added,
           COUNT(*) FILTER (WHERE cl.kind = 'agent_usage')::int         AS agent_events,
           COUNT(*) FILTER (WHERE cl.kind = 'ocr_usage')::int           AS ocr_events
         FROM credit_ledger cl
         WHERE cl.tenant_id = $1 ${aggFilter}`,
        [tenant_id, dateFrom, dateTo]
      )
    ]);

    const s = summaryRes.rows[0];
    return {
      items:   itemsRes.rows,
      total:   parseInt(countRes.rows[0].count),
      page,
      limit,
      summary: {
        credits_consumed: s.credits_consumed,
        credits_added:    s.credits_added,
        agent_events:     s.agent_events,
        ocr_events:       s.ocr_events
      }
    };
  });

  // GET /billing/specialties
  fastify.get('/billing/specialties', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const res = await fastify.pg.query(
      'SELECT agent_type FROM tenant_specialties WHERE tenant_id = $1 ORDER BY agent_type',
      [tenant_id]
    );
    return { specialties: res.rows.map(r => r.agent_type) };
  });

  // PUT /billing/specialties
  fastify.put('/billing/specialties', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Admin only' });

    const { specialties } = request.body;
    if (!Array.isArray(specialties) || specialties.length === 0) {
      return reply.status(400).send({ error: 'Mínimo 1 especialidade obrigatória' });
    }

    const invalid = specialties.filter(s => !VALID_AGENT_TYPES.includes(s));
    if (invalid.length > 0) {
      return reply.status(400).send({ error: `Especialidades inválidas: ${invalid.join(', ')}` });
    }

    const client = await fastify.pg.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM tenant_specialties WHERE tenant_id = $1', [tenant_id]);
      for (const agent_type of specialties) {
        await client.query(
          'INSERT INTO tenant_specialties (tenant_id, agent_type) VALUES ($1, $2)',
          [tenant_id, agent_type]
        );
      }
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /billing/checkout/subscription — admin-only
  // Cria Stripe Customer (lazy) + Checkout Session subscription.
  // NÃO concede crédito sincrono — webhook checkout.session.completed faz isso.
  fastify.post('/billing/checkout/subscription', {
    preHandler: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') {
      return reply.status(403).send({ error: 'Admin only' });
    }

    const stripeClient = require('../services/stripe-client');
    const priceId = process.env.STRIPE_PRICE_SUBSCRIPTION;
    if (!priceId) {
      fastify.log.error('STRIPE_PRICE_SUBSCRIPTION não configurada');
      return reply.status(500).send({ error: 'Pagamento indisponível — configuração ausente' });
    }
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.genomaflow.com.br';

    // Pega dados do tenant pra criar Customer
    const { rows } = await fastify.pg.query(
      `SELECT t.name, u.email FROM tenants t
       JOIN users u ON u.tenant_id = t.id AND u.role = 'admin'
       WHERE t.id = $1 LIMIT 1`,
      [tenant_id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Tenant não encontrado' });

    const customer = await stripeClient.findOrCreateCustomer({
      tenantId: tenant_id,
      email: rows[0].email,
      name: rows[0].name,
    });

    // Persiste customer_id pra reuso futuro
    await fastify.pg.query(
      `INSERT INTO subscriptions (tenant_id, gateway, gateway_customer_id, plan, status)
       VALUES ($1, 'stripe', $2, 'starter', 'pending_payment')
       ON CONFLICT (tenant_id) DO UPDATE
       SET gateway_customer_id = EXCLUDED.gateway_customer_id, updated_at = NOW()`,
      [tenant_id, customer.id]
    );

    const session = await stripeClient.createSubscriptionCheckoutSession({
      customerId: customer.id,
      tenantId: tenant_id,
      priceId,
      successUrl: `${frontendUrl}/login?activated=true`,
      cancelUrl: `${frontendUrl}/onboarding?cancelled=true`,
    });

    return { url: session.url, session_id: session.id };
  });

  // POST /billing/checkout/topup — admin-only — { credits, payment_method }
  fastify.post('/billing/checkout/topup', {
    preHandler: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Admin only' });

    const { VALID_CREDIT_PACKAGES, PRICE_BY_PACK, VALID_PAYMENT_METHODS } = require('../constants');
    const credits = parseInt(request.body?.credits, 10);
    const paymentMethod = request.body?.payment_method || 'card';

    if (!VALID_CREDIT_PACKAGES.includes(credits)) {
      return reply.status(400).send({ error: `credits inválido — use ${VALID_CREDIT_PACKAGES.join('|')}` });
    }
    if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return reply.status(400).send({ error: `payment_method inválido — use ${VALID_PAYMENT_METHODS.join('|')}` });
    }

    const unitAmount = PRICE_BY_PACK[credits];
    const stripeClient = require('../services/stripe-client');
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.genomaflow.com.br';

    const { rows } = await fastify.pg.query(
      `SELECT t.name, u.email, s.gateway_customer_id
       FROM tenants t
       JOIN users u ON u.tenant_id = t.id AND u.role = 'admin'
       LEFT JOIN subscriptions s ON s.tenant_id = t.id
       WHERE t.id = $1 LIMIT 1`,
      [tenant_id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Tenant não encontrado' });

    let customerId = rows[0].gateway_customer_id;
    if (!customerId) {
      const customer = await stripeClient.findOrCreateCustomer({
        tenantId: tenant_id,
        email: rows[0].email,
        name: rows[0].name,
      });
      customerId = customer.id;
      await fastify.pg.query(
        `INSERT INTO subscriptions (tenant_id, gateway, gateway_customer_id, plan, status)
         VALUES ($1, 'stripe', $2, 'topup_only', 'pending_payment')
         ON CONFLICT (tenant_id) DO UPDATE
         SET gateway_customer_id = EXCLUDED.gateway_customer_id, updated_at = NOW()`,
        [tenant_id, customerId]
      );
    }

    const session = await stripeClient.createTopupCheckoutSession({
      customerId,
      tenantId: tenant_id,
      credits,
      unitAmount,
      paymentMethod,
      successUrl: `${frontendUrl}/clinic/billing?topup=success`,
      cancelUrl: `${frontendUrl}/clinic/billing?topup=cancelled`,
    });

    return { url: session.url, session_id: session.id };
  });

  // POST /billing/portal — admin-only — abre Customer Portal pra gerenciar/cancelar
  fastify.post('/billing/portal', {
    preHandler: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Admin only' });

    const { rows } = await fastify.pg.query(
      'SELECT gateway_customer_id FROM subscriptions WHERE tenant_id = $1 LIMIT 1',
      [tenant_id]
    );
    const customerId = rows[0]?.gateway_customer_id;
    if (!customerId) {
      return reply.status(400).send({ error: 'Sem subscription Stripe — assine primeiro' });
    }

    const stripeClient = require('../services/stripe-client');
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.genomaflow.com.br';
    const session = await stripeClient.createPortalSession({
      customerId,
      returnUrl: `${frontendUrl}/clinic/billing`,
    });
    return { url: session.url };
  });

  // GET /billing/usage?days=30
  fastify.get('/billing/usage', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Admin only' });

    const days = Math.min(90, Math.max(1, parseInt(request.query.days) || 30));

    const [usageRes, tokensRes] = await Promise.all([
      fastify.pg.query(
        `SELECT
           COUNT(DISTINCT exam_id) AS exams_processed,
           COUNT(*) AS agents_executed,
           COALESCE(SUM(amount * -1), 0) AS credits_consumed
         FROM credit_ledger
         WHERE tenant_id = $1 AND kind = 'agent_usage'
           AND created_at >= NOW() - ($2 || ' days')::INTERVAL`,
        [tenant_id, days]
      ),
      fastify.pg.query(
        `SELECT
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens
         FROM clinical_results
         WHERE tenant_id = $1
           AND created_at >= NOW() - ($2 || ' days')::INTERVAL`,
        [tenant_id, days]
      )
    ]);

    const inputTokens = Number(tokensRes.rows[0].input_tokens);
    const outputTokens = Number(tokensRes.rows[0].output_tokens);
    // Opus 4.6: $5/M input, $25/M output at ~R$5 exchange = R$25/M and R$125/M
    const estimatedCostBrl = ((inputTokens * 0.026) + (outputTokens * 0.13)) / 1000;

    return {
      period_days: days,
      exams_processed: Number(usageRes.rows[0].exams_processed),
      agents_executed: Number(usageRes.rows[0].agents_executed),
      credits_consumed: Number(usageRes.rows[0].credits_consumed),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_api_cost_brl: Math.round(estimatedCostBrl * 100) / 100
    };
  });
};
