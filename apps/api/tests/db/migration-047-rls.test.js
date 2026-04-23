const fixtures = require('./fixtures/chat-fixtures');
const { Pool } = require('pg');
const { withTenant } = require('../../src/db/tenant');

// pool: postgres superuser — used for setup inserts (bypasses RLS intentionally)
// appPool: genomaflow_app role — subject to FORCE RLS, used to verify isolation
let pool;
let appPool;

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
  appPool = new Pool({
    connectionString: process.env.DATABASE_URL_TEST
      .replace('postgres:postgres@', 'genomaflow_app:genomaflow_app_2026@'),
  });
});
afterAll(async () => {
  await fixtures.closePool();
  await pool.end();
  await appPool.end();
});
afterEach(() => fixtures.cleanupChatFixtures());

describe('RLS — tenant_chat_settings', () => {
  it('SELECT só vê linha do próprio tenant', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsSet1-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsSet2-' + Date.now() });
    // superuser insert — bypasses RLS (intentional for test setup)
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, false), ($2, false)`,
      [t1.tenantId, t2.tenantId]
    );

    // appPool is subject to FORCE RLS
    const seen = await withTenant(appPool, t1.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT tenant_id FROM tenant_chat_settings`);
      return rows.map(r => r.tenant_id);
    });
    expect(seen).toEqual([t1.tenantId]);
  });

  it('UPDATE não afeta tenant alheio', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsSet1u-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsSet2u-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, false), ($2, false)`,
      [t1.tenantId, t2.tenantId]
    );

    const updated = await withTenant(appPool, t1.tenantId, async (c) => {
      const { rowCount } = await c.query(`UPDATE tenant_chat_settings SET visible_in_directory = true`);
      return rowCount;
    });
    expect(updated).toBe(1);  // só a linha de t1
  });
});

describe('RLS — tenant_blocks', () => {
  it('SELECT só vê bloqueios criados pelo próprio tenant', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsBlk1-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsBlk2-' + Date.now() });
    const t3 = await fixtures.createTenant({ name: 'RlsBlk3-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_blocks (blocker_tenant_id, blocked_tenant_id) VALUES ($1, $2), ($2, $3)`,
      [t1.tenantId, t2.tenantId, t3.tenantId]
    );

    const seen = await withTenant(appPool, t1.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT blocked_tenant_id FROM tenant_blocks`);
      return rows.map(r => r.blocked_tenant_id);
    });
    expect(seen).toEqual([t2.tenantId]);
  });
});

describe('RLS — tenant_directory_listing', () => {
  it('SELECT é livre para qualquer tenant', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsDir1-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsDir2-' + Date.now() });
    // superuser insert into tenant_chat_settings triggers sync_directory (SECURITY DEFINER)
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true), ($2, true)`,
      [t1.tenantId, t2.tenantId]
    );

    // t1 context sees both rows (SELECT is free via tdl_select USING(true))
    const seen = await withTenant(appPool, t1.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT tenant_id FROM tenant_directory_listing WHERE name LIKE 'chat-test-RlsDir%'`
      );
      return rows.length;
    });
    expect(seen).toBe(2);  // tenant t1 vê t2 também
  });

  it('UPDATE só afeta a própria linha', async () => {
    const t1 = await fixtures.createTenant({ name: 'RlsDirU1-' + Date.now() });
    const t2 = await fixtures.createTenant({ name: 'RlsDirU2-' + Date.now() });
    await pool.query(
      `INSERT INTO tenant_chat_settings (tenant_id, visible_in_directory) VALUES ($1, true), ($2, true)`,
      [t1.tenantId, t2.tenantId]
    );

    const updated = await withTenant(appPool, t1.tenantId, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE tenant_directory_listing SET region_uf = 'RJ'`
      );
      return rowCount;
    });
    expect(updated).toBe(1);
  });
});

// ── Par-based RLS tests ───────────────────────────────────────────────

async function createConversation(a, b) {
  const { rows: [conv] } = await pool.query(
    `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module)
     VALUES ($1, $2, 'human') RETURNING id`,
    [a.tenantId, b.tenantId]
  );
  return conv.id;
}

describe('RLS — tenant_conversations (par-based)', () => {
  it('membro vê a conversa', async () => {
    const { a, b } = await fixtures.createPair();
    const convId = await createConversation(a, b);

    const seen = await withTenant(appPool, a.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_conversations WHERE id = $1`, [convId]);
      return rows.length;
    });
    expect(seen).toBe(1);
  });

  it('não-membro NÃO vê a conversa', async () => {
    const { a, b } = await fixtures.createPair();
    const c3 = await fixtures.createTenant({ name: 'NonMember-' + Date.now() });
    const convId = await createConversation(a, b);

    const seen = await withTenant(appPool, c3.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_conversations WHERE id = $1`, [convId]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });
});

describe('RLS — tenant_messages (par-based via conversation_id)', () => {
  it('membro vê mensagens da própria conversa', async () => {
    const { a, b } = await fixtures.createPair();
    const convId = await createConversation(a, b);
    await pool.query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
       VALUES ($1, $2, $3, 'olá')`,
      [convId, a.tenantId, a.userId]
    );

    const seen = await withTenant(appPool, b.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_messages WHERE conversation_id = $1`, [convId]);
      return rows.length;
    });
    expect(seen).toBe(1);
  });

  it('não-membro NÃO vê mensagens da conversa alheia', async () => {
    const { a, b } = await fixtures.createPair();
    const c3 = await fixtures.createTenant({ name: 'NonMemberMsg-' + Date.now() });
    const convId = await createConversation(a, b);
    await pool.query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
       VALUES ($1, $2, $3, 'segredo')`,
      [convId, a.tenantId, a.userId]
    );

    const seen = await withTenant(appPool, c3.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_messages WHERE conversation_id = $1`, [convId]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });
});

describe('RLS — tenant_invitations', () => {
  it('remetente vê seu convite enviado', async () => {
    const { a, b } = await fixtures.createPair();
    const { rows: [inv] } = await pool.query(
      `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id)
       VALUES ($1, $2, 'human', 'pending', $3) RETURNING id`,
      [a.tenantId, b.tenantId, a.userId]
    );

    const seen = await withTenant(appPool, a.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_invitations WHERE id = $1`, [inv.id]);
      return rows.length;
    });
    expect(seen).toBe(1);
  });

  it('destinatário vê o convite recebido', async () => {
    const { a, b } = await fixtures.createPair();
    const { rows: [inv] } = await pool.query(
      `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id)
       VALUES ($1, $2, 'human', 'pending', $3) RETURNING id`,
      [a.tenantId, b.tenantId, a.userId]
    );

    const seen = await withTenant(appPool, b.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_invitations WHERE id = $1`, [inv.id]);
      return rows.length;
    });
    expect(seen).toBe(1);
  });

  it('terceiro NÃO vê o convite alheio', async () => {
    const { a, b } = await fixtures.createPair();
    const c3 = await fixtures.createTenant({ name: 'NonMemberInv-' + Date.now() });
    const { rows: [inv] } = await pool.query(
      `INSERT INTO tenant_invitations (from_tenant_id, to_tenant_id, module, status, sent_by_user_id)
       VALUES ($1, $2, 'human', 'pending', $3) RETURNING id`,
      [a.tenantId, b.tenantId, a.userId]
    );

    const seen = await withTenant(appPool, c3.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT id FROM tenant_invitations WHERE id = $1`, [inv.id]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });
});

describe('RLS — UPDATE WITH CHECK (anti-hijack)', () => {
  it('tenant não consegue reassignar tenant_b para tenant alheio (tenant_conversations)', async () => {
    const { a, b } = await fixtures.createPair();
    const c3 = await fixtures.createTenant({ name: 'Hijack-' + Date.now() });
    const convId = await createConversation(a, b);

    // tenant a tries to swap b for c3
    await expect(
      withTenant(appPool, a.tenantId, async (client) => {
        // canonical order: rebuild pair with c3
        const [newA, newB] = a.tenantId < c3.tenantId ? [a.tenantId, c3.tenantId] : [c3.tenantId, a.tenantId];
        return client.query(
          `UPDATE tenant_conversations SET tenant_a_id = $1, tenant_b_id = $2 WHERE id = $3`,
          [newA, newB, convId]
        );
      })
    ).rejects.toThrow(/policy|check|denied|proibido|imutáveis/i);
  });

  it('tenant não consegue mover mensagem para conversa alheia (tenant_messages)', async () => {
    const { a, b } = await fixtures.createPair();
    const { a: x, b: y } = await fixtures.createPair();
    const convAB = await createConversation(a, b);
    const convXY = await createConversation(x, y);

    const { rows: [msg] } = await pool.query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body, has_attachment)
       VALUES ($1, $2, $3, 'oi', false) RETURNING id`,
      [convAB, a.tenantId, a.userId]
    );

    // tenant a (member of A↔B but NOT of X↔Y) tries to move the message to X↔Y conv
    await expect(
      withTenant(appPool, a.tenantId, async (client) => {
        return client.query(
          `UPDATE tenant_messages SET conversation_id = $1 WHERE id = $2`,
          [convXY, msg.id]
        );
      })
    ).rejects.toThrow(/policy|check|denied/i);
  });

  it('tenant não consegue reassignar tenant_id em tenant_conversation_reads', async () => {
    const { a, b } = await fixtures.createPair();
    const c3 = await fixtures.createTenant({ name: 'HijackReads-' + Date.now() });
    const convId = await createConversation(a, b);

    // a creates a read receipt for itself
    await pool.query(
      `INSERT INTO tenant_conversation_reads (conversation_id, tenant_id) VALUES ($1, $2)`,
      [convId, a.tenantId]
    );

    // a tries to swap tenant_id to c3
    await expect(
      withTenant(appPool, a.tenantId, async (client) => {
        return client.query(
          `UPDATE tenant_conversation_reads SET tenant_id = $1 WHERE conversation_id = $2 AND tenant_id = $3`,
          [c3.tenantId, convId, a.tenantId]
        );
      })
    ).rejects.toThrow(/policy|check|denied/i);
  });
});
