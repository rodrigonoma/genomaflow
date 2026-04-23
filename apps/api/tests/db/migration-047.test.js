const { Pool } = require('pg');

const TABLES = [
  'tenant_chat_settings',
  'tenant_directory_listing',
  'tenant_invitations',
  'tenant_blocks',
  'tenant_conversations',
  'tenant_messages',
  'tenant_message_attachments',
  'tenant_message_pii_checks',
  'tenant_message_reactions',
  'tenant_conversation_reads',
];

let pool;

beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST }); });
afterAll(async () => { await pool.end(); });

describe('Migration 047 — schema', () => {
  it.each(TABLES)('cria a tabela %s', async (table) => {
    const { rows } = await pool.query(
      `SELECT to_regclass($1) AS exists`, [table]
    );
    expect(rows[0].exists).toBe(table);
  });

  it('habilita extensão pg_trgm', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`
    );
    expect(rows.length).toBe(1);
  });

  it('cria índice GIN trigram em tenant_directory_listing.name', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'tenant_directory_listing'
         AND indexname = 'tenant_directory_name_trgm'`
    );
    expect(rows.length).toBe(1);
  });

  it('cria índice GIN tsvector em tenant_messages.body_tsv', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'tenant_messages'
         AND indexname = 'tenant_messages_search_gin'`
    );
    expect(rows.length).toBe(1);
  });
});

describe('Migration 047 — privileges and constraints', () => {
  it('genomaflow_app tem SELECT em tenant_messages', async () => {
    const { rows } = await pool.query(
      `SELECT has_table_privilege('genomaflow_app', 'tenant_messages', 'SELECT') AS allowed`
    );
    expect(rows[0].allowed).toBe(true);
  });

  it('genomaflow_app tem INSERT em tenant_invitations', async () => {
    const { rows } = await pool.query(
      `SELECT has_table_privilege('genomaflow_app', 'tenant_invitations', 'INSERT') AS allowed`
    );
    expect(rows[0].allowed).toBe(true);
  });

  it('rejeita mensagem com body vazio E sem anexo', async () => {
    const { rows: [t] } = await pool.query(
      `INSERT INTO tenants (name, type, module) VALUES ('chat-test-Empty-' || extract(epoch from now()), 'clinic', 'human') RETURNING id`
    );
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, 'empty-' || extract(epoch from now()) || '@t.com', 'x', 'admin') RETURNING id`,
      [t.id]
    );
    const { rows: [t2] } = await pool.query(
      `INSERT INTO tenants (name, type, module) VALUES ('chat-test-Empty2-' || extract(epoch from now()), 'clinic', 'human') RETURNING id`
    );
    const [a, b] = t.id < t2.id ? [t.id, t2.id] : [t2.id, t.id];
    const { rows: [conv] } = await pool.query(
      `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module) VALUES ($1, $2, 'human') RETURNING id`,
      [a, b]
    );
    await expect(
      pool.query(
        `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body, has_attachment)
         VALUES ($1, $2, $3, '', false)`,
        [conv.id, t.id, u.id]
      )
    ).rejects.toThrow(/check constraint|tenant_messages_body_or_attachment/i);

    // cleanup
    await pool.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [t.id, t2.id]);
  });

  it('rejeita attachment de pdf sem s3_key', async () => {
    const { rows: [t] } = await pool.query(
      `INSERT INTO tenants (name, type, module) VALUES ('chat-test-Att-' || extract(epoch from now()), 'clinic', 'human') RETURNING id`
    );
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, 'att-' || extract(epoch from now()) || '@t.com', 'x', 'admin') RETURNING id`,
      [t.id]
    );
    const { rows: [t2] } = await pool.query(
      `INSERT INTO tenants (name, type, module) VALUES ('chat-test-Att2-' || extract(epoch from now()), 'clinic', 'human') RETURNING id`
    );
    const [a, b] = t.id < t2.id ? [t.id, t2.id] : [t2.id, t.id];
    const { rows: [conv] } = await pool.query(
      `INSERT INTO tenant_conversations (tenant_a_id, tenant_b_id, module) VALUES ($1, $2, 'human') RETURNING id`,
      [a, b]
    );
    const { rows: [msg] } = await pool.query(
      `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body, has_attachment)
       VALUES ($1, $2, $3, 'oi', true) RETURNING id`,
      [conv.id, t.id, u.id]
    );
    await expect(
      pool.query(
        `INSERT INTO tenant_message_attachments (message_id, kind, s3_key, payload)
         VALUES ($1, 'pdf', NULL, NULL)`,
        [msg.id]
      )
    ).rejects.toThrow(/check constraint|tenant_attachments_kind_payload_check/i);

    // cleanup — cascade: conversation → messages → attachments; then tenants
    await pool.query(`DELETE FROM tenant_conversations WHERE id = $1`, [conv.id]);
    await pool.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [t.id, t2.id]);
  });
});
