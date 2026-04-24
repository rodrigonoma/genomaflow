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
  // POST /conversations/:id/read — atualiza last_read_at do tenant atual
  fastify.post('/conversations/:id/read', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id: conversationId } = request.params;

    try {
      await withConversationAccess(fastify.pg, conversationId, tenant_id, async (client) => {
        const { rows: lastMsgRows } = await client.query(
          `SELECT id FROM tenant_messages
           WHERE conversation_id = $1 AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 1`,
          [conversationId]
        );
        const lastMessageId = lastMsgRows[0]?.id || null;
        await client.query(
          `INSERT INTO tenant_conversation_reads (conversation_id, tenant_id, last_read_message_id, last_read_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (conversation_id, tenant_id)
           DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id, last_read_at = NOW()`,
          [conversationId, tenant_id, lastMessageId]
        );
      });

      // Notifica o próprio tenant pra atualizar badge em outras abas (best-effort)
      try {
        if (fastify.notifyTenant) {
          fastify.notifyTenant(tenant_id, {
            event: 'chat:unread_change',
            conversation_id: conversationId,
            absolute: 0,
          });
        }
      } catch (_) {}

      return reply.status(204).send();
    } catch (err) { return mapAccessDenied(err, reply); }
  });
};
