const { withTenant } = require('../../db/tenant');
const { isTenantSuspended } = require('./reports');

const ADMIN_ONLY = async function (request, reply) {
  if (request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Chat entre tenants é restrito a admins.' });
  }
};

const COOLDOWN_REJECTIONS = 3;
const COOLDOWN_DAYS = 30;

module.exports = async function (fastify) {
  // GET /invitations?direction=incoming|outgoing
  fastify.get('/', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const direction = request.query?.direction === 'outgoing' ? 'outgoing' : 'incoming';
    const colFilter = direction === 'incoming' ? 'to_tenant_id' : 'from_tenant_id';

    const rows = await withTenant(fastify.pg, tenant_id, async (client) => {
      const r = await client.query(
        `SELECT i.id, i.from_tenant_id, i.to_tenant_id, i.module, i.status, i.message,
                i.sent_at, i.responded_at,
                ft.name AS from_tenant_name, tt.name AS to_tenant_name
         FROM tenant_invitations i
         JOIN tenants ft ON ft.id = i.from_tenant_id
         JOIN tenants tt ON tt.id = i.to_tenant_id
         WHERE i.${colFilter} = $1
         ORDER BY i.sent_at DESC
         LIMIT 100`,
        [tenant_id]
      );
      return r.rows;
    });
    return { results: rows };
  });

  // POST /invitations — rate limit 20/dia por tenant
  fastify.post('/', {
    preHandler: [fastify.authenticate, ADMIN_ONLY],
    config: { rateLimit: {
      max: 20, timeWindow: '24 hours',
      keyGenerator: (req) => req.user?.tenant_id || req.ip,
    } }
  }, async (request, reply) => {
    const { tenant_id, user_id, module: senderModule } = request.user;
    const { to_tenant_id, message } = request.body || {};

    if (!to_tenant_id || typeof to_tenant_id !== 'string') {
      return reply.status(400).send({ error: 'to_tenant_id obrigatório' });
    }
    if (to_tenant_id === tenant_id) {
      return reply.status(400).send({ error: 'Não é possível convidar a própria clínica.' });
    }
    if (message != null && (typeof message !== 'string' || message.length > 500)) {
      return reply.status(400).send({ error: 'message deve ser string com até 500 chars' });
    }

    // Suspensão por denúncias
    if (await isTenantSuspended(fastify.pg, tenant_id)) {
      return reply.status(403).send({
        error: 'Sua clínica está temporariamente suspensa no chat devido a denúncias recentes.'
      });
    }

    // 1. valida existência + módulo do destinatário
    let targetRows;
    try {
      const r = await fastify.pg.query(
        `SELECT id, module, active FROM tenants WHERE id = $1`, [to_tenant_id]
      );
      targetRows = r.rows;
    } catch (err) {
      if (err.code === '22P02') {  // invalid uuid
        return reply.status(400).send({ error: 'to_tenant_id inválido' });
      }
      throw err;
    }
    if (targetRows.length === 0 || !targetRows[0].active) {
      return reply.status(404).send({ error: 'Clínica não encontrada.' });
    }
    if (targetRows[0].module !== senderModule) {
      return reply.status(400).send({ error: 'Cross-module proibido.' });
    }

    // 2. bloqueio bilateral (qualquer direção)
    const { rows: blockRows } = await fastify.pg.query(
      `SELECT 1 FROM tenant_blocks
       WHERE (blocker_tenant_id = $1 AND blocked_tenant_id = $2)
          OR (blocker_tenant_id = $2 AND blocked_tenant_id = $1)`,
      [tenant_id, to_tenant_id]
    );
    if (blockRows.length > 0) {
      return reply.status(429).send({ error: 'Não foi possível enviar convite.' });
    }

    // 3. cooldown: 3+ rejeições do mesmo destinatário em 30 dias
    const { rows: cooldownRows } = await fastify.pg.query(
      `SELECT count(*)::int AS n FROM tenant_invitations
       WHERE from_tenant_id = $1 AND to_tenant_id = $2
         AND status = 'rejected'
         AND responded_at >= NOW() - INTERVAL '${COOLDOWN_DAYS} days'`,
      [tenant_id, to_tenant_id]
    );
    if (cooldownRows[0].n >= COOLDOWN_REJECTIONS) {
      return reply.status(429).send({ error: `Aguarde antes de convidar essa clínica novamente (${COOLDOWN_REJECTIONS} rejeições recentes).` });
    }

    // 4. insert
    try {
      const inv = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO tenant_invitations
            (from_tenant_id, to_tenant_id, module, status, message, sent_by_user_id)
           VALUES ($1, $2, $3, 'pending', $4, $5)
           RETURNING id, from_tenant_id, to_tenant_id, module, status, message, sent_at`,
          [tenant_id, to_tenant_id, senderModule, message?.trim() || null, user_id]
        );
        return rows[0];
      });

      // Notifica destinatário via WS (best-effort)
      try {
        const { rows: [sender] } = await fastify.pg.query(
          `SELECT name FROM tenants WHERE id = $1`, [tenant_id]
        );
        if (fastify.notifyTenant) {
          fastify.notifyTenant(to_tenant_id, {
            event: 'chat:invitation_received',
            invitation_id: inv.id,
            from_tenant_id: tenant_id,
            from_tenant_name: sender?.name || '',
            message: inv.message,
          });
        }
      } catch (_) { /* notify é best-effort */ }

      return reply.status(201).send(inv);
    } catch (err) {
      if (err.code === '23505') {
        return reply.status(409).send({ error: 'Já existe convite pendente para essa clínica.' });
      }
      throw err;
    }
  });

  // POST /:id/accept
  fastify.post('/:id/accept', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE tenant_invitations
         SET status = 'accepted', responded_at = NOW(), responded_by_user_id = $1
         WHERE id = $2 AND to_tenant_id = $3 AND status = 'pending'
         RETURNING id, from_tenant_id, to_tenant_id, module`,
        [user_id, id, tenant_id]
      );
      if (rows.length === 0) return { code: 404 };
      const inv = rows[0];

      const [a, b] = inv.from_tenant_id < inv.to_tenant_id
        ? [inv.from_tenant_id, inv.to_tenant_id]
        : [inv.to_tenant_id, inv.from_tenant_id];
      const { rows: convRows } = await client.query(
        `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module, created_from_invitation_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_a_id, tenant_b_id) DO UPDATE SET created_from_invitation_id = EXCLUDED.created_from_invitation_id
         RETURNING id`,
        [a, b, inv.module, inv.id]
      );
      return {
        code: 201,
        body: { invitation_id: inv.id, conversation_id: convRows[0].id },
        from_tenant_id: inv.from_tenant_id,
      };
    });

    if (result.code === 404) {
      return reply.status(404).send({ error: 'Convite não encontrado, não é seu, ou já não está pending.' });
    }

    // Notifica o sender via WS (best-effort)
    if (result.code === 201) {
      try {
        const { rows: [accepter] } = await fastify.pg.query(
          `SELECT name FROM tenants WHERE id = $1`, [tenant_id]
        );
        if (fastify.notifyTenant) {
          fastify.notifyTenant(result.from_tenant_id, {
            event: 'chat:invitation_accepted',
            invitation_id: result.body.invitation_id,
            conversation_id: result.body.conversation_id,
            counterpart_tenant_name: accepter?.name || '',
          });
        }
      } catch (_) {}
    }

    return reply.status(result.code).send(result.body);
  });

  // POST /:id/reject
  fastify.post('/:id/reject', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;

    const updated = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE tenant_invitations
         SET status = 'rejected', responded_at = NOW(), responded_by_user_id = $1
         WHERE id = $2 AND to_tenant_id = $3 AND status = 'pending'
         RETURNING id`,
        [user_id, id, tenant_id]
      );
      return rows[0];
    });
    if (!updated) return reply.status(404).send({ error: 'Convite não encontrado.' });
    return reply.status(204).send();
  });

  // DELETE /:id (cancel — sender only, pending only)
  fastify.delete('/:id', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const updated = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE tenant_invitations
         SET status = 'cancelled', responded_at = NOW()
         WHERE id = $1 AND from_tenant_id = $2 AND status = 'pending'
         RETURNING id`,
        [id, tenant_id]
      );
      return rows[0];
    });
    if (!updated) return reply.status(404).send({ error: 'Convite não encontrado ou não cancelável.' });
    return reply.status(204).send();
  });
};
