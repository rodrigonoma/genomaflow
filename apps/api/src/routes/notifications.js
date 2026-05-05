'use strict';

/**
 * Notification preferences + status. Admin-only (exceto webhook inbound).
 *
 * Spec: Fase 3 PMS expansion.
 *
 * Endpoints:
 *   GET    /notifications/preferences         retorna config do tenant (default se não existe)
 *   PUT    /notifications/preferences         upsert config
 *   GET    /notifications/scheduled           lista pending recentes (admin debug)
 *   GET    /notifications/whatsapp/status     ping Z-API (mock-aware)
 *
 *   POST   /notifications/whatsapp/inbound    público — webhook Z-API recebimento.
 *                                              Header X-Token valida origem.
 */

const { withTenant } = require('../db/tenant');
const whatsapp = require('../services/whatsapp-client');

const VALID_REMINDER_VIA = ['whatsapp', 'email', 'both'];
const VALID_NPS_VIA = ['email', 'whatsapp'];

function isHHMM(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

function validatePrefs(body) {
  if (!body || typeof body !== 'object') return 'body inválido';
  if (body.appointment_reminder_enabled !== undefined && typeof body.appointment_reminder_enabled !== 'boolean') {
    return 'appointment_reminder_enabled deve ser boolean';
  }
  if (body.reminder_hours_before !== undefined) {
    if (!Array.isArray(body.reminder_hours_before)) return 'reminder_hours_before deve ser array';
    if (body.reminder_hours_before.length === 0 || body.reminder_hours_before.length > 5) {
      return 'reminder_hours_before: 1 a 5 valores';
    }
    for (const h of body.reminder_hours_before) {
      if (!Number.isInteger(h) || h < 1 || h > 168) return 'reminder_hours_before: cada valor entre 1 e 168';
    }
  }
  if (body.reminder_via !== undefined && !VALID_REMINDER_VIA.includes(body.reminder_via)) {
    return `reminder_via inválido (use: ${VALID_REMINDER_VIA.join(', ')})`;
  }
  if (body.send_window_start !== undefined && !isHHMM(body.send_window_start)) {
    return 'send_window_start formato HH:MM';
  }
  if (body.send_window_end !== undefined && !isHHMM(body.send_window_end)) {
    return 'send_window_end formato HH:MM';
  }
  if (body.nps_enabled !== undefined && typeof body.nps_enabled !== 'boolean') {
    return 'nps_enabled deve ser boolean';
  }
  if (body.nps_via !== undefined && !VALID_NPS_VIA.includes(body.nps_via)) {
    return `nps_via inválido (use: ${VALID_NPS_VIA.join(', ')})`;
  }
  if (body.nps_delay_hours !== undefined) {
    if (!Number.isInteger(body.nps_delay_hours) || body.nps_delay_hours < 0 || body.nps_delay_hours > 168) {
      return 'nps_delay_hours entre 0 e 168';
    }
  }
  return null;
}

module.exports = async function (fastify) {

  // ── Preferences ──────────────────────────────────────────────────────

  fastify.get('/preferences', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    const { rows } = await fastify.pg.query(
      `SELECT * FROM notification_preferences WHERE tenant_id = $1`, [tenant_id]
    );
    if (rows.length === 0) {
      return {
        tenant_id,
        appointment_reminder_enabled: true,
        reminder_hours_before: [24, 2],
        reminder_via: 'whatsapp',
        send_window_start: '08:00',
        send_window_end: '20:00',
        nps_enabled: false,
        nps_via: 'email',
        nps_delay_hours: 4,
        // Phase 4.2 follow-ups (defaults da migration 076)
        post_consultation_followup_enabled: true,
        post_consultation_followup_days: 7,
        exam_alert_followup_enabled: true,
        exam_alert_followup_days: 30,
        vaccine_dose_reminder_enabled: true,
        vaccine_dose_reminder_hours_before: [168, 24],
        is_default: true,
      };
    }
    return { ...rows[0], is_default: false };
  });

  fastify.put('/preferences', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, role } = request.user;
    if (role !== 'admin' && role !== 'master') return reply.status(403).send({ error: 'Apenas admin' });
    const err = validatePrefs(request.body || {});
    if (err) return reply.status(400).send({ error: err });
    const b = request.body;

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      // Defaults explícitos no INSERT pra não violar NOT NULL na primeira insert.
      // No UPDATE preserva valor existente quando body não trouxe (COALESCE EXCLUDED, current).
      const { rows } = await client.query(
        `INSERT INTO notification_preferences (
           tenant_id, appointment_reminder_enabled, reminder_hours_before,
           reminder_via, send_window_start, send_window_end,
           nps_enabled, nps_via, nps_delay_hours,
           post_consultation_followup_enabled, post_consultation_followup_days,
           exam_alert_followup_enabled, exam_alert_followup_days,
           vaccine_dose_reminder_enabled, vaccine_dose_reminder_hours_before
         ) VALUES (
           $1,
           COALESCE($2, TRUE), COALESCE($3, ARRAY[24, 2]),
           COALESCE($4, 'whatsapp'), COALESCE($5, '08:00'), COALESCE($6, '20:00'),
           COALESCE($7, FALSE), COALESCE($8, 'email'), COALESCE($9, 4),
           COALESCE($10, TRUE), COALESCE($11, 7),
           COALESCE($12, TRUE), COALESCE($13, 30),
           COALESCE($14, TRUE), COALESCE($15, ARRAY[168, 24])
         )
         ON CONFLICT (tenant_id) DO UPDATE SET
           appointment_reminder_enabled = COALESCE($2, notification_preferences.appointment_reminder_enabled),
           reminder_hours_before = COALESCE($3, notification_preferences.reminder_hours_before),
           reminder_via = COALESCE($4, notification_preferences.reminder_via),
           send_window_start = COALESCE($5, notification_preferences.send_window_start),
           send_window_end = COALESCE($6, notification_preferences.send_window_end),
           nps_enabled = COALESCE($7, notification_preferences.nps_enabled),
           nps_via = COALESCE($8, notification_preferences.nps_via),
           nps_delay_hours = COALESCE($9, notification_preferences.nps_delay_hours),
           post_consultation_followup_enabled = COALESCE($10, notification_preferences.post_consultation_followup_enabled),
           post_consultation_followup_days = COALESCE($11, notification_preferences.post_consultation_followup_days),
           exam_alert_followup_enabled = COALESCE($12, notification_preferences.exam_alert_followup_enabled),
           exam_alert_followup_days = COALESCE($13, notification_preferences.exam_alert_followup_days),
           vaccine_dose_reminder_enabled = COALESCE($14, notification_preferences.vaccine_dose_reminder_enabled),
           vaccine_dose_reminder_hours_before = COALESCE($15, notification_preferences.vaccine_dose_reminder_hours_before),
           updated_at = NOW()
         RETURNING *`,
        [tenant_id,
         b.appointment_reminder_enabled ?? null,
         b.reminder_hours_before ?? null,
         b.reminder_via ?? null,
         b.send_window_start ?? null,
         b.send_window_end ?? null,
         b.nps_enabled ?? null,
         b.nps_via ?? null,
         b.nps_delay_hours ?? null,
         b.post_consultation_followup_enabled ?? null,
         b.post_consultation_followup_days ?? null,
         b.exam_alert_followup_enabled ?? null,
         b.exam_alert_followup_days ?? null,
         b.vaccine_dose_reminder_enabled ?? null,
         b.vaccine_dose_reminder_hours_before ?? null]
      );
      return rows[0];
    }, { userId: user_id, channel: 'ui' });

    return result;
  });

  // ── Status ─────────────────────────────────────────────────────────

  fastify.get('/scheduled', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin' && role !== 'master') return reply.status(403).send({ error: 'Apenas admin' });

    const { rows } = await fastify.pg.query(
      `SELECT id, notification_type, appointment_id, channel, send_to, status,
              scheduled_for, sent_at, error_message, retry_count, created_at
       FROM scheduled_notifications
       WHERE tenant_id = $1
       ORDER BY scheduled_for DESC
       LIMIT 200`,
      [tenant_id]
    );
    return { items: rows };
  });

  fastify.get('/whatsapp/status', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { role } = request.user;
    if (role !== 'admin' && role !== 'master') return reply.status(403).send({ error: 'Apenas admin' });
    return {
      mock: whatsapp.isMock(),
      configured: !!process.env.ZAPI_INSTANCE_ID && !!process.env.ZAPI_TOKEN,
    };
  });

  // ── Inbound webhook (público, validado via segmento do PATH) ──────

  // Z-API panel não permite custom headers (descoberto 2026-05-05).
  // Solução: token vai no PATH como segmento. URL configurada no painel Z-API:
  //   https://app.genomaflow.com.br/api/notifications/whatsapp/inbound/<ZAPI_CLIENT_TOKEN>
  // Segurança equivalente a header X-Token (TLS protege ambos; Z-API server→server,
  // path não vaza em logs de browser).
  // Path antigo /whatsapp/inbound mantido pra retrocompat — retorna 401 sem token.
  async function handleInboundWebhook(request, reply, secretInPath = null) {
    const expected = process.env.ZAPI_CLIENT_TOKEN;
    const isMock = whatsapp.isMock();

    if (!isMock && expected) {
      const provided = secretInPath || request.headers['x-token'] || request.headers['X-Token'];
      if (provided !== expected) {
        return reply.status(401).send({ error: 'invalid signature' });
      }
    }
    // Em mock OU sem ZAPI_CLIENT_TOKEN setado → degrade gracefully (dev)

    const body = request.body || {};
    // Z-API payload (varia por config; usamos formato comum):
    // { phone: "5511999999999", message: { text: "1" }, fromMe: false, isStatusReply: false, ... }
    const phone = whatsapp.normalizePhone(body.phone || body.from || '');
    const text = (body.message?.text || body.text || body.body || '').toString().trim();
    const fromMe = body.fromMe === true || body.isFromMe === true;
    if (fromMe || !phone || !text) return { ok: true, skipped: true };

    // Acha o tenant via último envio outbound pra esse phone
    const { rows: lastRows } = await fastify.pg.query(
      `SELECT tenant_id, appointment_id
       FROM whatsapp_messages
       WHERE phone_e164 = $1 AND direction = 'outbound' AND appointment_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [phone]
    );

    if (lastRows.length === 0) {
      // Não temos contexto — só registra inbound sem ação
      await fastify.pg.query(
        `INSERT INTO whatsapp_messages (tenant_id, direction, phone_e164, body, message_type, status, processed, processed_action)
         SELECT id, 'inbound', $1, $2, 'text', 'received', TRUE, 'unrecognized' FROM tenants LIMIT 1`,
        [phone, text.slice(0, 1000)]
      );
      return { ok: true, processed: false, reason: 'no_context' };
    }

    const { tenant_id, appointment_id } = lastRows[0];
    const normalizedText = text.toLowerCase();
    let action = 'unrecognized';
    let updateSql = null;
    let updateMsg = '';

    if (text === '1' || normalizedText === 'sim' || normalizedText === 'confirmar') {
      action = 'confirmed';
      updateSql = `UPDATE appointments SET status = 'confirmed', updated_at = NOW()
                   WHERE id = $1 AND tenant_id = $2 AND status IN ('scheduled')
                   RETURNING id`;
      updateMsg = 'Consulta confirmada. Te esperamos!';
    } else if (text === '2' || normalizedText === 'cancelar' || normalizedText === 'não' || normalizedText === 'nao') {
      action = 'cancelled';
      updateSql = `UPDATE appointments SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
                   WHERE id = $1 AND tenant_id = $2 AND status IN ('scheduled','confirmed')
                   RETURNING id`;
      updateMsg = 'Consulta cancelada conforme solicitado. Para reagendar, entre em contato.';
    }

    await withTenant(fastify.pg, tenant_id, async (client) => {
      // Loga inbound
      await client.query(
        `INSERT INTO whatsapp_messages (tenant_id, direction, phone_e164, body, message_type, appointment_id, status, processed, processed_action)
         VALUES ($1, 'inbound', $2, $3, 'text', $4, 'received', TRUE, $5)`,
        [tenant_id, phone, text.slice(0, 1000), appointment_id, action]
      );

      if (updateSql) {
        await client.query(updateSql, [appointment_id, tenant_id]);

        // Resposta automática
        try {
          const replyResult = await whatsapp.sendText({ phone, body: updateMsg, log: request.log });
          await client.query(
            `INSERT INTO whatsapp_messages (tenant_id, direction, phone_e164, body, message_type, appointment_id, zapi_message_id, status)
             VALUES ($1, 'outbound', $2, $3, 'text', $4, $5, 'sent')`,
            [tenant_id, phone, updateMsg, appointment_id, replyResult.messageId]
          );
        } catch (err) {
          request.log.error({ err: err.message }, 'falha ao enviar reply WhatsApp');
        }
      }
    }, { userId: null, channel: 'system' });

    return { ok: true, processed: true, action };
  }

  // Path com token (preferido — Z-API painel não permite custom headers)
  fastify.post('/whatsapp/inbound/:secret', async (request, reply) => {
    return handleInboundWebhook(request, reply, request.params.secret);
  });

  // Path sem token (retrocompat / valida via header X-Token se setar manualmente
  // por algum cliente custom). Em prod com ZAPI_CLIENT_TOKEN setado, retorna 401.
  fastify.post('/whatsapp/inbound', async (request, reply) => {
    return handleInboundWebhook(request, reply, null);
  });
};
