'use strict';

/**
 * Routes /aesthetic/analyses/:id/depth (V2 Fase 3 Pseudo-3D facial)
 *
 * - POST  /aesthetic/analyses/:id/depth    cria depth model + enfileira worker
 * - GET   /aesthetic/analyses/:id/depth    consulta status (polling fallback)
 *
 * Tier advanced exclusivo (standard retorna 400 TIER_NOT_ADVANCED).
 * Sem custo de créditos extras — incluído nos 10cr do advanced.
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase3-design.md §6
 */

const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { getByAnalysisId, createPending } = require('../services/aesthetic-depth-models');
const { getDetail } = require('../services/aesthetic-analyses');
const { enqueue } = require('../queues/aesthetic-depth-queue');
const { signedUrlFor } = require('../services/aesthetic-s3');

async function buildResponse(fastify, depth, analysis) {
  const out = {
    id: depth.id,
    analysis_id: depth.analysis_id,
    status: depth.status,
    model_type: depth.model_type,
    created_at: depth.created_at,
    completed_at: depth.completed_at,
  };
  if (depth.error_code) {
    out.error_code = depth.error_code;
    out.error_message = depth.error_message;
  }
  if (depth.status === 'done') {
    if (depth.s3_key_depth) {
      out.depth_url = await signedUrlFor({ key: depth.s3_key_depth, ttlSeconds: 3600 });
    }
    if (depth.s3_key_glb) {
      out.glb_url = await signedUrlFor({ key: depth.s3_key_glb, ttlSeconds: 3600 });
    }
    if (depth.s3_key_texture) {
      out.texture_url = await signedUrlFor({ key: depth.s3_key_texture, ttlSeconds: 3600 });
    }
    if (depth.metadata) out.metadata = depth.metadata;
  }
  return out;
}

module.exports = async function (fastify) {
  // -------------------------------------------------------------------------
  // POST /aesthetic/analyses/:id/depth — cria depth model + enfileira worker
  // -------------------------------------------------------------------------
  fastify.post('/analyses/:id/depth', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const tenantId = request.user.tenant_id;
    const userId = request.user.user_id;
    const analysisId = request.params.id;

    // 1. Análise deve existir + ser advanced
    const analysis = await getDetail(fastify.pg, analysisId, tenantId);
    if (!analysis) {
      return reply.status(404).send({ error: 'Análise não encontrada' });
    }
    if (analysis.tier !== 'advanced') {
      return reply.status(400).send({
        error: 'TIER_NOT_ADVANCED',
        message: 'Modelo 3D disponível apenas em análises Avançadas (Captura Guiada).',
      });
    }
    if (analysis.status !== 'done') {
      return reply.status(400).send({
        error: 'ANALYSIS_NOT_DONE',
        message: 'Análise precisa estar concluída antes de gerar modelo 3D.',
      });
    }

    // 2. Idempotente: se já tem depth em done/processing/pending, retorna
    const existing = await getByAnalysisId(fastify.pg, { tenantId, analysisId });
    if (existing && existing.status !== 'error') {
      const body = await buildResponse(fastify, existing, analysis);
      return reply.send(body);
    }

    // 3. Cria pending + enfileira
    const depth = await createPending(fastify.pg, {
      tenantId, analysisId, userId, modelType: 'heightmap',
    });
    try {
      await enqueue({
        depth_id: depth.id,
        tenant_id: tenantId,
        analysis_id: analysisId,
        user_id: userId,
        model_type: 'heightmap',
      });
    } catch (err) {
      request.log.error({ err }, 'aesthetic-depth-queue enqueue failed');
      return reply.status(500).send({
        error: 'QUEUE_UNAVAILABLE',
        message: 'Falha ao agendar processamento. Tente novamente em instantes.',
      });
    }

    return reply.status(202).send({
      id: depth.id,
      analysis_id: analysisId,
      status: depth.status,
      model_type: depth.model_type,
    });
  });

  // -------------------------------------------------------------------------
  // GET /aesthetic/analyses/:id/depth — status + URLs S3
  // -------------------------------------------------------------------------
  fastify.get('/analyses/:id/depth', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const tenantId = request.user.tenant_id;
    const analysisId = request.params.id;

    const analysis = await getDetail(fastify.pg, analysisId, tenantId);
    if (!analysis) {
      return reply.status(404).send({ error: 'Análise não encontrada' });
    }

    const depth = await getByAnalysisId(fastify.pg, { tenantId, analysisId });
    if (!depth) {
      return reply.status(404).send({ error: 'Modelo 3D não foi gerado ainda' });
    }

    const body = await buildResponse(fastify, depth, analysis);
    return reply.send(body);
  });
};
