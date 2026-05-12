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
    const { error, profile, warnings } = profileService.validate(request.body || {});
    if (error) return reply.status(400).send({ error });
    const updated = await profileService.update(
      fastify.pg, request.user.tenant_id, request.user.user_id,
      request.params.subject_id, profile
    );
    if (!updated) return reply.status(404).send({ error: 'Paciente não encontrado' });
    const computed = computeAll(updated.aesthetic_profile);
    return reply.send({ profile: updated.aesthetic_profile, computed, warnings: warnings || [] });
  });

  fastify.get('/profile/:subject_id/history', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const tenantId = request.user.tenant_id;
    const subjectId = request.params.subject_id;
    const limit = Math.min(50, parseInt(request.query.limit) || 20);

    // Confirm subject belongs to tenant before exposing audit data
    const { rows: sub } = await fastify.pg.query(
      `SELECT id FROM subjects WHERE id = $1 AND tenant_id = $2`,
      [subjectId, tenantId]
    );
    if (!sub[0]) return reply.status(404).send({ error: 'Paciente não encontrado' });

    const { rows } = await fastify.pg.query(
      `SELECT a.id, a.action, a.actor_user_id, a.actor_channel, a.changed_fields, a.created_at,
              (a.new_data->'aesthetic_profile') AS aesthetic_profile_after,
              (a.old_data->'aesthetic_profile') AS aesthetic_profile_before,
              u.email AS actor_email
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.tenant_id = $1 AND a.entity_type = 'subjects' AND a.entity_id = $2
         AND a.changed_fields @> ARRAY['aesthetic_profile']
       ORDER BY a.created_at DESC
       LIMIT $3`,
      [tenantId, subjectId, limit]
    );
    return reply.send({ items: rows });
  });
};
