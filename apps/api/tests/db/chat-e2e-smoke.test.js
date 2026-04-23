const { Pool } = require('pg');
const fixtures = require('./fixtures/chat-fixtures');
const { withTenant } = require('../../src/db/tenant');
const { withConversationAccess, ConversationAccessDeniedError } = require('../../src/db/conversation');

// pool: postgres superuser — used for setup inserts (bypasses RLS intentionally)
// appPool: genomaflow_app role — subject to FORCE RLS, used to verify isolation
let pool, appPool;

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
  const appUrl = (process.env.DATABASE_URL_TEST || '').replace('postgres:postgres@', 'genomaflow_app:genomaflow_app_2026@');
  appPool = new Pool({ connectionString: appUrl });
});

afterAll(async () => {
  await fixtures.closePool();
  await pool.end();
  await appPool.end();
});

afterEach(() => fixtures.cleanupChatFixtures());

describe('Chat E2E smoke (DB layer)', () => {
  it('ciclo completo: settings → diretório → convite → conversa → mensagem → reação → read', async () => {
    const { a, b } = await fixtures.createPair();

    // 1. Ambos opt-in no diretório (appPool com contexto de tenant — sujeito a RLS)
    await withTenant(appPool, a.tenantId, (c) =>
      c.query(`INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)`, [a.tenantId])
    );
    await withTenant(appPool, b.tenantId, (c) =>
      c.query(`INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true)`, [b.tenantId])
    );

    // 2. A vê B no diretório (trigger sync_directory já rodou ao inserir settings)
    const dirCount = await withTenant(appPool, a.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM tenant_directory_listing WHERE tenant_id = $1`, [b.tenantId]
      );
      return rows[0].n;
    });
    expect(dirCount).toBe(1);

    // 3. A convida B
    const inviteId = await withTenant(appPool, a.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id)
         VALUES ($1, $2, 'human', 'pending', $3) RETURNING id`,
        [a.tenantId, b.tenantId, a.userId]
      );
      return rows[0].id;
    });

    // 4. B aceita o convite e conversa é criada
    const convId = await withTenant(appPool, b.tenantId, async (c) => {
      await c.query(
        `UPDATE tenant_invitations SET status='accepted', responded_by_user_id=$1, responded_at=NOW() WHERE id=$2`,
        [b.userId, inviteId]
      );
      const { rows } = await c.query(
        `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module, created_from_invitation_id)
         VALUES ($1, $2, 'human', $3) RETURNING id`,
        [a.tenantId, b.tenantId, inviteId]
      );
      return rows[0].id;
    });

    // 5. A envia mensagem (via withConversationAccess com appPool — RLS ativo)
    const msgId = await withConversationAccess(appPool, convId, a.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
         VALUES ($1, $2, $3, 'olá vizinho') RETURNING id`,
        [convId, a.tenantId, a.userId]
      );
      return rows[0].id;
    });

    // 6. B lê mensagens e reage com 👍
    const msgRead = await withConversationAccess(appPool, convId, b.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT body FROM tenant_messages WHERE id = $1`, [msgId]);
      await c.query(
        `INSERT INTO tenant_message_reactions (message_id, reactor_tenant_id, reactor_user_id, emoji)
         VALUES ($1, $2, $3, '👍')`,
        [msgId, b.tenantId, b.userId]
      );
      await c.query(
        `INSERT INTO tenant_conversation_reads (conversation_id, tenant_id, last_read_message_id)
         VALUES ($1, $2, $3)`,
        [convId, b.tenantId, msgId]
      );
      return rows[0].body;
    });
    expect(msgRead).toBe('olá vizinho');

    // 7. A vê reação de B
    const reactionEmoji = await withConversationAccess(appPool, convId, a.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT emoji FROM tenant_message_reactions WHERE message_id = $1`, [msgId]
      );
      return rows[0].emoji;
    });
    expect(reactionEmoji).toBe('👍');

    // 8. Full-text search funciona
    const searchHits = await withConversationAccess(appPool, convId, a.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id FROM tenant_messages
         WHERE conversation_id = $1
           AND body_tsv @@ plainto_tsquery('portuguese', 'vizinho')`,
        [convId]
      );
      return rows.length;
    });
    expect(searchHits).toBe(1);
  });

  it('terceiro tenant não consegue acessar nada do par', async () => {
    const { a, b } = await fixtures.createPair();
    const c3 = await fixtures.createTenant({ name: 'E2EThird-' + Date.now() });

    // Setup: A e B criam conversa e trocam mensagem via pool (superuser, bypassa RLS — setup)
    const { rows: [conv] } = await pool.query(
      `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module) VALUES ($1, $2, 'human') RETURNING id`,
      [a.tenantId, b.tenantId]
    );
    await pool.query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
       VALUES ($1, $2, $3, 'segredo')`,
      [conv.id, a.tenantId, a.userId]
    );

    // C3 tenta acessar via helper — deve ser rejeitado com ConversationAccessDeniedError
    await expect(
      withConversationAccess(appPool, conv.id, c3.tenantId, async () => 'unreached')
    ).rejects.toThrow(ConversationAccessDeniedError);

    // C3 também não vê via SELECT direto (RLS com appPool — FORCE RLS ativo)
    const seenMsgs = await withTenant(appPool, c3.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT body FROM tenant_messages WHERE conversation_id = $1`, [conv.id]);
      return rows.length;
    });
    expect(seenMsgs).toBe(0);
  });
});
