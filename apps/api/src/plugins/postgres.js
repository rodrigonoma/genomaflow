const fp = require('fastify-plugin');
const { Pool } = require('pg');

module.exports = fp(async function (fastify) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  fastify.decorate('pg', pool);
  fastify.addHook('onClose', async () => pool.end());
});
