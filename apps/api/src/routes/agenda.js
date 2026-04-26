'use strict';
/**
 * Agendamento de exames/consultas (V1 — single-doctor).
 *
 * Spec: docs/superpowers/specs/2026-04-26-scheduling-design.md
 *
 * Endpoints (todos preHandler: [fastify.authenticate]):
 *   GET    /settings              — config do user logado (defaults se não existir)
 *   PUT    /settings              — upsert config
 *   GET    /appointments          — lista do user num range (default semana atual, max 90 dias)
 *   POST   /appointments          — cria agendamento ou bloqueio
 *   PATCH  /appointments/:id      — atualiza (move horário, mudar status, editar notes)
 *   POST   /appointments/:id/cancel — soft-delete
 *   DELETE /appointments/:id      — só pra status='blocked'
 *   GET    /appointments/free-slots?date=YYYY-MM-DD — slots disponíveis pro dia
 */

const { withTenant } = require('../db/tenant');

const VALID_SLOT_MINUTES = [30, 45, 60, 75, 90, 105, 120];
const VALID_STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'blocked'];
const ACTIVE_STATUSES = ['scheduled', 'confirmed', 'completed', 'blocked'];
const DEFAULT_BUSINESS_HOURS = {
  mon: [['09:00', '12:00'], ['14:00', '18:00']],
  tue: [['09:00', '12:00'], ['14:00', '18:00']],
  wed: [['09:00', '12:00'], ['14:00', '18:00']],
  thu: [['09:00', '12:00'], ['14:00', '18:00']],
  fri: [['09:00', '12:00'], ['14:00', '18:00']],
  sat: [],
  sun: [],
};
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ── Validators ──────────────────────────────────────────────────────────

function isHHMM(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function validateBusinessHours(bh) {
  if (!bh || typeof bh !== 'object' || Array.isArray(bh)) {
    return 'business_hours deve ser um objeto';
  }
  for (const day of Object.keys(DEFAULT_BUSINESS_HOURS)) {
    if (!Object.prototype.hasOwnProperty.call(bh, day)) {
      return `business_hours.${day} obrigatório (lista vazia se não atende)`;
    }
    const windows = bh[day];
    if (!Array.isArray(windows)) return `business_hours.${day} deve ser array`;
    for (const w of windows) {
      if (!Array.isArray(w) || w.length !== 2 || !isHHMM(w[0]) || !isHHMM(w[1])) {
        return `business_hours.${day} cada window deve ser ["HH:MM","HH:MM"]`;
      }
      if (w[0] >= w[1]) return `business_hours.${day} start deve ser < end`;
    }
  }
  return null;
}

function validateAppointmentBody(body, isUpdate = false) {
  const { start_at, duration_minutes, status, subject_id, reason } = body;

  if (!isUpdate || start_at !== undefined) {
    if (!start_at || typeof start_at !== 'string') return 'start_at obrigatório (ISO string)';
    if (Number.isNaN(Date.parse(start_at))) return 'start_at inválido';
  }

  if (!isUpdate || duration_minutes !== undefined) {
    if (!Number.isInteger(duration_minutes) || duration_minutes < 5 || duration_minutes > 480) {
      return 'duration_minutes deve ser inteiro entre 5 e 480';
    }
  }

  if (!isUpdate || status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return `status inválido (use: ${VALID_STATUSES.join(', ')})`;
    }
    // Bloqueio exige reason; agendamento exige subject_id
    if (status === 'blocked') {
      if (subject_id !== undefined && subject_id !== null) {
        return 'status=blocked não pode ter subject_id';
      }
      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        return 'status=blocked exige reason';
      }
    } else if (['scheduled', 'confirmed'].includes(status)) {
      if (!subject_id || typeof subject_id !== 'string') {
        return `status=${status} exige subject_id`;
      }
    }
  }

  return null;
}

// ── Module ──────────────────────────────────────────────────────────────

module.exports = async function (fastify) {

  // ── Settings ──────────────────────────────────────────────────────

  // GET /settings — retorna config do user (defaults se não existir, sem criar linha)
  fastify.get('/settings', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id, user_id } = request.user;
    const { rows } = await fastify.pg.query(
      `SELECT user_id, tenant_id, default_slot_minutes, business_hours, created_at, updated_at
       FROM schedule_settings
       WHERE user_id = $1 AND tenant_id = $2`,
      [user_id, tenant_id]
    );
    if (rows.length === 0) {
      return {
        user_id, tenant_id,
        default_slot_minutes: 30,
        business_hours: DEFAULT_BUSINESS_HOURS,
        is_default: true,
      };
    }
    return { ...rows[0], is_default: false };
  });

  // PUT /settings — upsert
  fastify.put('/settings', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { default_slot_minutes, business_hours } = request.body || {};

    if (!VALID_SLOT_MINUTES.includes(default_slot_minutes)) {
      return reply.status(400).send({
        error: `default_slot_minutes deve ser um de: ${VALID_SLOT_MINUTES.join(', ')}`,
      });
    }
    const bhError = validateBusinessHours(business_hours);
    if (bhError) return reply.status(400).send({ error: bhError });

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO schedule_settings (user_id, tenant_id, default_slot_minutes, business_hours)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (user_id) DO UPDATE
           SET default_slot_minutes = EXCLUDED.default_slot_minutes,
               business_hours       = EXCLUDED.business_hours,
               updated_at           = NOW()
         RETURNING user_id, tenant_id, default_slot_minutes, business_hours, created_at, updated_at`,
        [user_id, tenant_id, default_slot_minutes, JSON.stringify(business_hours)]
      );
      return rows[0];
    });

    return { ...result, is_default: false };
  });

  // ── Appointments ──────────────────────────────────────────────────

  // GET /appointments?from=&to=
  fastify.get('/appointments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    let { from, to } = request.query || {};

    // Default: semana atual (segunda 00:00 → domingo 23:59:59) UTC
    if (!from || !to) {
      const now = new Date();
      const day = now.getUTCDay(); // 0=domingo
      const diffToMon = day === 0 ? -6 : 1 - day;
      const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMon));
      const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 7);
      from = from || monday.toISOString();
      to = to || sunday.toISOString();
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return reply.status(400).send({ error: 'from/to inválidos (ISO string esperado)' });
    }
    if (toDate <= fromDate) {
      return reply.status(400).send({ error: 'to deve ser > from' });
    }
    const days = (toDate - fromDate) / (1000 * 60 * 60 * 24);
    if (days > 90) {
      return reply.status(400).send({ error: 'range máximo: 90 dias' });
    }

    const { rows } = await fastify.pg.query(
      `SELECT id, tenant_id, user_id, subject_id, series_id, start_at, duration_minutes,
              status, reason, notes, created_by, created_at, updated_at, cancelled_at
       FROM appointments
       WHERE user_id = $1 AND tenant_id = $2
         AND start_at >= $3 AND start_at < $4
       ORDER BY start_at ASC`,
      [user_id, tenant_id, fromDate.toISOString(), toDate.toISOString()]
    );
    return { results: rows };
  });

  // POST /appointments
  fastify.post('/appointments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const validationError = validateAppointmentBody(request.body || {});
    if (validationError) return reply.status(400).send({ error: validationError });

    const { start_at, duration_minutes, status, subject_id, reason, notes } = request.body;

    try {
      const result = await withTenant(fastify.pg, tenant_id, async (client) => {
        // Defense: se subject_id presente, valida que pertence ao tenant
        if (subject_id) {
          const { rows: subRows } = await client.query(
            `SELECT id FROM subjects WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
            [subject_id, tenant_id]
          );
          if (subRows.length === 0) {
            const e = new Error('subject_not_found_or_other_tenant');
            e.code = 'SUBJECT_INVALID';
            throw e;
          }
        }

        const { rows } = await client.query(
          `INSERT INTO appointments
            (tenant_id, user_id, subject_id, start_at, duration_minutes, status, reason, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, tenant_id, user_id, subject_id, series_id, start_at, duration_minutes,
                     status, reason, notes, created_by, created_at, updated_at, cancelled_at`,
          [tenant_id, user_id, subject_id || null, start_at, duration_minutes, status,
           reason || null, notes || null, user_id]
        );
        return rows[0];
      });

      // Notifica via Redis pub/sub (best-effort)
      try {
        if (fastify.redis) {
          await fastify.redis.publish(
            `appointment:event:${tenant_id}`,
            JSON.stringify({ event: 'appointment:created', appointment: result })
          );
        }
      } catch (_) {}

      return reply.status(201).send(result);
    } catch (err) {
      if (err.code === '23P01') {
        return reply.status(409).send({
          error: 'Horário já ocupado por outro agendamento.',
          code: 'OVERLAP',
        });
      }
      if (err.code === 'SUBJECT_INVALID') {
        return reply.status(400).send({ error: 'subject_id inválido (paciente não encontrado).' });
      }
      throw err;
    }
  });

  // PATCH /appointments/:id
  fastify.patch('/appointments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;
    const body = request.body || {};

    const validationError = validateAppointmentBody(body, /*isUpdate*/ true);
    if (validationError) return reply.status(400).send({ error: validationError });

    try {
      const result = await withTenant(fastify.pg, tenant_id, async (client) => {
        // Lê agendamento existente (RLS + AND tenant_id + AND user_id pra defesa)
        const { rows: existing } = await client.query(
          `SELECT id FROM appointments
           WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
          [id, tenant_id, user_id]
        );
        if (existing.length === 0) {
          const e = new Error('not_found'); e.code = 'NOT_FOUND'; throw e;
        }

        // Valida subject se mudar
        if (body.subject_id) {
          const { rows: subRows } = await client.query(
            `SELECT id FROM subjects WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
            [body.subject_id, tenant_id]
          );
          if (subRows.length === 0) {
            const e = new Error('subject_invalid'); e.code = 'SUBJECT_INVALID'; throw e;
          }
        }

        const setParts = [];
        const values = [];
        let i = 1;
        for (const field of ['start_at', 'duration_minutes', 'status', 'subject_id', 'reason', 'notes']) {
          if (body[field] !== undefined) {
            setParts.push(`${field} = $${i++}`);
            values.push(body[field]);
          }
        }
        // Auto-set cancelled_at se status='cancelled'
        if (body.status === 'cancelled') {
          setParts.push(`cancelled_at = NOW()`);
        }
        setParts.push(`updated_at = NOW()`);

        values.push(id, tenant_id);
        const { rows } = await client.query(
          `UPDATE appointments SET ${setParts.join(', ')}
           WHERE id = $${i++} AND tenant_id = $${i}
           RETURNING id, tenant_id, user_id, subject_id, series_id, start_at, duration_minutes,
                     status, reason, notes, created_by, created_at, updated_at, cancelled_at`,
          values
        );
        return rows[0];
      });

      try {
        if (fastify.redis) {
          await fastify.redis.publish(
            `appointment:event:${tenant_id}`,
            JSON.stringify({ event: 'appointment:updated', appointment: result })
          );
        }
      } catch (_) {}

      return result;
    } catch (err) {
      if (err.code === '23P01') {
        return reply.status(409).send({
          error: 'Horário já ocupado por outro agendamento.',
          code: 'OVERLAP',
        });
      }
      if (err.code === 'NOT_FOUND') return reply.status(404).send({ error: 'Agendamento não encontrado.' });
      if (err.code === 'SUBJECT_INVALID') return reply.status(400).send({ error: 'subject_id inválido.' });
      throw err;
    }
  });

  // POST /appointments/:id/cancel — soft-delete (idempotente)
  fastify.post('/appointments/:id/cancel', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE appointments
         SET status='cancelled', cancelled_at=COALESCE(cancelled_at, NOW()), updated_at=NOW()
         WHERE id = $1 AND tenant_id = $2 AND user_id = $3
         RETURNING id, status, cancelled_at`,
        [id, tenant_id, user_id]
      );
      return rows[0];
    });

    if (!result) return reply.status(404).send({ error: 'Agendamento não encontrado.' });

    try {
      if (fastify.redis) {
        await fastify.redis.publish(
          `appointment:event:${tenant_id}`,
          JSON.stringify({ event: 'appointment:cancelled', appointment_id: id })
        );
      }
    } catch (_) {}

    return result;
  });

  // DELETE /appointments/:id — só pra status='blocked'
  fastify.delete('/appointments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows: existing } = await client.query(
        `SELECT status FROM appointments
         WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
        [id, tenant_id, user_id]
      );
      if (existing.length === 0) return { notFound: true };
      if (existing[0].status !== 'blocked') return { notBlocked: true };

      await client.query(
        `DELETE FROM appointments WHERE id = $1 AND tenant_id = $2`,
        [id, tenant_id]
      );
      return { deleted: true };
    });

    if (result.notFound) return reply.status(404).send({ error: 'Agendamento não encontrado.' });
    if (result.notBlocked) {
      return reply.status(400).send({
        error: 'Apenas agendamentos com status=blocked podem ser deletados. Para outros, use cancelar.',
      });
    }

    try {
      if (fastify.redis) {
        await fastify.redis.publish(
          `appointment:event:${tenant_id}`,
          JSON.stringify({ event: 'appointment:cancelled', appointment_id: id })
        );
      }
    } catch (_) {}

    return reply.status(204).send();
  });

  // ── Free slots ────────────────────────────────────────────────────

  // GET /appointments/free-slots?date=YYYY-MM-DD
  // Calcula slots disponíveis pro dia derivando de business_hours - existing_appointments
  fastify.get('/appointments/free-slots', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { date } = request.query || {};

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({ error: 'date obrigatório (YYYY-MM-DD)' });
    }

    // Busca settings (defaults se não existir)
    const { rows: settingsRows } = await fastify.pg.query(
      `SELECT default_slot_minutes, business_hours FROM schedule_settings
       WHERE user_id = $1 AND tenant_id = $2`,
      [user_id, tenant_id]
    );
    const settings = settingsRows[0] || {
      default_slot_minutes: 30,
      business_hours: DEFAULT_BUSINESS_HOURS,
    };

    // Determina dia da semana (em UTC — pode ser ajustado por tenant.timezone em V2)
    const dt = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(dt.getTime())) {
      return reply.status(400).send({ error: 'date inválido' });
    }
    const dayKey = DAY_KEYS[dt.getUTCDay()];
    const windows = settings.business_hours[dayKey] || [];

    // Busca appointments do dia (ativos)
    const dayStart = `${date}T00:00:00Z`;
    const nextDay = new Date(dt); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const { rows: appts } = await fastify.pg.query(
      `SELECT start_at, duration_minutes FROM appointments
       WHERE user_id = $1 AND tenant_id = $2
         AND start_at >= $3 AND start_at < $4
         AND status = ANY($5::text[])`,
      [user_id, tenant_id, dayStart, nextDay.toISOString(), ACTIVE_STATUSES]
    );

    // Gera slots candidatos a partir das janelas, em incrementos de default_slot_minutes
    const slots = [];
    const slotMin = settings.default_slot_minutes;
    for (const [start, end] of windows) {
      const [sH, sM] = start.split(':').map(Number);
      const [eH, eM] = end.split(':').map(Number);
      const winStart = new Date(`${date}T${start}:00Z`);
      const winEndMin = eH * 60 + eM;
      let cursorMin = sH * 60 + sM;
      while (cursorMin + slotMin <= winEndMin) {
        const slotStart = new Date(winStart);
        slotStart.setUTCMinutes(slotStart.getUTCMinutes() + (cursorMin - (sH * 60 + sM)));
        const slotEnd = new Date(slotStart);
        slotEnd.setUTCMinutes(slotEnd.getUTCMinutes() + slotMin);
        // Excluir se overlapa com appointment ativo
        const overlap = appts.some(a => {
          const aStart = new Date(a.start_at);
          const aEnd = new Date(aStart);
          aEnd.setUTCMinutes(aEnd.getUTCMinutes() + a.duration_minutes);
          return slotStart < aEnd && slotEnd > aStart;
        });
        if (!overlap) {
          slots.push({
            start_at: slotStart.toISOString(),
            duration_minutes: slotMin,
          });
        }
        cursorMin += slotMin;
      }
    }

    return {
      date,
      day_of_week: dayKey,
      default_slot_minutes: slotMin,
      slots,
    };
  });
};

// Export pra teste unit
module.exports.VALID_SLOT_MINUTES = VALID_SLOT_MINUTES;
module.exports.VALID_STATUSES = VALID_STATUSES;
module.exports._internals = { validateBusinessHours, validateAppointmentBody, isHHMM };
