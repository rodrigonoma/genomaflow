'use strict';
/**
 * Tool definitions + executors pro Copilot de Ajuda agir na agenda.
 *
 * Cada tool tem:
 *   - definition: shape exposto ao Anthropic SDK (name, description, input_schema)
 *   - executor: fn(input, context) → Promise<result>
 *
 * Executors SEMPRE usam tenant_id/user_id do context (vindos do JWT verificado),
 * nunca dos args do LLM. Defesa contra prompt injection que tenta override.
 *
 * Spec: docs/superpowers/specs/2026-04-26-agenda-chat-actions-design.md §6
 */

const { withTenant } = require('../db/tenant');

const VALID_DURATION = [30, 45, 60, 75, 90, 105, 120];
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/**
 * Formata ISO UTC pra string legível no timezone do tenant.
 * Saída: "DD/MM/YYYY HH:mm" em pt-BR no fuso correto.
 *
 * Importante: o LLM recebe ISO UTC como start_at + esta string formatada
 * como start_at_local. Quando fala com o usuário, deve usar a versão local;
 * quando chama tools (input start_at), continua passando ISO com offset.
 */
function formatLocal(isoString, timezone) {
  if (!isoString) return null;
  const tz = timezone || DEFAULT_TIMEZONE;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const datePart = d.toLocaleDateString('pt-BR', {
      timeZone: tz,
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
    const timePart = d.toLocaleTimeString('pt-BR', {
      timeZone: tz,
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return `${datePart} ${timePart}`;
  } catch (_) {
    // Timezone inválido — fallback pra default
    return formatLocal(isoString, DEFAULT_TIMEZONE);
  }
}

// ── Definitions (Anthropic SDK shape) ─────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'find_subject',
    description:
      'Busca pacientes/animais pelo nome no tenant atual. Retorna até 5 matches. ' +
      'Use ANTES de criar agendamento pra resolver ambiguidade.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Nome ou parte do nome do paciente/animal (mínimo 2 chars)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_my_agenda',
    description:
      'Lista os agendamentos do médico/veterinário logado num período. ' +
      'Use preset "today", "tomorrow", "this_week" OU passe from/to ISO. ' +
      'Sem args = semana atual.',
    input_schema: {
      type: 'object',
      properties: {
        preset: { type: 'string', enum: ['today', 'tomorrow', 'this_week'] },
        from: { type: 'string', description: 'ISO datetime (UTC)' },
        to: { type: 'string', description: 'ISO datetime (UTC)' },
      },
    },
  },
  {
    name: 'get_appointment_details',
    description:
      'Retorna detalhes completos de um agendamento por id. ' +
      'Use pra confirmar com o usuário antes de cancelar.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string', description: 'UUID do agendamento' },
      },
      required: ['appointment_id'],
    },
  },
  {
    name: 'create_appointment',
    description:
      'Cria novo agendamento. Use SOMENTE após resolver subject_id via find_subject. ' +
      'status="scheduled" exige subject_id; status="blocked" exige reason e proíbe subject_id.',
    input_schema: {
      type: 'object',
      properties: {
        start_at: { type: 'string', description: 'ISO datetime (UTC)' },
        duration_minutes: {
          type: 'integer',
          enum: [30, 45, 60, 75, 90, 105, 120],
        },
        status: { type: 'string', enum: ['scheduled', 'blocked'] },
        subject_id: {
          type: 'string',
          description: 'UUID do paciente/animal (obrigatório se scheduled)',
        },
        reason: {
          type: 'string',
          description: 'Motivo do bloqueio (obrigatório se blocked)',
        },
        notes: { type: 'string' },
      },
      required: ['start_at', 'duration_minutes', 'status'],
    },
  },
  {
    name: 'cancel_appointment',
    description:
      'Cancela agendamento existente. CRÍTICO: SEMPRE confirme com o usuário em ' +
      'mensagem de texto ANTES de chamar esta tool. Apresente os detalhes ' +
      '(paciente, data, hora) e pergunte "Confirma?". Só chame após resposta afirmativa.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: {
          type: 'string',
          description: 'UUID do agendamento a cancelar',
        },
      },
      required: ['appointment_id'],
    },
  },
  {
    name: 'update_appointment_status',
    description:
      'Atualiza o status de um agendamento (confirmar paciente, marcar como concluído, ' +
      'marcar falta, voltar pra scheduled). NÃO use pra cancelar — use cancel_appointment. ' +
      'Use list_my_agenda ou get_appointment_details primeiro pra encontrar o id e mostrar ' +
      'detalhes ao usuário antes de mudar.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string', description: 'UUID do agendamento' },
        status: {
          type: 'string',
          enum: ['scheduled', 'confirmed', 'completed', 'no_show'],
          description: 'Novo status: scheduled (volta pra agendado), confirmed (paciente confirmou), completed (atendimento realizado), no_show (paciente faltou)',
        },
      },
      required: ['appointment_id', 'status'],
    },
  },
];

// ── Executors ─────────────────────────────────────────────────────

async function execFindSubject(input, ctx) {
  if (!input?.name || typeof input.name !== 'string' || input.name.trim().length < 2) {
    return { error: 'Nome muito curto (mínimo 2 chars)' };
  }
  const { rows } = await ctx.fastify.pg.query(
    `SELECT id, name, subject_type, species, breed
     FROM subjects
     WHERE tenant_id = $1 AND deleted_at IS NULL AND name ILIKE $2
     ORDER BY name ASC
     LIMIT 5`,
    [ctx.tenant_id, `%${input.name.trim()}%`]
  );
  return {
    matches: rows.map(r => ({
      id: r.id,
      name: r.name,
      subject_type: r.subject_type,
      species: r.species || undefined,
      breed: r.breed || undefined,
    })),
  };
}

async function execListMyAgenda(input, ctx) {
  let from, to;
  const i = input || {};
  if (i.preset === 'today') {
    const d = new Date();
    from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
    to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
  } else if (i.preset === 'tomorrow') {
    const d = new Date();
    from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
    to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 2)).toISOString();
  } else if (i.preset === 'this_week') {
    const d = new Date();
    const day = d.getUTCDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMon));
    const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 7);
    from = monday.toISOString();
    to = sunday.toISOString();
  } else if (i.from && i.to) {
    if (Number.isNaN(Date.parse(i.from)) || Number.isNaN(Date.parse(i.to))) {
      return { error: 'from/to ISO inválidos' };
    }
    from = i.from;
    to = i.to;
  } else {
    return { error: 'Forneça preset (today/tomorrow/this_week) ou from+to ISO' };
  }

  const { rows } = await ctx.fastify.pg.query(
    `SELECT a.id, a.start_at, a.duration_minutes, a.status, a.subject_id,
            a.reason, s.name AS subject_name
     FROM appointments a
     LEFT JOIN subjects s ON s.id = a.subject_id
     WHERE a.tenant_id = $1 AND a.user_id = $2
       AND a.start_at >= $3 AND a.start_at < $4
     ORDER BY a.start_at ASC`,
    [ctx.tenant_id, ctx.user_id, from, to]
  );
  return {
    appointments: rows.map(r => ({
      id: r.id,
      start_at: r.start_at,
      start_at_local: formatLocal(r.start_at, ctx.timezone),
      duration_minutes: r.duration_minutes,
      status: r.status,
      subject_name: r.subject_name || undefined,
      reason: r.reason || undefined,
    })),
    range: { from, to },
    timezone: ctx.timezone || DEFAULT_TIMEZONE,
  };
}

async function execGetAppointmentDetails(input, ctx) {
  if (!input?.appointment_id) return { error: 'appointment_id obrigatório' };
  const { rows } = await ctx.fastify.pg.query(
    `SELECT a.id, a.start_at, a.duration_minutes, a.status, a.subject_id,
            a.reason, a.notes, s.name AS subject_name
     FROM appointments a
     LEFT JOIN subjects s ON s.id = a.subject_id
     WHERE a.id = $1 AND a.tenant_id = $2 AND a.user_id = $3`,
    [input.appointment_id, ctx.tenant_id, ctx.user_id]
  );
  if (rows.length === 0) return { error: 'Agendamento não encontrado.' };
  const r = rows[0];
  return {
    id: r.id,
    start_at: r.start_at,
    start_at_local: formatLocal(r.start_at, ctx.timezone),
    duration_minutes: r.duration_minutes,
    status: r.status,
    subject_id: r.subject_id || null,
    subject_name: r.subject_name || null,
    notes: r.notes || null,
    reason: r.reason || null,
    timezone: ctx.timezone || DEFAULT_TIMEZONE,
  };
}

async function execCreateAppointment(input, ctx) {
  const i = input || {};
  if (!i.start_at || Number.isNaN(Date.parse(i.start_at))) {
    return { error: 'start_at inválido' };
  }
  if (!VALID_DURATION.includes(i.duration_minutes)) {
    return { error: `duration_minutes deve ser um de ${VALID_DURATION.join(', ')}` };
  }
  if (!['scheduled', 'blocked'].includes(i.status)) {
    return { error: 'status deve ser scheduled ou blocked' };
  }
  if (i.status === 'scheduled' && !i.subject_id) {
    return { error: 'status=scheduled exige subject_id' };
  }
  if (i.status === 'blocked' && !i.reason) {
    return { error: 'status=blocked exige reason' };
  }
  if (i.status === 'blocked' && i.subject_id) {
    return { error: 'status=blocked não pode ter subject_id' };
  }

  try {
    const result = await withTenant(ctx.fastify.pg, ctx.tenant_id, async (client) => {
      // Defesa: subject pertence ao mesmo tenant
      if (i.subject_id) {
        const { rows: subRows } = await client.query(
          `SELECT id FROM subjects WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          [i.subject_id, ctx.tenant_id]
        );
        if (subRows.length === 0) {
          const e = new Error('SUBJECT_INVALID');
          e.code = 'SUBJECT_INVALID';
          throw e;
        }
      }
      const { rows } = await client.query(
        `INSERT INTO appointments
          (tenant_id, user_id, subject_id, start_at, duration_minutes, status, reason, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $2)
         RETURNING id, start_at, duration_minutes, status, subject_id, reason`,
        [ctx.tenant_id, ctx.user_id, i.subject_id || null, i.start_at,
         i.duration_minutes, i.status, i.reason || null, i.notes || null]
      );
      return rows[0];
    }, { userId: ctx.user_id, channel: 'copilot' });

    // Notify WS (best-effort)
    try {
      if (ctx.fastify.redis) {
        await ctx.fastify.redis.publish(
          `appointment:event:${ctx.tenant_id}`,
          JSON.stringify({ event: 'appointment:created', appointment: result })
        );
      }
    } catch (_) {}

    return {
      id: result.id,
      start_at: result.start_at,
      start_at_local: formatLocal(result.start_at, ctx.timezone),
      duration_minutes: result.duration_minutes,
      status: result.status,
    };
  } catch (err) {
    if (err.code === '23P01') {
      return { error: 'overlap', message: 'Horário já ocupado por outro agendamento.' };
    }
    if (err.code === 'SUBJECT_INVALID') {
      return { error: 'subject_invalid', message: 'Paciente não encontrado neste tenant.' };
    }
    throw err;
  }
}

async function execCancelAppointment(input, ctx) {
  if (!input?.appointment_id) return { error: 'appointment_id obrigatório' };

  const result = await withTenant(ctx.fastify.pg, ctx.tenant_id, async (client) => {
    const { rows } = await client.query(
      `UPDATE appointments
       SET status='cancelled', cancelled_at=COALESCE(cancelled_at, NOW()), updated_at=NOW()
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3
       RETURNING id, status, cancelled_at`,
      [input.appointment_id, ctx.tenant_id, ctx.user_id]
    );
    return rows[0];
  }, { userId: ctx.user_id, channel: 'copilot' });

  if (!result) {
    return { error: 'not_found', message: 'Agendamento não encontrado ou não pertence a você.' };
  }

  try {
    if (ctx.fastify.redis) {
      await ctx.fastify.redis.publish(
        `appointment:event:${ctx.tenant_id}`,
        JSON.stringify({ event: 'appointment:cancelled', appointment_id: input.appointment_id })
      );
    }
  } catch (_) {}

  return {
    id: result.id,
    status: result.status,
    cancelled_at: result.cancelled_at,
  };
}

async function execUpdateAppointmentStatus(input, ctx) {
  if (!input?.appointment_id) return { error: 'appointment_id obrigatório' };
  const VALID = ['scheduled', 'confirmed', 'completed', 'no_show'];
  if (!VALID.includes(input.status)) {
    return { error: `status deve ser um de ${VALID.join(', ')} (use cancel_appointment pra cancelar)` };
  }

  // Reativar appointment cancelado (cancelled → scheduled) é caso de uso
  // legítimo — médico cancelou por engano e quer voltar. EXCLUDE constraint
  // do DB protege contra overlap caso outro tenha sido criado no mesmo slot
  // entretanto (joga 23P01).
  // Bloquear apenas mudança de status em 'blocked' (bloqueio é diferente
  // conceitualmente — não tem subject_id, tem reason).
  try {
    const result = await withTenant(ctx.fastify.pg, ctx.tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE appointments
         SET status = $1,
             cancelled_at = CASE WHEN status = 'cancelled' AND $1 != 'cancelled' THEN NULL ELSE cancelled_at END,
             updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3 AND user_id = $4
           AND status != 'blocked'
         RETURNING id, status, start_at, duration_minutes`,
        [input.status, input.appointment_id, ctx.tenant_id, ctx.user_id]
      );
      return rows[0];
    }, { userId: ctx.user_id, channel: 'copilot' });

    if (!result) {
      return {
        error: 'not_found',
        message: 'Agendamento não encontrado, é um bloqueio (não pode alterar status), ou não pertence a você.',
      };
    }

    try {
      if (ctx.fastify.redis) {
        await ctx.fastify.redis.publish(
          `appointment:event:${ctx.tenant_id}`,
          JSON.stringify({ event: 'appointment:updated', appointment: result })
        );
      }
    } catch (_) {}

    return {
      id: result.id,
      status: result.status,
      start_at: result.start_at,
      start_at_local: formatLocal(result.start_at, ctx.timezone),
      duration_minutes: result.duration_minutes,
    };
  } catch (err) {
    if (err.code === '23P01') {
      return {
        error: 'overlap',
        message: 'Não foi possível reativar — esse horário já está ocupado por outro agendamento.',
      };
    }
    throw err;
  }
}

const EXECUTORS = {
  find_subject: execFindSubject,
  list_my_agenda: execListMyAgenda,
  get_appointment_details: execGetAppointmentDetails,
  create_appointment: execCreateAppointment,
  cancel_appointment: execCancelAppointment,
  update_appointment_status: execUpdateAppointmentStatus,
};

/**
 * Executa uma tool por nome com input + context.
 * @returns Promise<{result?, error?, latency_ms}>
 */
async function executeTool(name, input, context) {
  const exec = EXECUTORS[name];
  if (!exec) {
    return { error: `Tool desconhecida: ${name}`, latency_ms: 0 };
  }
  const startedAt = Date.now();
  try {
    const result = await exec(input || {}, context);
    return { result, latency_ms: Date.now() - startedAt };
  } catch (err) {
    if (context.log?.error) {
      context.log.error({ err, tool: name, input }, 'agenda-chat-tools: executor error');
    }
    return { error: err.message || 'Erro interno', latency_ms: Date.now() - startedAt };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  EXECUTORS,
  executeTool,
  VALID_DURATION,
};
