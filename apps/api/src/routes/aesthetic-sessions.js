'use strict';

/**
 * Routes /aesthetic/sessions (V2 advanced tier)
 *
 * - POST   /aesthetic/sessions       cria session wrapper
 * - GET    /aesthetic/sessions       lista sessions de um subject
 * - GET    /aesthetic/sessions/:id   detalhe
 *
 * Todas gated por requireEsteticaModule + fastify.authenticate.
 * Spec: docs/superpowers/specs/2026-05-12-aesthetic-v2-fase1-design.md §7.1-7.3
 */

const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const {
  createSession,
  listForSubject,
  getById,
} = require('../services/aesthetic-sessions');

module.exports = async function (fastify) {
  // -------------------------------------------------------------------------
  // POST /aesthetic/sessions
  // -------------------------------------------------------------------------
  fastify.post('/sessions', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { subject_id, session_type, notes } = request.body || {};

    if (!subject_id) {
      return reply.status(400).send({ error: 'subject_id obrigatório' });
    }
    if (!session_type) {
      return reply.status(400).send({ error: 'session_type obrigatório' });
    }

    try {
      const session = await createSession(fastify.pg, {
        tenantId: request.user.tenant_id,
        subjectId: subject_id,
        userId: request.user.user_id,
        sessionType: session_type,
        notes,
      });
      return reply.status(201).send(session);
    } catch (e) {
      if (e.status === 400) {
        return reply.status(400).send({ error: e.message });
      }
      throw e;
    }
  });

  // -------------------------------------------------------------------------
  // GET /aesthetic/sessions?subject_id=X
  // -------------------------------------------------------------------------
  fastify.get('/sessions', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { subject_id, limit, offset } = request.query;
    if (!subject_id) {
      return reply.status(400).send({ error: 'subject_id obrigatório' });
    }
    const items = await listForSubject(fastify.pg, {
      tenantId: request.user.tenant_id,
      subjectId: subject_id,
      limit: Math.min(100, Math.max(1, parseInt(limit) || 20)),
      offset: Math.max(0, parseInt(offset) || 0),
    });
    return reply.send({ items });
  });

  // -------------------------------------------------------------------------
  // GET /aesthetic/sessions/:id
  // -------------------------------------------------------------------------
  fastify.get('/sessions/:id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const session = await getById(fastify.pg, {
      tenantId: request.user.tenant_id,
      sessionId: request.params.id,
    });
    if (!session) {
      return reply.status(404).send({ error: 'Sessão não encontrada' });
    }
    return reply.send(session);
  });
};
