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
