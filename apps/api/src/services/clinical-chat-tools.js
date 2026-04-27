'use strict';
/**
 * Tools clínicas (read-only) pro Copilot — exames + prescrições.
 *
 * V3 enxuto: leitura. Geração de receita por chat fica pra V4 (sensível —
 * exige CRM, assinatura, decisão clínica que não delegamos pra LLM em V1).
 *
 * Mesmo padrão de defesa em profundidade do agenda/patient tools.
 */

// ── Tool definitions ────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'list_recent_exams',
    description:
      'Lista exames recentes (todos pacientes ou filtrado por subject_id). ' +
      'Use quando usuário pergunta "qual último exame?", "exames pendentes", ' +
      '"exames da semana", etc. Sem subject_id = todos os pacientes da clínica.',
    input_schema: {
      type: 'object',
      properties: {
        subject_id: { type: 'string', description: 'UUID do paciente (opcional — vazio = todos)' },
        status: {
          type: 'string',
          enum: ['pending', 'processing', 'done', 'error'],
          description: 'Filtra por status. Default: done (com análise concluída)',
        },
        limit: { type: 'integer', description: 'Máximo de resultados (default 10, max 30)' },
      },
    },
  },
  {
    name: 'get_exam_summary',
    description:
      'Retorna resumo da análise IA de um exame específico: interpretação por agente, ' +
      'alertas críticos, scores de risco. Use quando usuário pede "como ficou o exame de X" ou ' +
      '"resumo do último exame da Maria".',
    input_schema: {
      type: 'object',
      properties: {
        exam_id: { type: 'string', description: 'UUID do exame' },
      },
      required: ['exam_id'],
    },
  },
  {
    name: 'list_recent_prescriptions',
    description:
      'Lista receitas recentes (todas ou filtrado por subject_id). Use quando usuário ' +
      'quer ver receitas geradas. agent_type=therapeutic ou nutrition.',
    input_schema: {
      type: 'object',
      properties: {
        subject_id: { type: 'string', description: 'UUID do paciente (opcional)' },
        agent_type: { type: 'string', enum: ['therapeutic', 'nutrition'] },
        limit: { type: 'integer', description: 'Máximo (default 10, max 30)' },
      },
    },
  },
  {
    name: 'get_prescription_details',
    description: 'Retorna itens completos e notas de uma receita específica.',
    input_schema: {
      type: 'object',
      properties: {
        prescription_id: { type: 'string', description: 'UUID da receita' },
      },
      required: ['prescription_id'],
    },
  },
];

// ── Executors ───────────────────────────────────────────────────────

const VALID_EXAM_STATUS = ['pending', 'processing', 'done', 'error'];

async function execListRecentExams(input, ctx) {
  const i = input || {};
  const limit = Math.min(30, Math.max(1, Number.isInteger(i.limit) ? i.limit : 10));
  const status = VALID_EXAM_STATUS.includes(i.status) ? i.status : 'done';

  const params = [ctx.tenant_id, status];
  let extra = '';
  if (i.subject_id) {
    params.push(i.subject_id);
    extra = ` AND e.subject_id = $${params.length}`;
  }

  const { rows } = await ctx.fastify.pg.query(
    `SELECT e.id, e.subject_id, e.status, e.review_status, e.file_type, e.created_at,
            s.name AS subject_name
     FROM exams e
     LEFT JOIN subjects s ON s.id = e.subject_id
     WHERE e.tenant_id = $1 AND e.status = $2${extra}
     ORDER BY e.created_at DESC
     LIMIT ${limit}`,
    params
  );
  return {
    total_returned: rows.length,
    exams: rows.map(r => ({
      id: r.id,
      subject_id: r.subject_id,
      subject_name: r.subject_name || 'desconhecido',
      status: r.status,
      review_status: r.review_status,
      file_type: r.file_type,
      created_at: r.created_at,
    })),
  };
}

async function execGetExamSummary(input, ctx) {
  if (!input?.exam_id) return { error: 'exam_id obrigatório' };

  // Carrega exam + subject + clinical_results em uma query
  const { rows: examRows } = await ctx.fastify.pg.query(
    `SELECT e.id, e.subject_id, e.status, e.review_status, e.file_type, e.created_at,
            s.name AS subject_name, s.subject_type, s.species, s.breed
     FROM exams e
     LEFT JOIN subjects s ON s.id = e.subject_id
     WHERE e.id = $1 AND e.tenant_id = $2`,
    [input.exam_id, ctx.tenant_id]
  );
  if (examRows.length === 0) return { error: 'not_found', message: 'Exame não encontrado.' };
  const exam = examRows[0];

  if (exam.status !== 'done') {
    return {
      id: exam.id,
      subject_name: exam.subject_name,
      status: exam.status,
      message: `Exame ainda não tem análise concluída (status: ${exam.status}).`,
    };
  }

  const { rows: results } = await ctx.fastify.pg.query(
    `SELECT agent_type, interpretation, risk_scores, alerts, model_version, created_at
     FROM clinical_results
     WHERE exam_id = $1 AND tenant_id = $2
     ORDER BY created_at ASC`,
    [input.exam_id, ctx.tenant_id]
  );

  return {
    id: exam.id,
    subject_id: exam.subject_id,
    subject_name: exam.subject_name,
    subject_type: exam.subject_type,
    file_type: exam.file_type,
    review_status: exam.review_status,
    created_at: exam.created_at,
    analyses: results.map(r => ({
      agent_type: r.agent_type,
      interpretation: r.interpretation,
      risk_scores: r.risk_scores,
      alerts_count: Array.isArray(r.alerts) ? r.alerts.length : 0,
      alerts: Array.isArray(r.alerts) ? r.alerts.slice(0, 5) : [],
      model_version: r.model_version,
    })),
    navigate_url: `/results/${exam.id}`,
  };
}

async function execListRecentPrescriptions(input, ctx) {
  const i = input || {};
  const limit = Math.min(30, Math.max(1, Number.isInteger(i.limit) ? i.limit : 10));

  const params = [ctx.tenant_id];
  let extra = '';
  if (i.subject_id) {
    params.push(i.subject_id);
    extra += ` AND p.subject_id = $${params.length}`;
  }
  if (i.agent_type === 'therapeutic' || i.agent_type === 'nutrition') {
    params.push(i.agent_type);
    extra += ` AND p.agent_type = $${params.length}`;
  }

  const { rows } = await ctx.fastify.pg.query(
    `SELECT p.id, p.subject_id, p.exam_id, p.agent_type,
            jsonb_array_length(p.items) AS items_count,
            p.created_at, s.name AS subject_name
     FROM prescriptions p
     LEFT JOIN subjects s ON s.id = p.subject_id
     WHERE p.tenant_id = $1${extra}
     ORDER BY p.created_at DESC
     LIMIT ${limit}`,
    params
  );
  return {
    total_returned: rows.length,
    prescriptions: rows.map(r => ({
      id: r.id,
      subject_id: r.subject_id,
      subject_name: r.subject_name || 'desconhecido',
      exam_id: r.exam_id,
      agent_type: r.agent_type,
      items_count: r.items_count,
      created_at: r.created_at,
    })),
  };
}

async function execGetPrescriptionDetails(input, ctx) {
  if (!input?.prescription_id) return { error: 'prescription_id obrigatório' };
  const { rows } = await ctx.fastify.pg.query(
    `SELECT p.id, p.subject_id, p.exam_id, p.agent_type, p.items, p.notes, p.pdf_url,
            p.created_at, s.name AS subject_name
     FROM prescriptions p
     LEFT JOIN subjects s ON s.id = p.subject_id
     WHERE p.id = $1 AND p.tenant_id = $2`,
    [input.prescription_id, ctx.tenant_id]
  );
  if (rows.length === 0) return { error: 'not_found', message: 'Receita não encontrada.' };
  const r = rows[0];
  return {
    id: r.id,
    subject_id: r.subject_id,
    subject_name: r.subject_name,
    exam_id: r.exam_id,
    agent_type: r.agent_type,
    items: r.items || [],
    notes: r.notes || null,
    has_pdf: !!r.pdf_url,
    created_at: r.created_at,
    navigate_url: `/results/${r.exam_id}`,
  };
}

const EXECUTORS = {
  list_recent_exams: execListRecentExams,
  get_exam_summary: execGetExamSummary,
  list_recent_prescriptions: execListRecentPrescriptions,
  get_prescription_details: execGetPrescriptionDetails,
};

async function executeTool(name, input, context) {
  const exec = EXECUTORS[name];
  if (!exec) return { error: `Tool desconhecida: ${name}`, latency_ms: 0 };
  const startedAt = Date.now();
  try {
    const result = await exec(input || {}, context);
    return { result, latency_ms: Date.now() - startedAt };
  } catch (err) {
    if (context.log?.error) {
      context.log.error({ err, tool: name, input }, 'clinical-chat-tools: executor error');
    }
    return { error: err.message || 'Erro interno', latency_ms: Date.now() - startedAt };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  EXECUTORS,
  executeTool,
};
