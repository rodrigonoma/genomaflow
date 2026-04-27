const fp = require('fastify-plugin');
const Redis = require('ioredis');

module.exports = fp(async function (fastify) {
  const subscriber = new Redis(process.env.REDIS_URL);

  // tenantId → Set of open WebSocket connections
  const connections = new Map();

  fastify.decorate('registerWsClient', (tenantId, ws) => {
    if (!connections.has(tenantId)) connections.set(tenantId, new Set());
    connections.get(tenantId).add(ws);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => connections.get(tenantId)?.delete(ws));
  });

  // Heartbeat — detecta conexões mortas a cada 30s
  const heartbeatInterval = setInterval(() => {
    for (const clients of connections.values()) {
      for (const ws of clients) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 30_000);

  fastify.decorate('notifyTenant', (tenantId, data) => {
    const clients = connections.get(tenantId);
    if (!clients) return;
    const message = JSON.stringify(data);
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(message);
    }
  });

  subscriber.psubscribe(
    'exam:done:*', 'exam:error:*',
    'billing:alert:*', 'billing:exhausted:*',
    'chat:event:*',
    'appointment:event:*',
    'subject:upserted:*',
    (err) => {
      if (err) fastify.log.error('Redis psubscribe error:', err);
    }
  );

  subscriber.on('pmessage', (_pattern, channel, message) => {
    let tenantId, payload;
    if (channel.startsWith('exam:done:')) {
      tenantId = channel.replace('exam:done:', '');
      payload = { event: 'exam:done', ...JSON.parse(message) };
    } else if (channel.startsWith('exam:error:')) {
      tenantId = channel.replace('exam:error:', '');
      payload = { event: 'exam:error', ...JSON.parse(message) };
    } else if (channel.startsWith('billing:alert:')) {
      tenantId = channel.replace('billing:alert:', '');
      payload = { event: 'billing:alert', ...JSON.parse(message) };
    } else if (channel.startsWith('billing:exhausted:')) {
      tenantId = channel.replace('billing:exhausted:', '');
      payload = { event: 'billing:exhausted', ...JSON.parse(message) };
    } else if (channel.startsWith('chat:event:')) {
      // Chat events: a mensagem JSON já traz 'event' e todos os campos.
      // O channel suffix é o tenant destinatário.
      tenantId = channel.replace('chat:event:', '');
      payload = JSON.parse(message);
    } else if (channel.startsWith('appointment:event:')) {
      // Appointment events (criados via UI ou via Copilot tools).
      // Mensagem JSON já traz 'event' (created/updated/cancelled) e payload.
      tenantId = channel.replace('appointment:event:', '');
      payload = JSON.parse(message);
    } else if (channel.startsWith('subject:upserted:')) {
      // Subject (paciente/animal) criado ou atualizado. Worker já consome
      // este canal pra re-indexar RAG; aqui propagamos pro frontend pra
      // refrescar a tela de Pacientes em tempo real.
      tenantId = channel.replace('subject:upserted:', '');
      payload = { event: 'subject:upserted', ...JSON.parse(message) };
    } else {
      return;
    }
    fastify.notifyTenant(tenantId, payload);
  });

  fastify.addHook('onClose', (_instance, done) => {
    clearInterval(heartbeatInterval);
    subscriber.quit().then(() => done()).catch(done);
  });
});
