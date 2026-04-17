'use strict';

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
    const page = Math.max(1, parseInt(request.query.page) || 1);
    const limit = Math.min(100, parseInt(request.query.limit) || 20);
    const offset = (page - 1) * limit;

    const [itemsRes, countRes] = await Promise.all([
      fastify.pg.query(
        `SELECT id, amount, kind, description, exam_id, created_at
         FROM credit_ledger WHERE tenant_id = $1
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [tenant_id, limit, offset]
      ),
      fastify.pg.query('SELECT COUNT(*) FROM credit_ledger WHERE tenant_id = $1', [tenant_id])
    ]);

    return { items: itemsRes.rows, total: parseInt(countRes.rows[0].count), page, limit };
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

    const valid = ['metabolic','cardiovascular','hematology','small_animals','equine','bovine','therapeutic','nutrition'];
    const invalid = specialties.filter(s => !valid.includes(s));
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

  // POST /billing/subscribe
  fastify.post('/billing/subscribe', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Admin only' });

    const { gateway, plan, specialties } = request.body || {};
    if (!gateway || !plan) return reply.status(400).send({ error: 'gateway e plan são obrigatórios' });
    if (!['stripe','mercadopago'].includes(gateway)) return reply.status(400).send({ error: 'Gateway inválido' });

    // Save specialties from onboarding metadata
    if (Array.isArray(specialties) && specialties.length > 0) {
      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM tenant_specialties WHERE tenant_id = $1', [tenant_id]);
        for (const agent_type of specialties) {
          await client.query(
            'INSERT INTO tenant_specialties (tenant_id, agent_type) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [tenant_id, agent_type]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // TODO: integrate real Stripe/MP SDK — for now return dev redirect
    const appUrl = process.env.APP_URL || 'http://localhost:4200';
    const checkout_url = `${appUrl}/login?activated=true`;
    return reply.status(200).send({ checkout_url });
  });

  // POST /billing/topup
  fastify.post('/billing/topup', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Admin only' });

    const { gateway, credits } = request.body || {};
    if (!gateway || !credits) return reply.status(400).send({ error: 'gateway e credits são obrigatórios' });

    const validPackages = [100, 250, 500];
    if (!validPackages.includes(Number(credits))) {
      return reply.status(400).send({ error: 'Pacote inválido. Use: 100, 250 ou 500 créditos' });
    }

    const appUrl = process.env.APP_URL || 'http://localhost:4200';
    const checkout_url = `${appUrl}/clinic/billing?topup_pending=true`;
    return reply.status(200).send({ checkout_url });
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
