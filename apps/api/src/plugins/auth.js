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
  });
});
