'use strict';

const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { validate, list, getById, create, update, softDelete } = require('../services/aesthetic-treatments');

module.exports = async function (fastify) {
  fastify.get('/treatments', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { category, indication, limit } = request.query;
    const items = await list(fastify.pg, request.user.tenant_id, { category, indication, limit });
    return reply.send({ items });
  });

  fastify.post('/treatments', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    if (request.user.role !== 'admin' && request.user.role !== 'master') {
      return reply.status(403).send({ error: 'Apenas admin pode criar tratamentos proprietários' });
    }
    const err = validate(request.body);
    if (err) return reply.status(400).send({ error: err });
    const tx = await create(fastify.pg, request.user.tenant_id, request.user.user_id, request.body);
    return reply.status(201).send(tx);
  });

  fastify.put('/treatments/:id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    if (request.user.role !== 'admin' && request.user.role !== 'master') {
      return reply.status(403).send({ error: 'Apenas admin pode editar tratamentos proprietários' });
    }
    const tx = await update(fastify.pg, request.user.tenant_id, request.user.user_id, request.params.id, request.body || {});
    if (!tx) return reply.status(404).send({ error: 'Tratamento não encontrado ou não pertence ao tenant' });
    return reply.send(tx);
  });

  fastify.delete('/treatments/:id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    if (request.user.role !== 'admin' && request.user.role !== 'master') {
      return reply.status(403).send({ error: 'Apenas admin pode remover tratamentos proprietários' });
    }
    const ok = await softDelete(fastify.pg, request.user.tenant_id, request.user.user_id, request.params.id);
    if (!ok) return reply.status(404).send({ error: 'Tratamento não encontrado' });
    return reply.status(204).send();
  });
};
