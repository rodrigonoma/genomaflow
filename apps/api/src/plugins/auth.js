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
    //
    // EXCEÇÃO: tokens de impersonate (claim `impersonated_by` presente) PULAM essa
    // verificação. Isso permite o master atuar como o usuário do tenant sem derrubar
    // a sessão real (que continua ativa em outro device/aba) e sem o user real
    // derrubar a sessão de impersonate. Cada um vive em seu próprio jti.
    const { user_id, jti, impersonated_by } = request.user || {};
    if (user_id && jti && fastify.redis && !impersonated_by) {
      const activeJti = await fastify.redis.get(`session:${user_id}`);
      if (activeJti && activeJti !== jti) {
        return reply.status(401).send({ error: 'session_replaced', message: 'Sua sessão foi encerrada porque outro dispositivo fez login com esta conta.' });
      }
    }
  });
});
