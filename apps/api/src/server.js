
const Fastify = require('fastify');
const jwt = require('@fastify/jwt');
const { orchestrate } = require('../../agents/orchestrator');

const app = Fastify();

app.register(jwt, { secret: 'supersecret' });

app.decorate("authenticate", async function(request, reply) {
  await request.jwtVerify();
});

app.post('/login', async () => {
  return { token: app.jwt.sign({ tenant_id: "tenant1" }) };
});

app.post('/chat', { preHandler: [app.authenticate] }, async (req) => {
  const { message } = req.body;
  return await orchestrate({ message });
});

app.listen({ port: 3000 });
