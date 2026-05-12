'use strict';

const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const profileService = require('../services/aesthetic-profile');
const { computeAll } = require('../services/aesthetic-tmb');

module.exports = async function (fastify) {
  fastify.get('/profile/:subject_id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const profile = await profileService.get(fastify.pg, request.user.tenant_id, request.params.subject_id);
    if (profile === null) return reply.status(404).send({ error: 'Paciente não encontrado' });
    const computed = profile && Object.keys(profile).length ? computeAll(profile) : null;
    return reply.send({ profile: profile || {}, computed });
  });

  fastify.put('/profile/:subject_id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { error, profile } = profileService.validate(request.body || {});
    if (error) return reply.status(400).send({ error });
    const updated = await profileService.update(
      fastify.pg, request.user.tenant_id, request.user.user_id,
      request.params.subject_id, profile
    );
    if (!updated) return reply.status(404).send({ error: 'Paciente não encontrado' });
    const computed = computeAll(updated.aesthetic_profile);
    return reply.send({ profile: updated.aesthetic_profile, computed });
  });
};
