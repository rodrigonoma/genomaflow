require('dotenv').config();
const Fastify = require('fastify');

// maxParamLength: 500 — default Fastify é 100, mas JWT do video/join/:token tem ~290 chars
const app = Fastify({ logger: true, trustProxy: true, maxParamLength: 500 });

// Raw body parser — necessário pra validação de signature do webhook Stripe.
// Default Fastify parseia JSON automaticamente, mas Stripe valida sobre o
// body bruto. Aqui guardamos os bytes originais em request.rawBody pra todas
// as rotas (overhead negligível) e mantemos parsing JSON normal.
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  req.rawBody = body;
  try {
    const json = body.length > 0 ? JSON.parse(body.toString('utf8')) : {};
    done(null, json);
  } catch (err) {
    done(err, undefined);
  }
});

// AWS SNS posta notifications com Content-Type: text/plain (body é JSON puro
// mesmo assim — quirk da AWS). Webhook /webhooks/ses precisa parsear.
// Parser tenta JSON; se falhar, retorna o body como string (caller decide).
app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
  if (!body) return done(null, {});
  try {
    done(null, JSON.parse(body));
  } catch (_err) {
    // Não é JSON — passa string mesmo. Callers devem tratar.
    done(null, body);
  }
});

app.register(require('@fastify/cors'), {
  origin: [
    'https://app.genomaflow.com.br',
    'capacitor://localhost',
    'http://localhost',
    'https://localhost',
    /^http:\/\/localhost(:\d+)?$/,
  ],
  credentials: true,
});

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
  fastify.register(require('./routes/auth-email'),  { prefix: '/auth' });
  fastify.register(require('./routes/patients'),    { prefix: '/patients' });
  fastify.register(require('./routes/exams'),       { prefix: '/exams' });
  fastify.register(require('./routes/alerts'),      { prefix: '/alerts' });
  fastify.register(require('./routes/users'),       { prefix: '/users' });
  fastify.register(require('./routes/integrations'),{ prefix: '/integrations' });
  fastify.register(require('./routes/billing'),     { prefix: '' });
  fastify.register(require('./routes/onboarding-checkout'), { prefix: '' });
  fastify.register(require('./routes/encounters'),  { prefix: '/encounters' });
  fastify.register(require('./routes/vaccines'),    { prefix: '/vaccines' });
  fastify.register(require('./routes/clinical-documents'), { prefix: '/clinical-documents' });
  fastify.register(require('./routes/nps'),         { prefix: '/nps' });
  fastify.register(require('./routes/notifications'),{ prefix: '/notifications' });
  fastify.register(require('./routes/portal'),      { prefix: '/portal' });
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
  fastify.register(require('./routes/product-help'),      { prefix: '/product-help' });
  fastify.register(require('./routes/agenda'),            { prefix: '/agenda' });
  fastify.register(require('./routes/video'),             { prefix: '/video' });
  fastify.register(require('./routes/aesthetic-consent'),  { prefix: '/aesthetic' });
  fastify.register(require('./routes/aesthetic-photos'),   { prefix: '/aesthetic' });
  fastify.register(require('./routes/webhooks/stripe'),   { prefix: '' });
  fastify.register(require('./routes/webhooks/ses'),      { prefix: '/webhooks' });
  done();
}, { prefix: API_PREFIX });

if (require.main === module) {
  app.listen({ port: 3000, host: '0.0.0.0' });
}

module.exports = app;
