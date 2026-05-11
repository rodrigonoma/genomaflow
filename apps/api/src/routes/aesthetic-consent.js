'use strict';

const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { getConsent, createConsent } = require('../services/aesthetic-consent');

module.exports = async function (fastify) {
  // POST /aesthetic/consent
  fastify.post('/consent', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { subject_id, notes, reinforced_regions } = request.body || {};
    if (!subject_id) {
      return reply.status(400).send({ error: 'subject_id obrigatório' });
    }
    if (reinforced_regions && !Array.isArray(reinforced_regions)) {
      return reply.status(400).send({ error: 'reinforced_regions deve ser array' });
    }

    const consent = await createConsent(fastify.pg, {
      tenantId: request.user.tenant_id,
      subjectId: subject_id,
      userId: request.user.user_id,
      notes: notes ? String(notes).slice(0, 1000) : null,
      reinforcedRegions: reinforced_regions || [],
      ip: request.ip || null,
      userAgent: request.headers['user-agent'] ? String(request.headers['user-agent']).slice(0, 500) : null,
    });

    return reply.status(201).send({ id: consent.id, confirmed: true, created_at: consent.created_at });
  });

  // GET /aesthetic/consent/:subject_id
  fastify.get('/consent/:subject_id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { subject_id } = request.params;
    const consent = await getConsent(fastify.pg, request.user.tenant_id, subject_id);
    if (!consent) return reply.send({ confirmed: false });
    return reply.send({
      confirmed: true,
      id: consent.id,
      created_at: consent.created_at,
      reinforced_regions: consent.reinforced_regions || [],
    });
  });
};
