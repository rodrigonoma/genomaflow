'use strict';

const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { VALID_ANALYSIS_TYPES } = require('../constants/aesthetic-metrics');
const { getBalance, debit } = require('../services/aesthetic-credits');
const { getConsent } = require('../services/aesthetic-consent');
const { createPending, validatePhotosOwnership } = require('../services/aesthetic-analyses');
const { enqueue } = require('../queues/aesthetic-analysis-queue');

const COST_BY_TYPE = {
  facial: Number(process.env.AESTHETIC_FACIAL_COST || 5),
  body_measurements: Number(process.env.AESTHETIC_BODY_COST || 5),
};

function costFor(analysisType) {
  return COST_BY_TYPE[analysisType] ?? 5;
}

module.exports = async function (fastify) {
  fastify.post('/analyses', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { analysis_type, subject_id, photo_ids, baseline_id } = request.body || {};

    // Validação básica
    if (!VALID_ANALYSIS_TYPES.includes(analysis_type)) {
      return reply.status(400).send({ error: `analysis_type deve ser um de: ${VALID_ANALYSIS_TYPES.join(', ')}` });
    }
    if (!subject_id) return reply.status(400).send({ error: 'subject_id obrigatório' });
    if (!Array.isArray(photo_ids) || photo_ids.length < 1 || photo_ids.length > 3) {
      return reply.status(400).send({ error: 'photo_ids deve ter 1 a 3 elementos' });
    }

    const tenantId = request.user.tenant_id;
    const userId = request.user.user_id;

    // Pre-flight 1: photos do tenant?
    const ownOk = await validatePhotosOwnership(fastify.pg, tenantId, photo_ids);
    if (!ownOk) return reply.status(400).send({ error: 'Uma ou mais photos não pertencem ao tenant ou foram apagadas' });

    // Pre-flight 2: consent confirmado?
    const consent = await getConsent(fastify.pg, tenantId, subject_id);
    if (!consent) {
      return reply.status(403).send({
        error: 'CONSENT_MISSING',
        message: 'Confirme o consentimento operacional do paciente antes de criar análise.',
      });
    }

    // Pre-flight 3: créditos suficientes?
    const cost = costFor(analysis_type);
    const balance = await getBalance(fastify.pg, tenantId);
    if (balance < cost) {
      return reply.status(402).send({
        error: 'INSUFFICIENT_CREDITS',
        message: `Análise custa ${cost} créditos. Saldo atual: ${balance}.`,
        current: balance,
        required: cost,
      });
    }

    // Cria registro pending
    const analysis = await createPending(fastify.pg, {
      tenantId, subjectId: subject_id, userId,
      analysisType: analysis_type, photoIds: photo_ids,
      baselineId: baseline_id, creditsCharged: cost,
    });

    // Debita créditos (idempotente via ref_id)
    await debit(fastify.pg, {
      tenantId, amount: cost, kind: `aesthetic_${analysis_type}_analysis`,
      description: `Análise ${analysis_type} IA`, refId: analysis.id, userId,
    });

    // Enqueue worker job
    await enqueue({
      analysis_id: analysis.id,
      tenant_id: tenantId,
      subject_id, user_id: userId,
      analysis_type, photo_ids,
      baseline_analysis_id: baseline_id,
      professional_type: request.user.professional_type,
    });

    return reply.status(201).send({
      analysis_id: analysis.id,
      status: 'pending',
      credits_charged: cost,
    });
  });
};
