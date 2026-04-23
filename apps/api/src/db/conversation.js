const { withTenant } = require('./tenant');

class ConversationAccessDeniedError extends Error {
  constructor(conversationId, tenantId) {
    super(`Tenant ${tenantId} não é membro da conversa ${conversationId}`);
    this.code = 'CONVERSATION_ACCESS_DENIED';
    this.conversationId = conversationId;
    this.tenantId = tenantId;
  }
}

/**
 * Estende withTenant: valida que o tenant é membro da conversa antes de chamar fn.
 * Defesa em profundidade — RLS já bloqueia, mas o helper retorna erro semântico
 * para a API mapear em 403.
 *
 * @param {import('pg').Pool} pg
 * @param {string} conversationId
 * @param {string} tenantId
 * @param {(client, conversation) => Promise<any>} fn
 */
async function withConversationAccess(pg, conversationId, tenantId, fn) {
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, tenant_a_id, tenant_b_id, module
       FROM tenant_conversations
       WHERE id = $1
         AND (tenant_a_id = $2 OR tenant_b_id = $2)`,
      [conversationId, tenantId]
    );
    if (!rows[0]) throw new ConversationAccessDeniedError(conversationId, tenantId);
    return fn(client, rows[0]);
  });
}

module.exports = { withConversationAccess, ConversationAccessDeniedError };
