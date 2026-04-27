'use strict';
/**
 * Master broadcasts — helpers de fan-out + resolução de target tenants.
 *
 * Fluxo:
 *   1. resolveTargetTenants(pg, segment) — retorna [{ id, module }] elegíveis
 *   2. INSERT canonical row em master_broadcasts (na rota)
 *   3. Pra cada target → withTenant(target.id, async client => deliverToTenant(...))
 *   4. UPDATE master_broadcasts.recipient_count
 *
 * Master tenant id é fixo (00...001 — populado em migration 031). Como é o
 * menor UUID possível, vira sempre `tenant_a_id` na conversa (CHECK
 * tenant_a_id < tenant_b_id de 047).
 *
 * Spec: docs/superpowers/specs/2026-04-27-master-broadcasts-design.md
 */

const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const VALID_SEGMENT_KINDS = ['all', 'module', 'tenant'];
const VALID_MODULES = ['human', 'veterinary'];

/**
 * Resolve a lista de tenants alvos baseado no segmento.
 *
 * @param {import('pg').Pool|object} pg - pool ou cliente já em transação
 * @param {{kind: string, value?: string}} segment
 * @returns {Promise<Array<{id: string, module: string}>>}
 */
async function resolveTargetTenants(pg, segment) {
  if (!segment || !VALID_SEGMENT_KINDS.includes(segment.kind)) {
    throw new Error('segment kind inválido');
  }
  const { kind, value } = segment;

  if (kind === 'all') {
    const { rows } = await pg.query(
      'SELECT id, module FROM tenants WHERE active = true AND id <> $1 ORDER BY name',
      [MASTER_TENANT_ID]
    );
    return rows;
  }

  if (kind === 'module') {
    if (!VALID_MODULES.includes(value)) {
      throw new Error('module inválido');
    }
    const { rows } = await pg.query(
      `SELECT id, module FROM tenants
       WHERE active = true AND id <> $1 AND module = $2
       ORDER BY name`,
      [MASTER_TENANT_ID, value]
    );
    return rows;
  }

  // kind === 'tenant'
  if (!value) {
    throw new Error('tenant value obrigatório');
  }
  const { rows } = await pg.query(
    `SELECT id, module FROM tenants
     WHERE id = $1 AND active = true AND id <> $2`,
    [value, MASTER_TENANT_ID]
  );
  return rows;
}

/**
 * Entrega 1 broadcast pra 1 tenant: UPSERT conversation, INSERT message,
 * INSERT delivery row. Deve ser chamado dentro de withTenant(target.id, ...)
 * pra que o RLS context permita INSERT na conversation/message.
 *
 * @param {import('pg').PoolClient} client - cliente em transação com app.tenant_id setado
 * @param {object} args
 * @param {string} args.broadcastId
 * @param {string} args.masterUserId
 * @param {{id: string, module: string}} args.recipientTenant
 * @param {string} args.body
 * @returns {Promise<{conversationId: string, messageId: string}>}
 */
async function deliverToTenant(client, args) {
  const { broadcastId, masterUserId, recipientTenant, body } = args;

  // 1. UPSERT conversação master ↔ tenant.
  // Master é tenant_a (menor UUID). module é o do recipient.
  const convRes = await client.query(
    `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module, kind)
     VALUES ($1, $2, $3, 'master_broadcast')
     ON CONFLICT (tenant_a_id, tenant_b_id) DO UPDATE
       SET last_message_at = NOW()
     RETURNING id`,
    [MASTER_TENANT_ID, recipientTenant.id, recipientTenant.module]
  );
  const conversationId = convRes.rows[0].id;

  // 2. INSERT message (sender = master)
  const msgRes = await client.query(
    `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [conversationId, MASTER_TENANT_ID, masterUserId, body]
  );
  const messageId = msgRes.rows[0].id;

  // 3. UPDATE last_message_at na conversation (sempre — UPSERT acima só faz no conflict)
  await client.query(
    'UPDATE tenant_conversations SET last_message_at = NOW() WHERE id = $1',
    [conversationId]
  );

  // 4. INSERT delivery tracking
  await client.query(
    `INSERT INTO master_broadcast_deliveries (broadcast_id, tenant_id, conversation_id, message_id)
     VALUES ($1, $2, $3, $4)`,
    [broadcastId, recipientTenant.id, conversationId, messageId]
  );

  return { conversationId, messageId };
}

module.exports = {
  MASTER_TENANT_ID,
  VALID_SEGMENT_KINDS,
  VALID_MODULES,
  resolveTargetTenants,
  deliverToTenant,
};
