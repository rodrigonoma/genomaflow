'use strict';

/**
 * Scheduler de notificações: roda a cada 5min via setInterval.
 *
 * Estratégia:
 * 1. Busca appointments futuros (próximas 48h) sem reminder ainda agendado
 * 2. Pra cada appointment, decide quais reminders criar (T-24h, T-2h, etc.)
 * 3. Persiste em scheduled_notifications com status='pending'
 * 4. Em outra rotina, processa pending: envia via WhatsApp/email + marca status='sent'
 *
 * Decisão arquitetural: scheduled_notifications é a fonte de verdade.
 * BullMQ não é usado pra timing exato — Postgres + tick rate é simpler e
 * idempotente (se worker reinicia, retoma do banco). 5min de granularidade
 * é OK pra T-2h / T-24h reminders.
 *
 * Mock mode: se ZAPI_MOCK=1 ou SES_MOCK=1, envia "fake" e atualiza row.
 */

const { Pool } = require('pg');
const path = require('path');

// Carrega .env do worker (pra credenciais Z-API/SES)
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

let pool = null;
function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL obrigatória');
  pool = new Pool({ connectionString: url, max: 5 });
  return pool;
}

// Lazy-load do whatsapp client (evita falha se modulo não bundled)
function getWhatsApp() {
  try {
    return require('../../api-shared/whatsapp-client');
  } catch (e) {
    // Worker pode não ter o client — fallback inline simples
    return {
      sendText: async ({ phone, body }) => {
        if (process.env.ZAPI_MOCK === '1') {
          console.log(`[notif][MOCK] WhatsApp → ${phone}: ${body.slice(0, 80)}`);
          return { messageId: `mock-${Date.now()}`, status: 'sent' };
        }
        // Implementação inline mínima usando fetch nativo + timeout 10s
        // (sem timeout, Z-API lento pode travar todo o tick — perde reminders)
        const url = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}/send-text`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let res;
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Client-Token': process.env.ZAPI_CLIENT_TOKEN },
            body: JSON.stringify({ phone, message: body }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Z-API ${res.status}: ${errText.slice(0, 200)}`);
        }
        const data = await res.json();
        return { messageId: data.messageId || data.id, status: 'sent' };
      },
      normalizePhone: (raw) => {
        if (!raw || typeof raw !== 'string') return null;
        const d = raw.replace(/\D/g, '');
        if (d.length === 11 || d.length === 10) return '55' + d;
        return d;
      },
    };
  }
}

const TEMPLATES = {
  appointment_reminder_24h:
    'Olá {{nome}}! Lembramos que você tem consulta amanhã às {{hora}} em {{tenant_name}}. Responda 1 pra confirmar ou 2 pra cancelar.',
  appointment_reminder_2h:
    'Olá {{nome}}! Sua consulta em {{tenant_name}} é hoje às {{hora}}. Te aguardamos!',
};
function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}

/**
 * STEP 1: gera scheduled_notifications pra appointments futuros
 *         que ainda não têm reminder agendado.
 */
async function generateRemindersForUpcoming() {
  const client = await getPool().connect();
  try {
    // Busca appointments scheduled/confirmed nas próximas 48h, junta phone do subject (vet) ou direto
    // Apenas tenants com appointment_reminder_enabled = true
    const { rows: appointments } = await client.query(`
      SELECT
        a.id, a.tenant_id, a.start_at, a.subject_id, a.user_id,
        s.name AS subject_name, s.phone AS subject_phone,
        o.name AS owner_name, o.phone AS owner_phone,
        t.name AS tenant_name,
        COALESCE(np.appointment_reminder_enabled, TRUE) AS enabled,
        COALESCE(np.reminder_hours_before, ARRAY[24, 2]) AS hours_before,
        COALESCE(np.reminder_via, 'whatsapp') AS via
      FROM appointments a
      JOIN tenants t ON t.id = a.tenant_id AND t.active = TRUE
      LEFT JOIN subjects s ON s.id = a.subject_id AND s.deleted_at IS NULL
      LEFT JOIN owners o ON o.id = s.owner_id
      LEFT JOIN notification_preferences np ON np.tenant_id = a.tenant_id
      WHERE a.status IN ('scheduled','confirmed')
        AND a.start_at > NOW()
        AND a.start_at <= NOW() + INTERVAL '48 hours'
      LIMIT 500
    `);

    let created = 0;
    for (const apt of appointments) {
      if (!apt.enabled) continue;
      const phone = apt.owner_phone || apt.subject_phone;
      if (!phone) continue;

      const recipient_name = apt.owner_name || apt.subject_name || 'cliente';
      const tenant_name = apt.tenant_name;
      const start = new Date(apt.start_at);
      const horaStr = start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

      // Pra cobrir caso de appointment criado <T-h no futuro, ordenamos hours_before
      // do menor pro maior. Pro MENOR h, se scheduled_for está no passado mas
      // appointment ainda é futuro, agenda imediato (now). Pra h maiores que já
      // passaram (ex: T-24h num appointment de daqui 5h), skip — cliente perdeu
      // o lembrete antecipado, mas ainda recebe o T-h menor.
      const hoursAsc = [...apt.hours_before].sort((a, b) => a - b);
      const minH = hoursAsc[0];
      const now = new Date();

      for (const h of hoursAsc) {
        let scheduled_for = new Date(start.getTime() - h * 60 * 60 * 1000);
        if (scheduled_for < now) {
          // Só pro menor h: se appointment é futuro, "envia agora" agendando pra now
          if (h === minH) {
            scheduled_for = new Date();
          } else {
            continue;
          }
        }

        const tplKey = h >= 12 ? 'appointment_reminder_24h' : 'appointment_reminder_2h';
        const body = render(TEMPLATES[tplKey], {
          nome: recipient_name, hora: horaStr, tenant_name,
        });

        // Idempotência via UNIQUE INDEX uniq_appt_reminder_hours em
        // (appointment_id, hours_before) WHERE type='appointment_reminder'.
        // ON CONFLICT DO NOTHING evita corrida e duplicação cross-ticks.
        const insertResult = await client.query(
          `INSERT INTO scheduled_notifications (
             tenant_id, notification_type, appointment_id, subject_id,
             channel, send_to, body, scheduled_for, hours_before, status
           ) VALUES ($1, 'appointment_reminder', $2, $3, $4, $5, $6, $7, $8, 'pending')
           ON CONFLICT (appointment_id, hours_before)
             WHERE notification_type = 'appointment_reminder'
                   AND appointment_id IS NOT NULL
                   AND hours_before IS NOT NULL
             DO NOTHING
           RETURNING id`,
          [apt.tenant_id, apt.id, apt.subject_id,
           apt.via === 'email' ? 'email' : 'whatsapp',
           phone, body, scheduled_for.toISOString(), h]
        );
        if (insertResult.rows.length > 0) created++;
      }
    }
    if (created > 0) console.log(`[notif] Generated ${created} new reminders`);
  } finally {
    client.release();
  }
}

/**
 * STEP 2: envia reminders pendentes cujo scheduled_for já passou.
 * Atualiza status='sent' ou 'failed' + retry_count.
 */
async function sendPendingNotifications() {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query(`
      SELECT id, tenant_id, channel, send_to, body, appointment_id, subject_id, retry_count
      FROM scheduled_notifications
      WHERE status = 'pending'
        AND scheduled_for <= NOW()
        AND retry_count < 3
      ORDER BY scheduled_for ASC
      LIMIT 100
    `);

    if (rows.length === 0) return;

    const wa = getWhatsApp();
    let sent = 0, failed = 0;

    for (const n of rows) {
      try {
        let messageId = null;
        if (n.channel === 'whatsapp') {
          const phone = wa.normalizePhone(n.send_to);
          if (!phone) throw new Error('phone inválido');
          const r = await wa.sendText({ phone, body: n.body });
          messageId = r.messageId;

          // Loga em whatsapp_messages
          await client.query(`
            INSERT INTO whatsapp_messages (tenant_id, direction, phone_e164, body, message_type, scheduled_notification_id, appointment_id, subject_id, zapi_message_id, status)
            VALUES ($1, 'outbound', $2, $3, 'text', $4, $5, $6, $7, 'sent')
          `, [n.tenant_id, phone, n.body, n.id, n.appointment_id, n.subject_id, messageId]);
        } else if (n.channel === 'email') {
          // SES via aws-sdk; fallback log se não disponível
          if (process.env.SES_MOCK === '1') {
            console.log(`[notif][MOCK] Email → ${n.send_to}: ${n.body.slice(0, 80)}`);
          } else {
            // Email worker desabilitado nesta versão — depende de aws-sdk presente
            console.log(`[notif] Email skipped (SES_MOCK=0 e worker sem aws-sdk)`);
          }
        }

        await client.query(`UPDATE scheduled_notifications SET status = 'sent', sent_at = NOW() WHERE id = $1`, [n.id]);
        sent++;
      } catch (err) {
        const newRetry = (n.retry_count || 0) + 1;
        await client.query(
          `UPDATE scheduled_notifications SET retry_count = $1, error_message = $2,
             status = CASE WHEN $1 >= 3 THEN 'failed' ELSE 'pending' END
           WHERE id = $3`,
          [newRetry, String(err.message).slice(0, 500), n.id]
        );
        failed++;
      }
    }
    if (sent || failed) console.log(`[notif] Sent ${sent}, failed ${failed}`);
  } finally {
    client.release();
  }
}

async function tick() {
  const startTs = Date.now();
  try {
    console.log('[notif] tick start');
    await generateRemindersForUpcoming();
    await sendPendingNotifications();
    console.log(`[notif] tick done in ${Date.now() - startTs}ms`);
  } catch (err) {
    console.error('[notif] tick error:', err.message, err.stack?.split('\n').slice(0, 3).join(' | '));
  }
}

function startScheduler({ intervalMs = 5 * 60 * 1000 } = {}) {
  console.log(`[notif] Scheduler iniciado — tick a cada ${intervalMs / 1000}s`);
  // Primeira execução em 30s pra deixar o worker estabilizar
  setTimeout(tick, 30 * 1000);
  setInterval(tick, intervalMs);
}

module.exports = { startScheduler, tick, generateRemindersForUpcoming, sendPendingNotifications };
