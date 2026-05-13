'use strict';

const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { VALID_ANALYSIS_TYPES, SENSITIVE_REGIONS } = require('../constants/aesthetic-metrics');
const { getBalance, debit } = require('../services/aesthetic-credits');
const { getConsent } = require('../services/aesthetic-consent');
const {
  createPending, validatePhotosOwnership, validatePhotosForAdvanced,
  listForSubject, getDetail, softDelete,
  getMetricsOnly, computeDeltas,
} = require('../services/aesthetic-analyses');
const { enqueue } = require('../queues/aesthetic-analysis-queue');
const { buildAnalysisPDF } = require('../services/aesthetic-pdf-export');

// Custo tier-aware. Standard preserva F1-F6 (5cr default). Advanced é 2x
// (10cr default) — captura guiada + landmarks + 10 métricas geométricas.
// Configurável via env: AESTHETIC_*_COST + AESTHETIC_*_COST_ADVANCED.
const COST_TABLE = {
  facial: {
    standard: Number(process.env.AESTHETIC_FACIAL_COST || 5),
    advanced: Number(process.env.AESTHETIC_FACIAL_COST_ADVANCED || 10),
  },
  body_measurements: {
    standard: Number(process.env.AESTHETIC_BODY_COST || 5),
    advanced: Number(process.env.AESTHETIC_BODY_COST_ADVANCED || 10),
  },
};

function costFor(analysisType, tier = 'standard') {
  const row = COST_TABLE[analysisType];
  if (!row) return 5;
  return row[tier] ?? row.standard ?? 5;
}

// Quantidade de fotos esperada por tier+analysis_type
function expectedPhotoCount(analysisType, tier) {
  if (tier !== 'advanced') return null;  // standard: 1-3 (range, não exato)
  if (analysisType === 'facial') return 5;
  return 4;  // todos demais analysis_types corporais em advanced = 4 fotos
}

module.exports = async function (fastify) {
  fastify.post('/analyses', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const {
      analysis_type, subject_id, photo_ids, baseline_id,
      session_id, tier: rawTier,
    } = request.body || {};

    // Normalize tier — default standard; unknown values caem em standard
    const tier = rawTier === 'advanced' ? 'advanced' : 'standard';

    // Validação básica
    if (!VALID_ANALYSIS_TYPES.includes(analysis_type)) {
      return reply.status(400).send({ error: `analysis_type deve ser um de: ${VALID_ANALYSIS_TYPES.join(', ')}` });
    }
    if (!subject_id) return reply.status(400).send({ error: 'subject_id obrigatório' });
    if (!Array.isArray(photo_ids) || photo_ids.length < 1) {
      return reply.status(400).send({ error: 'photo_ids obrigatório (array com 1+ elementos)' });
    }

    // Tier-specific validações
    if (tier === 'standard') {
      if (photo_ids.length > 3) {
        return reply.status(400).send({
          error: 'PHOTO_COUNT_OUT_OF_RANGE',
          message: 'tier=standard aceita 1 a 3 fotos. Para mais fotos use tier=advanced.',
        });
      }
    } else {
      // advanced
      if (!session_id) {
        return reply.status(400).send({
          error: 'SESSION_REQUIRED',
          message: 'tier=advanced exige session_id obrigatório.',
        });
      }
      const expected = expectedPhotoCount(analysis_type, tier);
      if (expected != null && photo_ids.length !== expected) {
        return reply.status(400).send({
          error: 'PHOTO_COUNT_MISMATCH',
          message: `tier=advanced para ${analysis_type} exige exatamente ${expected} fotos (recebeu ${photo_ids.length}).`,
          expected, received: photo_ids.length,
        });
      }
    }

    const tenantId = request.user.tenant_id;
    const userId = request.user.user_id;

    // Pre-flight 1: photos do tenant?
    const ownOk = await validatePhotosOwnership(fastify.pg, tenantId, photo_ids);
    if (!ownOk) return reply.status(400).send({ error: 'Uma ou mais photos não pertencem ao tenant ou foram apagadas' });

    // Pre-flight 1b: tier=advanced exige todas as fotos com pose + landmarks
    // pertencentes à mesma session_id passada
    if (tier === 'advanced') {
      const adv = await validatePhotosForAdvanced(fastify.pg, tenantId, photo_ids, session_id);
      if (!adv.ok) {
        return reply.status(400).send({
          error: adv.error,
          message: adv.error === 'PHOTOS_NOT_FOUND'
            ? 'Alguma foto não foi encontrada.'
            : 'Em tier=advanced, todas as fotos devem ter pose, landmarks e pertencer à session_id passada.',
        });
      }
    }

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

    // Pre-flight 3: créditos suficientes? (tier-aware cost)
    const cost = costFor(analysis_type, tier);
    const balance = await getBalance(fastify.pg, tenantId);
    if (balance < cost) {
      return reply.status(402).send({
        error: 'INSUFFICIENT_CREDITS',
        message: `Análise custa ${cost} créditos. Saldo atual: ${balance}.`,
        current: balance,
        required: cost,
        tier,
      });
    }

    // Cria registro pending (com tier + session_id)
    const analysis = await createPending(fastify.pg, {
      tenantId, subjectId: subject_id, userId,
      analysisType: analysis_type, photoIds: photo_ids,
      baselineId: baseline_id, creditsCharged: cost,
      sessionId: session_id || null,
      tier,
    });

    // Debita créditos com kind tier-aware
    const kind = tier === 'advanced'
      ? `aesthetic_${analysis_type}_analysis_advanced`
      : `aesthetic_${analysis_type}_analysis`;
    await debit(fastify.pg, {
      tenantId, amount: cost, kind,
      description: `Análise ${analysis_type} IA (${tier})`,
      refId: analysis.id, userId,
    });

    // Enqueue worker job — passa tier pro processor decidir se roda
    // o agente de landmarks-metrics (V2-E)
    await enqueue({
      analysis_id: analysis.id,
      tenant_id: tenantId,
      subject_id, user_id: userId,
      analysis_type, photo_ids,
      baseline_analysis_id: baseline_id,
      professional_type: request.user.professional_type,
      tier,
      session_id: session_id || null,
    });

    // Retorna `id` (consistente com AestheticAnalysisDetail do frontend) +
    // `analysis_id` (backward compat com consumers antigos). Frontend usa `id`.
    // Bug 2026-05-12: shape antigo só tinha analysis_id → frontend polling
    // `/analyses/undefined` com analysis.id (que era undefined).
    return reply.status(201).send({
      id: analysis.id,
      analysis_id: analysis.id,
      status: 'pending',
      credits_charged: cost,
      tier,
      session_id: session_id || null,
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
