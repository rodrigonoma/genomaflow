require('dotenv').config();
const Fastify = require('fastify');

const app = Fastify({ logger: true, trustProxy: true });

app.register(require('./plugins/postgres'));
app.register(require('./plugins/redis'));
app.register(require('./plugins/auth'));
app.register(require('@fastify/multipart'), {
  limits: { fileSize: 20 * 1024 * 1024 }
});
app.register(require('@fastify/websocket'));
app.register(require('@fastify/rate-limit'), {
  global: false,
  keyGenerator: (request) =>
    request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip,
  errorResponseBuilder: (_request, context) => {
    const err = new Error(`Muitas tentativas. Tente novamente em ${context.after}.`);
    err.statusCode = 429;
    return err;
  }
});
app.register(require('./plugins/pubsub'));

const API_PREFIX = process.env.API_PREFIX || '';

app.register((fastify, _opts, done) => {
  fastify.register(require('./routes/auth'),        { prefix: '/auth' });
  fastify.register(require('./routes/patients'),    { prefix: '/patients' });
  fastify.register(require('./routes/exams'),       { prefix: '/exams' });
  fastify.register(require('./routes/alerts'),      { prefix: '/alerts' });
  fastify.register(require('./routes/users'),       { prefix: '/users' });
  fastify.register(require('./routes/integrations'),{ prefix: '/integrations' });
  fastify.register(require('./routes/billing'),     { prefix: '' });
  fastify.register(require('./routes/feedback'),    { prefix: '/feedback' });
  fastify.register(require('./routes/error-log'),   { prefix: '/error-log' });
  fastify.register(require('./routes/chat'),          { prefix: '/chat' });
  fastify.register(require('./routes/prescriptions'), { prefix: '/prescriptions' });
  fastify.register(require('./routes/prescription-templates'), { prefix: '/prescription-templates' });
  fastify.register(require('./routes/dashboard'), { prefix: '/dashboard' });
  fastify.register(require('./routes/clinic'),        { prefix: '/clinic' });
  fastify.register(require('./routes/master'),        { prefix: '/master' });
  fastify.register(require('./routes/terms'),         { prefix: '/terms' });
  fastify.register(require('./routes/inter-tenant-chat'), { prefix: '/inter-tenant-chat' });
  done();
}, { prefix: API_PREFIX });

if (require.main === module) {
  app.listen({ port: 3000, host: '0.0.0.0' });
}

module.exports = app;
