const { Pool } = require('pg');
const fixtures = require('./fixtures/chat-fixtures');
const { withConversationAccess, ConversationAccessDeniedError } = require('../../src/db/conversation');

let pool;

beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST }); });
afterAll(async () => { await fixtures.closePool(); await pool.end(); });
afterEach(() => fixtures.cleanupChatFixtures());

async function createConversation(a, b) {
  const { rows: [conv] } = await pool.query(
    `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module)
     VALUES ($1, $2, 'human') RETURNING id`,
    [a.tenantId, b.tenantId]
  );
  return conv.id;
}

describe('withConversationAccess', () => {
  it('executa fn quando tenant é tenant_a', async () => {
    const { a, b } = await fixtures.createPair();
    const convId = await createConversation(a, b);

    const result = await withConversationAccess(pool, convId, a.tenantId, async (client, conv) => {
      expect(conv.id).toBe(convId);
      return 42;
    });
    expect(result).toBe(42);
  });

  it('executa fn quando tenant é tenant_b', async () => {
    const { a, b } = await fixtures.createPair();
    const convId = await createConversation(a, b);

    const result = await withConversationAccess(pool, convId, b.tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM tenant_messages WHERE conversation_id = $1`,
        [convId]
      );
      return rows[0].n;
    });
    expect(result).toBe(0);
  });

  it('rejeita com ConversationAccessDeniedError quando tenant não é membro', async () => {
    const { a, b } = await fixtures.createPair();
    const c3 = await fixtures.createTenant({ name: 'NonMemberHelper-' + Date.now() });
    const convId = await createConversation(a, b);

    await expect(
      withConversationAccess(pool, convId, c3.tenantId, async () => 'should not reach')
    ).rejects.toThrow(ConversationAccessDeniedError);
  });

  it('rejeita com ConversationAccessDeniedError para conversation_id inexistente', async () => {
    const t = await fixtures.createTenant({ name: 'Helper404-' + Date.now() });
    const fakeId = '00000000-0000-0000-0000-000000000999';

    await expect(
      withConversationAccess(pool, fakeId, t.tenantId, async () => 'unreached')
    ).rejects.toThrow(ConversationAccessDeniedError);
  });

  it('faz rollback se fn lança erro (não persiste mudanças)', async () => {
    const { a, b } = await fixtures.createPair();
    const convId = await createConversation(a, b);

    await expect(
      withConversationAccess(pool, convId, a.tenantId, async (client) => {
        await client.query(
          `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
           VALUES ($1, $2, $3, 'rollback me')`,
          [convId, a.tenantId, a.userId]
        );
        throw new Error('intencional');
      })
    ).rejects.toThrow('intencional');

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM tenant_messages WHERE conversation_id = $1`, [convId]
    );
    expect(rows[0].n).toBe(0);
  });
});
