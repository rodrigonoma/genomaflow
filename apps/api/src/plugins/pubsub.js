const fp = require('fastify-plugin');
const Redis = require('ioredis');

module.exports = fp(async function (fastify) {
  const subscriber = new Redis(process.env.REDIS_URL);

  // tenantId → Set of open WebSocket connections
  const connections = new Map();

  fastify.decorate('registerWsClient', (tenantId, ws) => {
    if (!connections.has(tenantId)) connections.set(tenantId, new Set());
    connections.get(tenantId).add(ws);
    ws.on('close', () => connections.get(tenantId)?.delete(ws));
  });

  fastify.decorate('notifyTenant', (tenantId, data) => {
    const clients = connections.get(tenantId);
    if (!clients) return;
    const message = JSON.stringify(data);
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(message);
    }
  });

  subscriber.psubscribe('exam:done:*', (err) => {
    if (err) fastify.log.error('Redis psubscribe error:', err);
  });

  subscriber.on('pmessage', (_pattern, channel, message) => {
    const tenantId = channel.replace('exam:done:', '');
    fastify.notifyTenant(tenantId, { event: 'exam:done', ...JSON.parse(message) });
  });

  fastify.addHook('onClose', async () => subscriber.quit());
});
