'use strict';

const { withTenant } = require('../db/tenant');
const {
  resolveTargetTenants,
  deliverToTenant,
  VALID_SEGMENT_KINDS,
  VALID_MODULES,
  MASTER_TENANT_ID,
} = require('../services/master-broadcasts');

const BROADCAST_BODY_MAX = 2000;

function masterOnly(fastify) {
  return async (request, reply) => {
    await fastify.authenticate(request, reply);
    if (request.user.role !== 'master') {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  };
}

module.exports = async function masterRoutes(fastify) {
  const auth = () => ({ preHandler: [masterOnly(fastify)] });

  // ── Tenants ──────────────────────────────────────────────────────────────

  fastify.get('/tenants', auth(), async (request, reply) => {
    const { rows } = await fastify.pg.query(`
      SELECT
        t.id, t.name, t.type, t.module, t.plan, t.active, t.created_at,
        COUNT(DISTINCT u.id) FILTER (WHERE u.role != 'master') AS user_count,
        COALESCE(SUM(cl.amount), 0) AS balance,
        MAX(cl.created_at) FILTER (WHERE cl.kind IN ('subscription_bonus','topup','topup_recurring','adjustment')) AS last_purchase_at,
        ARRAY_AGG(DISTINCT ts.agent_type) FILTER (WHERE ts.agent_type IS NOT NULL) AS specialties
      FROM tenants t
      LEFT JOIN users u ON u.tenant_id = t.id
      LEFT JOIN credit_ledger cl ON cl.tenant_id = t.id
      LEFT JOIN tenant_specialties ts ON ts.tenant_id = t.id
      WHERE t.id != '00000000-0000-0000-0000-000000000001'
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `);
    return rows;
  });

  fastify.patch('/tenants/:id/activate', auth(), async (request, reply) => {
    const { id } = request.params;
    const { rowCount } = await fastify.pg.query(
      'UPDATE tenants SET active = true WHERE id = $1 AND id != $2',
      [id, '00000000-0000-0000-0000-000000000001']
    );
    if (!rowCount) return reply.status(404).send({ error: 'Tenant not found' });
    return { ok: true };
  });

  fastify.patch('/tenants/:id/deactivate', auth(), async (request, reply) => {
    const { id } = request.params;
    const { rowCount } = await fastify.pg.query(
      'UPDATE tenants SET active = false WHERE id = $1 AND id != $2',
      [id, '00000000-0000-0000-0000-000000000001']
    );
    if (!rowCount) return reply.status(404).send({ error: 'Tenant not found' });
    return { ok: true };
  });

  fastify.get('/tenants/:id/users', auth(), async (request, reply) => {
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `SELECT id, email, role, specialty, active, created_at
       FROM users WHERE tenant_id = $1 AND role != 'master'
       ORDER BY created_at`,
      [id]
    );
    return rows;
  });

  fastify.patch('/tenants/:id/users/:userId/toggle', auth(), async (request, reply) => {
    const { userId } = request.params;
    const { rows } = await fastify.pg.query(
      `UPDATE users SET active = NOT active
       WHERE id = $1 AND role != 'master'
       RETURNING id, email, active`,
      [userId]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'User not found' });
    return rows[0];
  });

  // ── Errors ───────────────────────────────────────────────────────────────

  fastify.get('/errors', auth(), async (request, reply) => {
    const page  = Math.max(1, parseInt(request.query.page)  || 1);
    const limit = Math.min(200, parseInt(request.query.limit) || 50);
    const offset = (page - 1) * limit;

    const [rows, countRes] = await Promise.all([
      fastify.pg.query(
        `SELECT el.id, el.url, el.method, el.status_code, el.error_message, el.created_at,
                t.name AS tenant_name, u.email AS user_email
         FROM error_log el
         LEFT JOIN tenants t ON t.id = el.tenant_id
         LEFT JOIN users u ON u.id = el.user_id
         ORDER BY el.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      fastify.pg.query('SELECT COUNT(*) FROM error_log')
    ]);

    return { items: rows.rows, total: parseInt(countRes.rows[0].count), page, limit };
  });

  // ── Feedback / Suggestions ───────────────────────────────────────────────

  fastify.get('/feedback', auth(), async (request, reply) => {
    const rawType = request.query.type;
    const type    = rawType === 'bug' || rawType === 'feature' ? rawType : null;
    const page    = Math.max(1, parseInt(request.query.page)  || 1);
    const limit   = Math.min(200, parseInt(request.query.limit) || 50);
    const offset  = (page - 1) * limit;

    const [rows, countRes] = await Promise.all([
      fastify.pg.query(
        `SELECT f.id, f.type, f.message, f.screenshot_url, f.created_at,
                t.name AS tenant_name, u.email AS user_email
         FROM feedback f
         LEFT JOIN tenants t ON t.id = f.tenant_id
         LEFT JOIN users u ON u.id = f.user_id
         WHERE ($3::text IS NULL OR f.type = $3)
         ORDER BY f.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset, type]
      ),
      fastify.pg.query(
        `SELECT COUNT(*) FROM feedback WHERE ($1::text IS NULL OR type = $1)`,
        [type]
      )
    ]);

    return { items: rows.rows, total: parseInt(countRes.rows[0].count), page, limit };
  });

  // ── Exams ─────────────────────────────────────────────────────────────────

  fastify.get('/tenants/:id/exams', auth(), async (request, reply) => {
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `SELECT e.id, e.status, e.file_path, e.created_at,
              p.name AS patient_name, p.species
       FROM exams e
       JOIN patients p ON p.id = e.patient_id
       WHERE p.tenant_id = $1
       ORDER BY e.created_at DESC
       LIMIT 100`,
      [id]
    );
    return rows;
  });

  fastify.patch('/exams/:examId/reset', auth(), async (request, reply) => {
    const { examId } = request.params;
    const { rows } = await fastify.pg.query(
      `UPDATE exams SET status = 'error' WHERE id = $1
       RETURNING id, status, patient_id`,
      [examId]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Exam not found' });
    return { ok: true, exam_id: rows[0].id, status: rows[0].status };
  });

  // ── Credits ──────────────────────────────────────────────────────────────

  fastify.post('/credits', auth(), async (request, reply) => {
    const { tenant_id, amount, description } = request.body || {};
    if (!tenant_id || !amount) {
      return reply.status(400).send({ error: 'tenant_id e amount são obrigatórios' });
    }
    const n = parseInt(amount);
    if (!n || Math.abs(n) > 100000) {
      return reply.status(400).send({ error: 'amount inválido (máx ±100000)' });
    }

    const tenantCheck = await fastify.pg.query(
      'SELECT id, name FROM tenants WHERE id = $1', [tenant_id]
    );
    if (!tenantCheck.rows[0]) return reply.status(404).send({ error: 'Tenant não encontrado' });

    const { rows } = await fastify.pg.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description)
       VALUES ($1, $2, 'adjustment', $3)
       RETURNING id, amount, created_at`,
      [tenant_id, n, description || `Ajuste manual: ${n} créditos`]
    );

    fastify.redis.publish(`billing:updated:${tenant_id}`, '{}').catch(() => {});
    return { ok: true, ...rows[0], tenant_name: tenantCheck.rows[0].name };
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  fastify.get('/stats', auth(), async (request, reply) => {
    const [tenants, errors, feedbacks, credits] = await Promise.all([
      fastify.pg.query(`SELECT COUNT(*) FROM tenants WHERE id != '00000000-0000-0000-0000-000000000001'`),
      fastify.pg.query(`SELECT COUNT(*) FROM error_log WHERE created_at > NOW() - INTERVAL '24 hours'`),
      fastify.pg.query(`SELECT COUNT(*) FROM feedback`),
      fastify.pg.query(`SELECT COALESCE(SUM(amount),0) AS total FROM credit_ledger`)
    ]);
    return {
      total_tenants: parseInt(tenants.rows[0].count),
      errors_24h: parseInt(errors.rows[0].count),
      total_feedback: parseInt(feedbacks.rows[0].count),
      total_credits_issued: parseInt(credits.rows[0].total)
    };
  });

  // ── Copilot help analytics ────────────────────────────────────────────────
  fastify.get('/help-analytics', auth(), async (request, reply) => {
    const days = Math.min(90, parseInt(request.query.days) || 30);
    const { rows: topRoutes } = await fastify.pg.query(
      `SELECT route, COUNT(*)::int AS n, AVG(latency_ms)::int AS avg_latency_ms,
              COUNT(*) FILTER (WHERE was_helpful = false)::int AS unhelpful_count
       FROM help_questions
       WHERE created_at > NOW() - INTERVAL '1 day' * $1
       GROUP BY route
       ORDER BY n DESC
       LIMIT 20`,
      [days]
    );
    const { rows: recent } = await fastify.pg.query(
      `SELECT hq.id, hq.route, hq.component, hq.user_role, hq.question, hq.answer_preview,
              hq.was_helpful, hq.created_at, t.name AS tenant_name, u.email AS user_email
       FROM help_questions hq
       LEFT JOIN tenants t ON t.id = hq.tenant_id
       LEFT JOIN users u ON u.id = hq.user_id
       ORDER BY hq.created_at DESC
       LIMIT 100`
    );
    return { top_routes: topRoutes, recent };
  });

  // ── Audit log (todas mutações UI + Copilot + sistema) ─────────────────────
  fastify.get('/audit-log', auth(), async (request, reply) => {
    const q = request.query || {};
    const limit = Math.min(200, Math.max(1, parseInt(q.limit) || 100));
    const days = Math.min(180, Math.max(1, parseInt(q.days) || 30));

    const params = [days];
    const filters = [];
    if (q.entity_type) {
      params.push(String(q.entity_type));
      filters.push(`a.entity_type = $${params.length}`);
    }
    if (q.entity_id) {
      params.push(String(q.entity_id));
      filters.push(`a.entity_id = $${params.length}`);
    }
    if (q.actor_user_id) {
      params.push(String(q.actor_user_id));
      filters.push(`a.actor_user_id = $${params.length}`);
    }
    if (q.actor_channel) {
      params.push(String(q.actor_channel));
      filters.push(`a.actor_channel = $${params.length}`);
    }
    if (q.tenant_id) {
      params.push(String(q.tenant_id));
      filters.push(`a.tenant_id = $${params.length}`);
    }
    if (q.action) {
      params.push(String(q.action));
      filters.push(`a.action = $${params.length}`);
    }
    const whereExtra = filters.length > 0 ? ` AND ${filters.join(' AND ')}` : '';

    const { rows } = await fastify.pg.query(
      `SELECT a.id, a.tenant_id, a.entity_type, a.entity_id, a.action,
              a.actor_user_id, a.actor_channel, a.changed_fields, a.created_at,
              t.name AS tenant_name,
              u.email AS actor_email
       FROM audit_log a
       LEFT JOIN tenants t ON t.id = a.tenant_id
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.created_at > NOW() - INTERVAL '1 day' * $1${whereExtra}
       ORDER BY a.created_at DESC
       LIMIT ${limit}`,
      params
    );
    return { results: rows, filters: q, days, limit };
  });

  // GET /audit-log/:id — detalhes (old_data + new_data) pra drill-down
  fastify.get('/audit-log/:id', auth(), async (request, reply) => {
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `SELECT a.id, a.tenant_id, a.entity_type, a.entity_id, a.action,
              a.actor_user_id, a.actor_channel, a.old_data, a.new_data,
              a.changed_fields, a.created_at,
              t.name AS tenant_name, u.email AS actor_email
       FROM audit_log a
       LEFT JOIN tenants t ON t.id = a.tenant_id
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.id = $1`,
      [id]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Audit entry not found' });
    return rows[0];
  });

  // ── Master broadcasts (canal "Administrador GenomaFlow" → tenants) ───────
  fastify.post('/broadcasts', {
    ...auth(),
    config: { rateLimit: { max: 20, timeWindow: '1 day' } },
  }, async (request, reply) => {
    const body = (request.body && typeof request.body.body === 'string') ? request.body.body.trim() : '';
    const segment = request.body?.segment;

    // Validação de body
    if (!body) {
      return reply.status(400).send({ error: 'body é obrigatório' });
    }
    if (body.length > BROADCAST_BODY_MAX) {
      return reply.status(400).send({ error: `body excede ${BROADCAST_BODY_MAX} caracteres` });
    }

    // Validação de segment
    if (!segment || typeof segment !== 'object') {
      return reply.status(400).send({ error: 'segment é obrigatório' });
    }
    if (!VALID_SEGMENT_KINDS.includes(segment.kind)) {
      return reply.status(400).send({ error: 'segment.kind inválido' });
    }
    if (segment.kind === 'module' && !VALID_MODULES.includes(segment.value)) {
      return reply.status(400).send({ error: 'segment.value inválido pra kind=module' });
    }
    if (segment.kind === 'tenant' && !segment.value) {
      return reply.status(400).send({ error: 'segment.value obrigatório pra kind=tenant' });
    }

    // Resolve targets (sem tenant_id setado — master vê tudo)
    const targets = await resolveTargetTenants(fastify.pg, segment);
    if (targets.length === 0) {
      return reply.status(400).send({ error: 'Nenhum tenant elegível pra esse segmento' });
    }

    // INSERT canonical broadcast row (sem RLS context — master-only policy permite)
    const { rows: [bc] } = await fastify.pg.query(
      `INSERT INTO master_broadcasts (sender_user_id, body, segment_kind, segment_value, recipient_count)
       VALUES ($1, $2, $3, $4, 0)
       RETURNING id, created_at`,
      [request.user.user_id, body, segment.kind, segment.value || null]
    );

    // Fan-out síncrono — pra cada tenant, withTenant cria conv+msg+delivery.
    // RLS context = MASTER_TENANT_ID porque master é o sender em tenant_messages
    // (tm_insert exige sender_tenant_id = app.tenant_id). Master também é
    // tenant_a_id na conversa, então tc_insert passa. As policies master-only
    // (mb/mba/mbd) aceitam master tenant id via 059.
    let delivered = 0;
    for (const t of targets) {
      try {
        const { conversationId, messageId } = await withTenant(
          fastify.pg, MASTER_TENANT_ID,
          (client) => deliverToTenant(client, {
            broadcastId: bc.id,
            masterUserId: request.user.user_id,
            recipientTenant: t,
            body,
          }),
          { userId: request.user.user_id, channel: 'system' }
        );
        delivered += 1;

        // WS notify via Redis pub/sub (padrão do chat existente)
        await fastify.redis.publish(
          `chat:event:${t.id}`,
          JSON.stringify({
            event: 'master_broadcast_received',
            conversation_id: conversationId,
            message_id: messageId,
          })
        );
      } catch (err) {
        request.log.error({ err, tenant_id: t.id, broadcast_id: bc.id }, 'master broadcast delivery failed');
      }
    }

    // Atualiza recipient_count com o que foi efetivamente entregue
    await fastify.pg.query(
      'UPDATE master_broadcasts SET recipient_count = $1 WHERE id = $2',
      [delivered, bc.id]
    );

    return {
      broadcast_id: bc.id,
      recipient_count: delivered,
      target_count: targets.length,
      created_at: bc.created_at,
    };
  });
};
