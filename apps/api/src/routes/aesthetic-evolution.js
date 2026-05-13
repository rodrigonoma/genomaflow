'use strict';

/**
 * Route GET /aesthetic/subjects/:id/aesthetic-evolution (V2 Fase 4)
 *
 * Timeline temporal de aggregate scores pra renderizar como gráfico
 * ng2-charts no frontend (6 séries linha).
 *
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase4-design.md §5.3
 */

const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { listEvolutionPoints } = require('../services/aesthetic-evolution');

module.exports = async function (fastify) {
  fastify.get('/subjects/:id/aesthetic-evolution', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const tenantId = request.user.tenant_id;
    const subjectId = request.params.id;
    const limit = Math.min(100, Math.max(1, parseInt(request.query?.limit || 50)));

    // Set tenant context pra RLS — service NÃO usa withTenant porque é só SELECT
    await fastify.pg.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const result = await listEvolutionPoints(fastify.pg, {
      tenantId, subjectId, limit,
    });
    return reply.send(result);
  });
};
