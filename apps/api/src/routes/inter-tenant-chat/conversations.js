const { withTenant } = require('../../db/tenant');
const { withConversationAccess, ConversationAccessDeniedError } = require('../../db/conversation');

const ADMIN_ONLY = async function (request, reply) {
  if (request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Chat entre tenants é restrito a admins.' });
  }
};

/**
 * Mapa de ConversationAccessDeniedError para 403 com corpo JSON consistente.
 */
function mapAccessDenied(err, reply) {
  if (err instanceof ConversationAccessDeniedError) {
    return reply.status(403).send({ error: 'Sem acesso a esta conversa.' });
  }
  throw err;
}

module.exports = async function (fastify) {
  // GET /conversations
  fastify.get('/', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const rows = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows: r } = await client.query(
        `SELECT c.id,
                CASE WHEN c.tenant_a_id = $1 THEN c.tenant_b_id ELSE c.tenant_a_id END AS counterpart_tenant_id,
                CASE WHEN c.tenant_a_id = $1 THEN tb.name ELSE ta.name END AS counterpart_name,
                c.module,
                c.last_message_at,
                c.created_at,
                (SELECT body FROM tenant_messages
                 WHERE conversation_id = c.id AND deleted_at IS NULL
                 ORDER BY created_at DESC LIMIT 1) AS last_message_preview,
                (SELECT count(*)::int FROM tenant_messages
                 WHERE conversation_id = c.id AND sender_tenant_id <> $1
                   AND deleted_at IS NULL
                   AND created_at > COALESCE(
                     (SELECT last_read_at FROM tenant_conversation_reads
                      WHERE conversation_id = c.id AND tenant_id = $1),
                     '1970-01-01'::timestamptz
                   )
                ) AS unread_count,
                (CASE WHEN c.tenant_a_id = $1 THEN c.archived_by_a ELSE c.archived_by_b END) AS archived
         FROM tenant_conversations c
         JOIN tenants ta ON ta.id = c.tenant_a_id
         JOIN tenants tb ON tb.id = c.tenant_b_id
         WHERE c.tenant_a_id = $1 OR c.tenant_b_id = $1
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
         LIMIT 100`,
        [tenant_id]
      );
      return r;
    });
    return { results: rows };
  });

  // GET /conversations/:id
  fastify.get('/:id', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    try {
      const conv = await withConversationAccess(fastify.pg, id, tenant_id, async (client, c) => {
        const { rows } = await client.query(
          `SELECT c.id, c.tenant_a_id, c.tenant_b_id, c.module,
                  c.created_at, c.last_message_at,
                  c.archived_by_a, c.archived_by_b,
                  ta.name AS tenant_a_name, tb.name AS tenant_b_name
           FROM tenant_conversations c
           JOIN tenants ta ON ta.id = c.tenant_a_id
           JOIN tenants tb ON tb.id = c.tenant_b_id
           WHERE c.id = $1`,
          [c.id]
        );
        return rows[0];
      });
      return conv;
    } catch (err) { return mapAccessDenied(err, reply); }
  });

  // POST /conversations/:id/archive
  fastify.post('/:id/archive', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    try {
      await withConversationAccess(fastify.pg, id, tenant_id, async (client, conv) => {
        const col = conv.tenant_a_id === tenant_id ? 'archived_by_a' : 'archived_by_b';
        await client.query(
          `UPDATE tenant_conversations SET ${col} = true
           WHERE id = $1 AND (tenant_a_id = $2 OR tenant_b_id = $2)`,
          [id, tenant_id]
        );
      });
      return reply.status(204).send();
    } catch (err) { return mapAccessDenied(err, reply); }
  });

  // POST /conversations/:id/unarchive
  fastify.post('/:id/unarchive', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    try {
      await withConversationAccess(fastify.pg, id, tenant_id, async (client, conv) => {
        const col = conv.tenant_a_id === tenant_id ? 'archived_by_a' : 'archived_by_b';
        await client.query(
          `UPDATE tenant_conversations SET ${col} = false
           WHERE id = $1 AND (tenant_a_id = $2 OR tenant_b_id = $2)`,
          [id, tenant_id]
        );
      });
      return reply.status(204).send();
    } catch (err) { return mapAccessDenied(err, reply); }
  });

  // DELETE /conversations/:id — soft delete (anonimiza body, mantém metadata pra audit)
  fastify.delete('/:id', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    try {
      await withConversationAccess(fastify.pg, id, tenant_id, async (client) => {
        await client.query(
          `UPDATE tenant_messages
           SET body = '[mensagem removida pelo admin]', deleted_at = NOW()
           WHERE conversation_id = $1 AND deleted_at IS NULL`,
          [id]
        );
        // Também desabilita has_attachment pra não tentar re-renderizar anexos
        await client.query(
          `UPDATE tenant_messages SET has_attachment = false
           WHERE conversation_id = $1`,
          [id]
        );
      });
      return reply.status(204).send();
    } catch (err) { return mapAccessDenied(err, reply); }
  });
};
