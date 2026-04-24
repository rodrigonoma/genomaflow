const { withConversationAccess, ConversationAccessDeniedError } = require('../../db/conversation');

const ADMIN_ONLY = async function (request, reply) {
  if (request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Chat entre tenants é restrito a admins.' });
  }
};

function mapAccessDenied(err, reply) {
  if (err instanceof ConversationAccessDeniedError) {
    return reply.status(403).send({ error: 'Sem acesso a esta conversa.' });
  }
  throw err;
}

module.exports = async function (fastify) {
  // GET /conversations/:id/messages?before=&limit=
  fastify.get('/conversations/:id/messages', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const before = request.query?.before || null;
    const limit = Math.min(100, Math.max(1, parseInt(request.query?.limit) || 50));

    try {
      const rows = await withConversationAccess(fastify.pg, id, tenant_id, async (client) => {
        const { rows: r } = await client.query(
          `SELECT id, conversation_id, sender_tenant_id, sender_user_id, body,
                  has_attachment, created_at
           FROM tenant_messages
           WHERE conversation_id = $1 AND deleted_at IS NULL
             AND ($2::timestamptz IS NULL OR created_at < $2)
           ORDER BY created_at DESC
           LIMIT $3`,
          [id, before, limit]
        );
        return r;
      });
      return { results: rows };
    } catch (err) { return mapAccessDenied(err, reply); }
  });

  // POST /conversations/:id/messages — rate limit 200/dia
  fastify.post('/conversations/:id/messages', {
    preHandler: [fastify.authenticate, ADMIN_ONLY],
    config: { rateLimit: {
      max: 200, timeWindow: '24 hours',
      keyGenerator: (req) => `msg:${req.user?.tenant_id || req.ip}`,
    } }
  }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;
    const { body } = request.body || {};

    if (!body || typeof body !== 'string' || !body.trim()) {
      return reply.status(400).send({ error: 'body é obrigatório' });
    }
    if (body.length > 5000) {
      return reply.status(400).send({ error: 'body muito longo (max 5000 chars)' });
    }

    try {
      const result = await withConversationAccess(fastify.pg, id, tenant_id, async (client, conv) => {
        const { rows } = await client.query(
          `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
           VALUES ($1, $2, $3, $4)
           RETURNING id, conversation_id, sender_tenant_id, sender_user_id, body, has_attachment, created_at`,
          [id, tenant_id, user_id, body.trim()]
        );
        await client.query(
          `UPDATE tenant_conversations SET last_message_at = NOW() WHERE id = $1`,
          [id]
        );
        const counterpart = conv.tenant_a_id === tenant_id ? conv.tenant_b_id : conv.tenant_a_id;
        return { msg: rows[0], counterpart };
      });

      // Notifica o counterpart via WS (best-effort)
      try {
        if (fastify.notifyTenant) {
          const preview = result.msg.body.length > 120
            ? result.msg.body.slice(0, 120) + '…' : result.msg.body;
          fastify.notifyTenant(result.counterpart, {
            event: 'chat:message_received',
            conversation_id: id,
            message_id: result.msg.id,
            sender_tenant_id: tenant_id,
            body_preview: preview,
            created_at: result.msg.created_at,
          });
          fastify.notifyTenant(result.counterpart, {
            event: 'chat:unread_change',
            conversation_id: id,
            delta: 1,
          });
        }
      } catch (_) {}

      return reply.status(201).send(result.msg);
    } catch (err) { return mapAccessDenied(err, reply); }
  });

  // GET /conversations/:id/search?q=
  fastify.get('/conversations/:id/search', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const q = request.query?.q;

    if (!q || typeof q !== 'string' || !q.trim()) {
      return reply.status(400).send({ error: 'q é obrigatório' });
    }

    try {
      const rows = await withConversationAccess(fastify.pg, id, tenant_id, async (client) => {
        const { rows: r } = await client.query(
          `SELECT id, sender_tenant_id, body, created_at,
                  ts_headline('portuguese', body, plainto_tsquery('portuguese', $2),
                              'StartSel=<mark>, StopSel=</mark>, MaxWords=20, MinWords=5') AS snippet
           FROM tenant_messages
           WHERE conversation_id = $1 AND deleted_at IS NULL
             AND body_tsv @@ plainto_tsquery('portuguese', $2)
           ORDER BY created_at DESC
           LIMIT 50`,
          [id, q.trim()]
        );
        return r;
      });
      return { results: rows };
    } catch (err) { return mapAccessDenied(err, reply); }
  });
};
