const fp = require('fastify-plugin');
const jwt = require('@fastify/jwt');

module.exports = fp(async function (fastify) {
  fastify.register(jwt, { secret: process.env.JWT_SECRET });

  fastify.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch (headerErr) {
      // WebSocket connections pass token as ?token= query param
      const token = request.query && request.query.token;
      if (!token) throw headerErr;
      try {
        request.user = fastify.jwt.verify(token);
      } catch {
        throw headerErr;
      }
    }

    // Single-session enforcement: o jti do token precisa bater com o armazenado no Redis.
    // Se outro login acontecer, o Redis é sobrescrito e este token passa a ser inválido.
    // Tokens antigos (pré-jti, emitidos antes deste deploy) são tolerados para não
    // forçar deslogamento em massa — próximo login já ganha jti e entra no regime.
    const { user_id, jti } = request.user || {};
    if (user_id && jti && fastify.redis) {
      const activeJti = await fastify.redis.get(`session:${user_id}`);
      if (activeJti && activeJti !== jti) {
        return reply.status(401).send({ error: 'session_replaced', message: 'Sua sessão foi encerrada porque outro dispositivo fez login com esta conta.' });
      }
    }
  });
});
