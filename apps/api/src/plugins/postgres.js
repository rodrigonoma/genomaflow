const fp = require('fastify-plugin');
const { Pool } = require('pg');

function poolConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
  };
}

module.exports = fp(async function (fastify) {
  const pool = new Pool(poolConfig());
  fastify.decorate('pg', pool);
  fastify.addHook('onClose', async () => pool.end());
});
