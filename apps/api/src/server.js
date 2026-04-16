require('dotenv').config();
const Fastify = require('fastify');

const app = Fastify({ logger: true });

app.register(require('./plugins/postgres'));
app.register(require('./plugins/redis'));
app.register(require('./plugins/auth'));
app.register(require('@fastify/multipart'), {
  limits: { fileSize: 20 * 1024 * 1024 }
});
app.register(require('@fastify/websocket'));
app.register(require('./plugins/pubsub'));

app.register(require('./routes/auth'), { prefix: '/auth' });
app.register(require('./routes/patients'), { prefix: '/patients' });
app.register(require('./routes/exams'), { prefix: '/exams' });
app.register(require('./routes/alerts'), { prefix: '/alerts' });
app.register(require('./routes/users'), { prefix: '/users' });
app.register(require('./routes/integrations'), { prefix: '/integrations' });

if (require.main === module) {
  app.listen({ port: 3000, host: '0.0.0.0' });
}

module.exports = app;
