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
const { runDiscovery, shouldTickRun } = require('../jobs/aesthetic-treatment-discovery');
const { runPurge: runPurgeSensitive, shouldTickRun: shouldPurgeRun } = require('../jobs/aesthetic-purge-sensitive');

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
  post_consultation_followup:
    'Olá {{nome}}! Tudo bem? Já se passaram alguns dias desde sua consulta em {{tenant_name}}. Como está se sentindo? Se precisar de algo, é só responder.',
  exam_alert_followup:
    'Olá {{nome}}! Faz {{dias}} dias desde seu último exame em {{tenant_name}}. Para acompanhar a evolução, vale conversar com a clínica para reavaliar.',
  vaccine_dose_reminder_7d:
    'Olá {{nome}}! Lembrete: a próxima dose da vacina {{vacina}} de {{paciente}} está agendada para {{data}}. Se quiser remarcar, é só responder.',
  vaccine_dose_reminder_1d:
    'Olá {{nome}}! Amanhã é o dia da próxima dose da vacina {{vacina}} de {{paciente}}. Te aguardamos em {{tenant_name}}!',
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
        // (appointment_id, hours_before) WHERE type='appointment_reminder'
        //   AND status IN ('pending','sent').
        // ON CONFLICT DO NOTHING evita corrida e duplicação cross-ticks.
        // Como o ON CONFLICT exige expressão exata do índice, repetimos o
        // WHERE incluindo status — só conflita com pending/sent existente.
        const insertResult = await client.query(
          `INSERT INTO scheduled_notifications (
             tenant_id, notification_type, appointment_id, subject_id,
             channel, send_to, body, scheduled_for, hours_before, status
           ) VALUES ($1, 'appointment_reminder', $2, $3, $4, $5, $6, $7, $8, 'pending')
           ON CONFLICT (appointment_id, hours_before)
             WHERE notification_type = 'appointment_reminder'
                   AND appointment_id IS NOT NULL
                   AND hours_before IS NOT NULL
                   AND status IN ('pending', 'sent')
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
 * STEP 1b: gera follow-up pós-consulta (encounter completed com prescription).
 * Roda 1x por encounter (idempotente via UNIQUE INDEX uniq_post_consult_followup).
 */
async function generatePostConsultationFollowups() {
  const client = await getPool().connect();
  try {
    // Encounters assinados (signed_at) nos últimos 30d que ainda não têm
    // follow-up agendado. signed_at = encontro fechado/finalizado pelo médico
    // (não cancelado, não em rascunho).
    const { rows: encounters } = await client.query(`
      SELECT
        e.id, e.tenant_id, e.subject_id, e.signed_at AS reference_at,
        s.name AS subject_name, s.phone AS subject_phone,
        o.name AS owner_name, o.phone AS owner_phone,
        t.name AS tenant_name,
        COALESCE(np.post_consultation_followup_enabled, TRUE) AS enabled,
        COALESCE(np.post_consultation_followup_days, 7) AS days
      FROM clinical_encounters e
      JOIN tenants t ON t.id = e.tenant_id AND t.active = TRUE
      LEFT JOIN subjects s ON s.id = e.subject_id AND s.deleted_at IS NULL
      LEFT JOIN owners o ON o.id = s.owner_id
      LEFT JOIN notification_preferences np ON np.tenant_id = e.tenant_id
      WHERE e.signed_at IS NOT NULL
        AND e.signed_at >= NOW() - INTERVAL '30 days'
        AND NOT EXISTS (
          SELECT 1 FROM scheduled_notifications sn
          WHERE sn.encounter_id = e.id
            AND sn.notification_type = 'post_consultation_followup'
            AND sn.status IN ('pending','sent')
        )
      LIMIT 200
    `);

    let created = 0;
    for (const enc of encounters) {
      if (!enc.enabled) continue;
      const phone = enc.owner_phone || enc.subject_phone;
      if (!phone) continue;

      const recipient_name = enc.owner_name || enc.subject_name || 'cliente';
      const scheduled_for = new Date(new Date(enc.reference_at).getTime() + enc.days * 24 * 60 * 60 * 1000);

      // Se já passou da janela (30d+), skip
      if (scheduled_for < new Date(Date.now() - 24 * 60 * 60 * 1000)) continue;

      const body = render(TEMPLATES.post_consultation_followup, {
        nome: recipient_name,
        tenant_name: enc.tenant_name,
      });

      const r = await client.query(
        `INSERT INTO scheduled_notifications (
           tenant_id, notification_type, encounter_id, subject_id,
           channel, send_to, body, scheduled_for, status
         ) VALUES ($1, 'post_consultation_followup', $2, $3, 'whatsapp', $4, $5, $6, 'pending')
         ON CONFLICT (encounter_id)
           WHERE notification_type = 'post_consultation_followup'
                 AND encounter_id IS NOT NULL
                 AND status IN ('pending','sent')
           DO NOTHING
         RETURNING id`,
        [enc.tenant_id, enc.id, enc.subject_id, phone, body, scheduled_for.toISOString()]
      );
      if (r.rows.length > 0) created++;
    }
    if (created > 0) console.log(`[notif] Generated ${created} post-consultation follow-ups`);
  } finally {
    client.release();
  }
}

/**
 * STEP 1c: gera follow-up pós-exame com alerta high/critical.
 * Roda 1x por exam (idempotente via UNIQUE INDEX uniq_exam_alert_followup).
 */
async function generateExamAlertFollowups() {
  const client = await getPool().connect();
  try {
    // Exams completed nos últimos 90d com pelo menos 1 alerta high ou critical
    // que ainda não têm follow-up
    const { rows: exams } = await client.query(`
      SELECT
        ex.id, ex.tenant_id, ex.subject_id, ex.created_at,
        s.name AS subject_name, s.phone AS subject_phone,
        o.name AS owner_name, o.phone AS owner_phone,
        t.name AS tenant_name,
        COALESCE(np.exam_alert_followup_enabled, TRUE) AS enabled,
        COALESCE(np.exam_alert_followup_days, 30) AS days
      FROM exams ex
      JOIN tenants t ON t.id = ex.tenant_id AND t.active = TRUE
      LEFT JOIN subjects s ON s.id = ex.subject_id AND s.deleted_at IS NULL
      LEFT JOIN owners o ON o.id = s.owner_id
      LEFT JOIN notification_preferences np ON np.tenant_id = ex.tenant_id
      WHERE ex.status = 'done'
        AND ex.created_at >= NOW() - INTERVAL '90 days'
        AND EXISTS (
          SELECT 1 FROM clinical_results cr
          WHERE cr.exam_id = ex.id
            AND cr.alerts::text ILIKE ANY (ARRAY['%"severity":"high"%','%"severity":"critical"%'])
        )
        AND NOT EXISTS (
          SELECT 1 FROM scheduled_notifications sn
          WHERE sn.exam_id = ex.id
            AND sn.notification_type = 'exam_alert_followup'
            AND sn.status IN ('pending','sent')
        )
      LIMIT 200
    `);

    let created = 0;
    for (const ex of exams) {
      if (!ex.enabled) continue;
      const phone = ex.owner_phone || ex.subject_phone;
      if (!phone) continue;

      const recipient_name = ex.owner_name || ex.subject_name || 'cliente';
      const scheduled_for = new Date(new Date(ex.created_at).getTime() + ex.days * 24 * 60 * 60 * 1000);
      if (scheduled_for < new Date(Date.now() - 24 * 60 * 60 * 1000)) continue;

      const body = render(TEMPLATES.exam_alert_followup, {
        nome: recipient_name,
        dias: String(ex.days),
        tenant_name: ex.tenant_name,
      });

      const r = await client.query(
        `INSERT INTO scheduled_notifications (
           tenant_id, notification_type, exam_id, subject_id,
           channel, send_to, body, scheduled_for, status
         ) VALUES ($1, 'exam_alert_followup', $2, $3, 'whatsapp', $4, $5, $6, 'pending')
         ON CONFLICT (exam_id)
           WHERE notification_type = 'exam_alert_followup'
                 AND exam_id IS NOT NULL
                 AND status IN ('pending','sent')
           DO NOTHING
         RETURNING id`,
        [ex.tenant_id, ex.id, ex.subject_id, phone, body, scheduled_for.toISOString()]
      );
      if (r.rows.length > 0) created++;
    }
    if (created > 0) console.log(`[notif] Generated ${created} exam-alert follow-ups`);
  } finally {
    client.release();
  }
}

/**
 * STEP 1d: gera lembretes de próxima dose de vacina (vet).
 * Idempotente via UNIQUE INDEX uniq_vaccine_dose_reminder em (vaccine_id, hours_before).
 * Default: T-7d (168h) e T-1d (24h).
 */
async function generateVaccineDoseReminders() {
  const client = await getPool().connect();
  try {
    // Vacinas com next_dose_date no futuro (próximos 14d) que ainda não têm reminder
    const { rows: vaccines } = await client.query(`
      SELECT
        v.id, v.tenant_id, v.subject_id, v.vaccine_name, v.next_dose_date,
        s.name AS subject_name, s.phone AS subject_phone,
        o.name AS owner_name, o.phone AS owner_phone,
        t.name AS tenant_name,
        COALESCE(np.vaccine_dose_reminder_enabled, TRUE) AS enabled,
        COALESCE(np.vaccine_dose_reminder_hours_before, ARRAY[168, 24]) AS hours_before
      FROM vaccines v
      JOIN tenants t ON t.id = v.tenant_id AND t.active = TRUE
      LEFT JOIN subjects s ON s.id = v.subject_id AND s.deleted_at IS NULL
      LEFT JOIN owners o ON o.id = s.owner_id
      LEFT JOIN notification_preferences np ON np.tenant_id = v.tenant_id
      WHERE v.next_dose_date IS NOT NULL
        AND v.next_dose_date >= CURRENT_DATE
        AND v.next_dose_date <= CURRENT_DATE + INTERVAL '14 days'
      LIMIT 500
    `);

    let created = 0;
    for (const vac of vaccines) {
      if (!vac.enabled) continue;
      const phone = vac.owner_phone || vac.subject_phone;
      if (!phone) continue;

      const recipient_name = vac.owner_name || vac.subject_name || 'cliente';
      // next_dose_date é DATE — assume meio-dia local pra evitar timezone weirdness
      const dueAt = new Date(vac.next_dose_date);
      dueAt.setHours(12, 0, 0, 0);
      const dataStr = dueAt.toLocaleDateString('pt-BR');

      const hoursAsc = [...vac.hours_before].sort((a, b) => a - b);
      const minH = hoursAsc[0];
      const now = new Date();

      for (const h of hoursAsc) {
        let scheduled_for = new Date(dueAt.getTime() - h * 60 * 60 * 1000);
        if (scheduled_for < now) {
          if (h === minH) {
            scheduled_for = now;
          } else {
            continue;
          }
        }

        const tplKey = h >= 48 ? 'vaccine_dose_reminder_7d' : 'vaccine_dose_reminder_1d';
        const body = render(TEMPLATES[tplKey], {
          nome: recipient_name,
          paciente: vac.subject_name || 'seu pet',
          vacina: vac.vaccine_name,
          data: dataStr,
          tenant_name: vac.tenant_name,
        });

        const r = await client.query(
          `INSERT INTO scheduled_notifications (
             tenant_id, notification_type, vaccine_id, subject_id,
             channel, send_to, body, scheduled_for, hours_before, status
           ) VALUES ($1, 'vaccine_dose_reminder', $2, $3, 'whatsapp', $4, $5, $6, $7, 'pending')
           ON CONFLICT (vaccine_id, hours_before)
             WHERE notification_type = 'vaccine_dose_reminder'
                   AND vaccine_id IS NOT NULL
                   AND hours_before IS NOT NULL
                   AND status IN ('pending','sent')
             DO NOTHING
           RETURNING id`,
          [vac.tenant_id, vac.id, vac.subject_id, phone, body, scheduled_for.toISOString(), h]
        );
        if (r.rows.length > 0) created++;
      }
    }
    if (created > 0) console.log(`[notif] Generated ${created} vaccine dose reminders`);
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
      SELECT
        sn.id, sn.tenant_id, sn.channel, sn.send_to, sn.body,
        sn.appointment_id, sn.subject_id, sn.retry_count, sn.notification_type,
        a.user_id AS appointment_user_id,
        a.start_at AS appointment_start_at
      FROM scheduled_notifications sn
      LEFT JOIN appointments a ON a.id = sn.appointment_id
      WHERE sn.status = 'pending'
        AND sn.scheduled_for <= NOW()
        AND sn.retry_count < 3
      ORDER BY sn.scheduled_for ASC
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

        // Push notification para o médico responsável pelo agendamento (best-effort)
        if (n.notification_type === 'appointment_reminder' && n.appointment_user_id) {
          try {
            const { sendToUser } = require('../../../api/src/services/push');
            const hora = new Date(n.appointment_start_at).toLocaleTimeString('pt-BR', {
              hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
            });
            const subjectName = n.body.match(/Olá (.+?)!/)?.[1] || 'Paciente';
            await sendToUser(getPool(), n.appointment_user_id, {
              title: 'Consulta em breve',
              body: `${subjectName} — ${hora}`,
              data: { route: '/agenda' },
            });
          } catch (pushErr) {
            console.error('[push] appointment reminder push error:', pushErr.message);
          }
        }
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

// Cleanup diário de error_log antigo. Mantém últimos 90 dias.
// Em memória — em restart do worker re-executa em ~30s (idempotente, DELETE
// não duplica). Multi-instância (desiredCount>1) cada uma roda uma vez por dia,
// custo desprezível dado o índice em created_at (migration 085).
const ERROR_LOG_RETENTION_DAYS = 90;
let lastErrorLogCleanup = 0;
async function cleanupOldErrorLogs() {
  const now = Date.now();
  if (now - lastErrorLogCleanup < 23 * 60 * 60 * 1000) return; // <23h desde última
  lastErrorLogCleanup = now;
  const client = await getPool().connect();
  try {
    const { rowCount } = await client.query(
      `DELETE FROM error_log WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(ERROR_LOG_RETENTION_DAYS)]
    );
    if (rowCount > 0) {
      console.log(`[notif] Cleaned ${rowCount} error_log entries >${ERROR_LOG_RETENTION_DAYS}d old`);
    }
  } catch (err) {
    console.error('[notif] error_log cleanup failed:', err.message);
  } finally {
    client.release();
  }
}

async function tick() {
  const startTs = Date.now();
  try {
    console.log('[notif] tick start');
    await generateRemindersForUpcoming();
    // Follow-ups (idempotentes — re-execução não duplica)
    await generatePostConsultationFollowups();
    await generateExamAlertFollowups();
    await generateVaccineDoseReminders();
    await sendPendingNotifications();
    await cleanupOldErrorLogs();
    if (shouldTickRun(new Date())) {
      try {
        const result = await runDiscovery({ pool: getPool() });
        if (!result.skipped) {
          console.log(`[notif] aesthetic-discovery inserted ${result.inserted}`);
        }
      } catch (e) {
        console.error('[notif] aesthetic-discovery failed:', e.message);
      }
    }
    if (shouldPurgeRun(new Date())) {
      try {
        const result = await runPurgeSensitive({ pool: getPool() });
        if (!result.skipped) {
          console.log(`[notif] aesthetic-purge-sensitive purged ${result.purged}/${result.eligible}`);
        }
      } catch (e) {
        console.error('[notif] aesthetic-purge-sensitive failed:', e.message);
      }
    }
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

module.exports = {
  startScheduler, tick,
  generateRemindersForUpcoming,
  generatePostConsultationFollowups,
  generateExamAlertFollowups,
  generateVaccineDoseReminders,
  sendPendingNotifications,
  cleanupOldErrorLogs,
};
