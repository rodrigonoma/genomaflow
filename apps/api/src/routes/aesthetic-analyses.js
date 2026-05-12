'use strict';

const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { VALID_ANALYSIS_TYPES, SENSITIVE_REGIONS } = require('../constants/aesthetic-metrics');
const { getBalance, debit } = require('../services/aesthetic-credits');
const { getConsent } = require('../services/aesthetic-consent');
const { createPending, validatePhotosOwnership, listForSubject, getDetail, softDelete, getMetricsOnly, computeDeltas } = require('../services/aesthetic-analyses');
const { enqueue } = require('../queues/aesthetic-analysis-queue');
const { buildAnalysisPDF } = require('../services/aesthetic-pdf-export');

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

    // Pre-flight 2b: consentimento reforçado pra regiões sensíveis
    if (SENSITIVE_REGIONS.includes(analysis_type)) {
      const reinforced = Array.isArray(consent.reinforced_regions) ? consent.reinforced_regions : [];
      if (!reinforced.includes(analysis_type)) {
        return reply.status(403).send({
          error: 'CONSENT_REINFORCED_MISSING',
          message: `Análise da região "${analysis_type}" exige consentimento reforçado. Confirme com o paciente e re-registre o consentimento.`,
          analysis_type,
          missing_reinforced_region: analysis_type,
        });
      }
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

  // GET /aesthetic/analyses?subject_id=&type=&limit=&offset=
  fastify.get('/analyses', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { subject_id, type, limit, offset } = request.query;
    if (!subject_id) return reply.status(400).send({ error: 'subject_id obrigatório' });
    const items = await listForSubject(fastify.pg, {
      tenantId: request.user.tenant_id,
      subjectId: subject_id,
      analysisType: type,
      limit: Math.min(100, Math.max(1, parseInt(limit) || 20)),
      offset: Math.max(0, parseInt(offset) || 0),
    });
    return reply.send({ items });
  });

  // GET /aesthetic/analyses/:id
  fastify.get('/analyses/:id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const a = await getDetail(fastify.pg, request.params.id, request.user.tenant_id);
    if (!a) return reply.status(404).send({ error: 'Análise não encontrada' });
    return reply.send(a);
  });

  // DELETE /aesthetic/analyses/:id
  fastify.delete('/analyses/:id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const ok = await softDelete(fastify.pg, request.params.id, request.user.tenant_id, request.user.user_id);
    if (!ok) return reply.status(404).send({ error: 'Análise não encontrada' });
    return reply.status(204).send();
  });

  // POST /aesthetic/analyses/:id/compare
  fastify.post('/analyses/:id/compare', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { baseline_id } = request.body || {};
    if (!baseline_id) return reply.status(400).send({ error: 'baseline_id obrigatório' });
    const tenantId = request.user.tenant_id;
    const [baseline, current] = await Promise.all([
      getMetricsOnly(fastify.pg, baseline_id, tenantId),
      getMetricsOnly(fastify.pg, request.params.id, tenantId),
    ]);
    if (!baseline || !current) {
      return reply.status(404).send({ error: 'Análise (baseline ou atual) não encontrada ou ainda não concluída' });
    }
    const result = computeDeltas(baseline.metrics, current.metrics);
    return reply.send({
      baseline_id: baseline.id,
      current_id: current.id,
      deltas: result.deltas,
      overall_change: result.overall_change,
    });
  });

  // GET /aesthetic/analyses/:id/export.pdf
  fastify.get('/analyses/:id/export.pdf', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const tenantId = request.user.tenant_id;
    const detail = await getDetail(fastify.pg, request.params.id, tenantId);
    if (!detail) return reply.status(404).send({ error: 'Análise não encontrada' });

    const { rows: tRows } = await fastify.pg.query(
      'SELECT id, name FROM tenants WHERE id = $1',
      [tenantId]
    );
    const tenant = tRows[0] || null;

    const { rows: sRows } = await fastify.pg.query(
      'SELECT id, name, birth_date, sex FROM subjects WHERE id = $1 AND tenant_id = $2',
      [detail.subject_id, tenantId]
    );
    const subject = sRows[0] || null;

    const result = detail.result || {};
    try {
      const pdf = await buildAnalysisPDF({
        tenant, subject, analysis: detail,
        metrics: result.metrics || detail.metrics || {},
        treatments: result.treatment_protocol || [],
        lifestyle: result.lifestyle || null,
      });
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="analise-${detail.id}.pdf"`)
        .send(pdf);
    } catch (e) {
      request.log.error({ err: e }, 'pdf export failed');
      return reply.status(500).send({ error: 'BAD_PDF_GENERATION', message: 'Falha ao gerar PDF' });
    }
  });
};
