const fp = require('fastify-plugin');
const Redis = require('ioredis');

module.exports = fp(async function (fastify) {
  const redis = new Redis(process.env.REDIS_URL);
  fastify.decorate('redis', redis);
  fastify.addHook('onClose', async () => redis.quit());
});
