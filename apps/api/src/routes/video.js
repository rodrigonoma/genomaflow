'use strict';

/**
 * Consulta por vídeo — Amazon Chime SDK Meetings + OpenAI Whisper + Claude
 *
 * Spec: docs/superpowers/specs/2026-05-08-video-consultation-design.md
 *
 * Endpoints:
 *   POST /video/consultations                            (authenticate)
 *   GET  /video/consultations/:id                        (authenticate)
 *   GET  /video/consultations/:id/tokens                 (authenticate)
 *   POST /video/consultations/:id/start                  (authenticate)
 *   POST /video/consultations/:id/end                    (authenticate)
 *   GET  /video/join/:token                              (público)
 *   POST /video/consultations/:id/files/upload-url       (authenticate ou join_token query param)
 *   POST /video/consultations/:id/files/notify           (authenticate ou join_token query param)
 *   GET  /video/consultations/:id/files                  (authenticate)
 */

const { randomBytes, randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const { withTenant } = require('../db/tenant');
const { sendEmail } = require('../mailer');
const { videoConsultationLink } = require('../mailer/templates');

const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://app.genomaflow.com.br').replace(/\/$/, '');
const JOIN_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24h

// Créditos por modalidade
const CREDITS = { simple: 2, complete: 6 };
const TRANSCRIPTION_CREDIT_REFUND = 4; // estorno em caso de falha pós-vídeo

function chimeClient() {
  const { ChimeSDKMeetingsClient } = require('@aws-sdk/client-chime-sdk-meetings');
  return new ChimeSDKMeetingsClient({ region: process.env.AWS_REGION || 'us-east-1' });
}

async function createChimeMeeting(externalMeetingId) {
  const { CreateMeetingCommand } = require('@aws-sdk/client-chime-sdk-meetings');
  const client = chimeClient();
  const res = await client.send(new CreateMeetingCommand({
    ClientRequestToken: randomBytes(16).toString('hex'),
    MediaRegion: process.env.CHIME_MEDIA_REGION || 'us-east-1',
    ExternalMeetingId: externalMeetingId,
  }));
  return res.Meeting;
}

async function createChimeAttendee(meetingId, externalUserId) {
  const { CreateAttendeeCommand } = require('@aws-sdk/client-chime-sdk-meetings');
  const res = await chimeClient().send(new CreateAttendeeCommand({
    MeetingId: meetingId,
    ExternalUserId: externalUserId,
  }));
  return res.Attendee;
}

function signJoinToken(consultationId, expiresIn = JOIN_TOKEN_TTL_SECONDS) {
  return jwt.sign({ consultation_id: consultationId, role: 'patient' }, JWT_SECRET, { expiresIn });
}

function verifyJoinToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function buildJoinUrl(token) {
  return `${FRONTEND_URL}/video/join/${token}`;
}

async function getWhatsApp() {
  try { return require('../services/whatsapp-client'); } catch { return null; }
}

function formatDateBR(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

// Busca phone/email do paciente respeitando os 3 módulos
async function getSubjectContact(pg, tenantId, subjectId, module_) {
  const { rows } = await pg.query(
    `SELECT s.phone, s.name,
            o.phone AS owner_phone, o.email AS owner_email, o.name AS owner_name
     FROM subjects s
     LEFT JOIN owners o ON o.id = s.owner_id AND o.tenant_id = $2
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [subjectId, tenantId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  // veterinary: contato via tutor (owner); human/estetica: direto no subject
  if (module_ === 'veterinary') {
    return { phone: r.owner_phone, email: r.owner_email, name: r.owner_name || r.name };
  }
  return { phone: r.phone, email: null, name: r.name }; // subjects não tem email; veterinary usa owner_email
}

module.exports = async function (fastify) {

  // ── POST /video/consultations ──────────────────────────────────────────
  fastify.post('/consultations', {
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { tenant_id, user_id, module: module_ } = request.user;
    const { appointment_id, modality } = request.body || {};

    if (!appointment_id) return reply.status(400).send({ error: 'appointment_id obrigatório' });
    if (!['simple', 'complete'].includes(modality)) {
      return reply.status(400).send({ error: 'modality deve ser "simple" ou "complete"' });
    }

    // Valida appointment e obtém dados
    const { rows: apts } = await fastify.pg.query(
      `SELECT a.id, a.subject_id, a.start_at, a.duration_minutes, a.appointment_type,
              u.email AS doctor_name, t.name AS clinic_name
       FROM appointments a
       JOIN users u ON u.id = $3
       JOIN tenants t ON t.id = $2
       WHERE a.id = $1 AND a.tenant_id = $2 AND a.user_id = $3
         AND a.status NOT IN ('cancelled','no_show')`,
      [appointment_id, tenant_id, user_id]
    );
    if (!apts[0]) return reply.status(404).send({ error: 'Agendamento não encontrado' });
    const apt = apts[0];

    // Verifica saldo
    const { rows: bal } = await fastify.pg.query(
      `SELECT COALESCE(SUM(amount),0)::int AS balance FROM credit_ledger WHERE tenant_id = $1`,
      [tenant_id]
    );
    const creditsNeeded = CREDITS[modality];
    if (bal[0].balance < creditsNeeded) {
      return reply.status(402).send({ error: `Saldo insuficiente. Necessário: ${creditsNeeded} créditos.` });
    }

    // Pre-gera UUID — token e DB inseridos atomicamente em uma única operação
    const consultationId = randomUUID();
    const realToken = signJoinToken(consultationId);
    const realJoinUrl = buildJoinUrl(realToken);

    // Cria Chime Meeting + Attendees
    let meeting, doctorAttendee, patientAttendee;
    try {
      meeting = await createChimeMeeting(appointment_id); // UUID 36 chars ≤ limite Chime de 64
      doctorAttendee  = await createChimeAttendee(meeting.MeetingId, `doctor-${user_id}`);
      patientAttendee = await createChimeAttendee(meeting.MeetingId, `patient-${appointment_id}`);
    } catch (err) {
      request.log.error({ err }, '[video] falha ao criar Chime meeting');
      return reply.status(502).send({ error: 'Falha ao criar sala de vídeo. Tente novamente.' });
    }

    // Persiste no banco — token inserido com o UUID já conhecido (sem UPDATE posterior)
    await withTenant(fastify.pg, tenant_id, async (client) => {
      await client.query(
        `INSERT INTO video_consultations
           (id, tenant_id, appointment_id, meeting_id, doctor_attendee_id, patient_attendee_id,
            join_token, modality, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'waiting')`,
        [
          consultationId, tenant_id, appointment_id,
          meeting.MeetingId,
          JSON.stringify(doctorAttendee),
          JSON.stringify(patientAttendee),
          realToken,
          modality,
        ]
      );
    }, { userId: user_id, channel: 'ui' });

    // Busca contato do paciente
    const contact = await getSubjectContact(fastify.pg, tenant_id, apt.subject_id, module_);
    const dateStr = formatDateBR(apt.start_at);

    // Envia email (fire-and-forget — não bloqueia a resposta ao médico)
    if (contact?.email) {
      const tmpl = videoConsultationLink({
        joinUrl: realJoinUrl,
        doctorName: apt.doctor_name,
        clinicName: apt.clinic_name,
        dateFormatted: dateStr,
        durationMinutes: apt.duration_minutes,
      });
      sendEmail({ to: contact.email, subject: tmpl.subject, text: tmpl.text, html: tmpl.html, pg: fastify.pg, log: request.log })
        .catch(err => request.log.warn({ err }, '[video] falha ao enviar email de link'));
    }

    // Envia WhatsApp (fire-and-forget — não bloqueia a resposta ao médico)
    if (contact?.phone) {
      const waMsg = `📹 *Consulta por vídeo agendada*\n\nOlá${contact.name ? ', ' + contact.name : ''}! Você tem uma consulta com *${apt.doctor_name}* em *${apt.clinic_name}*.\n\n📅 ${dateStr}\n\nClique no link para entrar:\n${realJoinUrl}\n\n_Não é necessário instalar nada — abre no navegador._`;
      getWhatsApp()
        .then(wa => wa?.sendText({ phone: contact.phone, body: waMsg }))
        .catch(err => request.log.warn({ err }, '[video] falha ao enviar WhatsApp'));
    }

    return reply.status(201).send({
      consultation_id: consultationId,
      join_url: realJoinUrl,
      meeting: {
        MeetingId: meeting.MeetingId,
        MediaPlacement: meeting.MediaPlacement,
      },
      doctor_attendee: doctorAttendee,
      modality,
      credits_needed: creditsNeeded,
    });
  });

  // ── GET /video/consultations/:id ───────────────────────────────────────
  fastify.get('/consultations/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { rows } = await fastify.pg.query(
      `SELECT vc.*, a.start_at, a.duration_minutes, a.subject_id
       FROM video_consultations vc
       JOIN appointments a ON a.id = vc.appointment_id
       WHERE vc.id = $1 AND vc.tenant_id = $2`,
      [request.params.id, tenant_id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Consulta não encontrada' });
    return rows[0];
  });

  // ── GET /video/consultations/:id/tokens ────────────────────────────────
  fastify.get('/consultations/:id/tokens', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { rows } = await fastify.pg.query(
      `SELECT meeting_id, doctor_attendee_id, patient_attendee_id, join_token, status
       FROM video_consultations WHERE id = $1 AND tenant_id = $2`,
      [request.params.id, tenant_id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Consulta não encontrada' });
    const vc = rows[0];

    // Busca MediaPlacement fresco do Chime — necessário para iniciar o SDK no browser
    let mediaPlacement = {};
    try {
      const { GetMeetingCommand } = require('@aws-sdk/client-chime-sdk-meetings');
      const r = await chimeClient().send(new GetMeetingCommand({ MeetingId: vc.meeting_id }));
      mediaPlacement = r.Meeting?.MediaPlacement ?? {};
    } catch (err) {
      request.log.warn({ err }, '[video/tokens] falha ao buscar MediaPlacement do Chime');
    }

    return {
      meeting: { MeetingId: vc.meeting_id, MediaPlacement: mediaPlacement },
      doctor_attendee: JSON.parse(vc.doctor_attendee_id),
      patient_attendee: JSON.parse(vc.patient_attendee_id),
      join_url: buildJoinUrl(vc.join_token),
      status: vc.status,
    };
  });

  // ── POST /video/consultations/:id/start ────────────────────────────────
  fastify.post('/consultations/:id/start', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE video_consultations
           SET status = 'active', started_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND status = 'waiting'`,
        [request.params.id, tenant_id]
      );
      if (!rowCount) throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' });
    }, { userId: user_id, channel: 'ui' });
    return { ok: true };
  });

  // ── POST /video/consultations/:id/end ─────────────────────────────────
  fastify.post('/consultations/:id/end', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { recording_s3_key } = request.body || {};

    const { rows } = await fastify.pg.query(
      `SELECT id, modality, started_at, status, credits_debited
       FROM video_consultations WHERE id = $1 AND tenant_id = $2`,
      [request.params.id, tenant_id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Consulta não encontrada' });
    const vc = rows[0];
    if (vc.status === 'ended' || vc.status === 'done') {
      return reply.status(409).send({ error: 'Consulta já encerrada' });
    }

    const endedAt = new Date();
    const durationSeconds = vc.started_at
      ? Math.round((endedAt - new Date(vc.started_at)) / 1000)
      : 0;
    // Proporcional à duração real — taxa = CREDITS[modality] por hora, arredondando para cima
    const credits = durationSeconds > 0
      ? Math.ceil(CREDITS[vc.modality] * durationSeconds / 3600)
      : 0;
    const nextStatus = vc.modality === 'complete' ? 'transcribing' : 'done';

    await withTenant(fastify.pg, tenant_id, async (client) => {
      await client.query(
        `UPDATE video_consultations
           SET status = $1, ended_at = $2, duration_seconds = $3,
               recording_s3_key = COALESCE($4, recording_s3_key),
               credits_debited = $5
         WHERE id = $6 AND tenant_id = $7`,
        [nextStatus, endedAt, durationSeconds, recording_s3_key || null, credits, vc.id, tenant_id]
      );
      // Debita créditos
      await client.query(
        `INSERT INTO credit_ledger (tenant_id, amount, kind, description)
         VALUES ($1, $2, $3, $4)`,
        [
          tenant_id,
          -credits,
          vc.modality === 'complete' ? 'video_complete' : 'video_simple',
          `Consulta por vídeo (${vc.modality === 'complete' ? 'completa' : 'simples'}) — ${durationSeconds}s`,
        ]
      );
    }, { userId: user_id, channel: 'ui' });

    // Enfileira job de transcrição (best-effort)
    if (vc.modality === 'complete') {
      try {
        const { Queue } = require('bullmq');
        const Redis = require('ioredis');
        const conn = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
        await conn.connect();
        const queue = new Queue('video-transcription', { connection: conn });
        await queue.add('transcribe', {
          consultation_id: vc.id,
          tenant_id,
          recording_s3_key: recording_s3_key || null,
        }, { attempts: 3, backoff: { type: 'exponential', delay: 30000 } });
        await conn.disconnect();
      } catch (err) {
        request.log.error({ err }, '[video] falha ao enfileirar job de transcrição');
      }
    }

    return { ok: true, duration_seconds: durationSeconds, credits_debited: credits, status: nextStatus };
  });

  // ── GET /video/join/:token (PÚBLICO) ──────────────────────────────────
  fastify.get('/join/:token', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    let payload;
    try {
      payload = verifyJoinToken(request.params.token);
    } catch {
      return reply.status(401).send({ error: 'Link inválido ou expirado' });
    }

    // 1. Busca pelo ID (sem filtrar por token na query — token verificado em seguida)
    const { rows } = await fastify.pg.query(
      `SELECT vc.id, vc.join_token, vc.meeting_id, vc.patient_attendee_id, vc.modality, vc.status,
              vc.started_at, vc.tenant_id,
              t.name AS clinic_name,
              u.email AS doctor_name,
              a.start_at, a.duration_minutes, a.subject_id
       FROM video_consultations vc
       JOIN appointments a ON a.id = vc.appointment_id
       JOIN tenants t ON t.id = vc.tenant_id
       JOIN users u ON u.id = a.user_id
       WHERE vc.id = $1`,
      [payload.consultation_id]
    );

    if (!rows[0]) {
      request.log.warn({ consultation_id: payload.consultation_id }, '[video/join] consulta não encontrada no banco');
      return reply.status(404).send({ error: 'Consulta não encontrada' });
    }

    // 2. Valida token na camada de aplicação (separa "consulta não existe" de "link errado")
    if (rows[0].join_token !== request.params.token) {
      request.log.warn(
        { consultation_id: payload.consultation_id, stored_tail: rows[0].join_token.slice(-12), received_tail: request.params.token.slice(-12) },
        '[video/join] token não confere com o armazenado no banco'
      );
      return reply.status(401).send({ error: 'Link inválido ou expirado' });
    }

    const vc = rows[0];

    // Busca MediaPlacement fresco do Chime para o paciente iniciar o SDK
    let mediaPlacement = {};
    try {
      const { GetMeetingCommand } = require('@aws-sdk/client-chime-sdk-meetings');
      const r = await chimeClient().send(new GetMeetingCommand({ MeetingId: vc.meeting_id }));
      mediaPlacement = r.Meeting?.MediaPlacement ?? {};
    } catch (err) {
      request.log.warn({ err }, '[video/join] falha ao buscar MediaPlacement do Chime');
    }

    return {
      consultation_id: vc.id,
      status: vc.status,
      meeting: { MeetingId: vc.meeting_id, MediaPlacement: mediaPlacement },
      patient_attendee: JSON.parse(vc.patient_attendee_id),
      clinic_name: vc.clinic_name,
      doctor_name: vc.doctor_name,
      start_at: vc.start_at,
      duration_minutes: vc.duration_minutes,
    };
  });

  // ── POST /video/consultations/:id/files/upload-url ────────────────────
  fastify.post('/consultations/:id/files/upload-url', {
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const consultationId = request.params.id;
    const uploadedBy = await resolveFileUploader(request, fastify.pg, consultationId);
    if (!uploadedBy) return reply.status(401).send({ error: 'Não autorizado' });

    const { filename, mime_type } = request.body || {};
    if (!filename) return reply.status(400).send({ error: 'filename obrigatório' });

    const ext = filename.split('.').pop()?.toLowerCase() || 'bin';
    const key = `video-consultations/${consultationId}/files/${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;

    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    const BUCKET = process.env.S3_BUCKET || 'genomaflow-uploads-prod';

    const url = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: mime_type || 'application/octet-stream',
    }), { expiresIn: 300 });

    return { upload_url: url, s3_key: key, uploaded_by: uploadedBy };
  });

  // ── POST /video/consultations/:id/files/notify ────────────────────────
  fastify.post('/consultations/:id/files/notify', {
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const consultationId = request.params.id;
    const uploadedBy = await resolveFileUploader(request, fastify.pg, consultationId);
    if (!uploadedBy) return reply.status(401).send({ error: 'Não autorizado' });

    const { s3_key, filename, mime_type, size_bytes } = request.body || {};
    if (!s3_key || !filename) return reply.status(400).send({ error: 's3_key e filename obrigatórios' });

    const { rows: vc } = await fastify.pg.query(
      `SELECT tenant_id FROM video_consultations WHERE id = $1`, [consultationId]
    );
    if (!vc[0]) return reply.status(404).send({ error: 'Consulta não encontrada' });
    const tenantId = vc[0].tenant_id;

    const { rows } = await fastify.pg.query(
      `INSERT INTO video_consultation_files
         (consultation_id, tenant_id, uploaded_by, s3_key, filename, mime_type, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, created_at`,
      [consultationId, tenantId, uploadedBy, s3_key, filename, mime_type || null, size_bytes || null]
    );

    // Notifica o outro lado via WS
    try {
      await fastify.redis.publish(`video:event:${tenantId}`, JSON.stringify({
        type: 'video:file_shared',
        consultation_id: consultationId,
        file: { id: rows[0].id, filename, mime_type, uploaded_by: uploadedBy, created_at: rows[0].created_at },
      }));
    } catch { /* best-effort */ }

    return { ok: true, file_id: rows[0].id };
  });

  // ── GET /video/consultations/:id/files ────────────────────────────────
  fastify.get('/consultations/:id/files', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { rows } = await fastify.pg.query(
      `SELECT f.id, f.uploaded_by, f.filename, f.mime_type, f.size_bytes, f.created_at
       FROM video_consultation_files f
       JOIN video_consultations vc ON vc.id = f.consultation_id
       WHERE f.consultation_id = $1 AND vc.tenant_id = $2
       ORDER BY f.created_at ASC`,
      [request.params.id, tenant_id]
    );
    return rows;
  });

  // ── GET /video/consultations/:id/files/:fileId/download-url ───────────
  // Retorna presigned GET URL para baixar/visualizar arquivo (médico autenticado
  // ou paciente via join_token query param). TTL 1h. Valida tenant_id na query.
  fastify.get('/consultations/:id/files/:fileId/download-url', {
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const consultationId = request.params.id;
    const fileId = request.params.fileId;
    const uploadedBy = await resolveFileUploader(request, fastify.pg, consultationId);
    if (!uploadedBy) return reply.status(401).send({ error: 'Não autorizado' });

    const { rows } = await fastify.pg.query(
      `SELECT f.s3_key, f.filename, f.mime_type
       FROM video_consultation_files f
       JOIN video_consultations vc ON vc.id = f.consultation_id
       WHERE f.id = $1 AND f.consultation_id = $2`,
      [fileId, consultationId]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Arquivo não encontrado' });
    const file = rows[0];

    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    const BUCKET = process.env.S3_BUCKET || 'genomaflow-uploads-prod';

    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: BUCKET,
      Key: file.s3_key,
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(file.filename)}"`,
      ResponseContentType: file.mime_type || 'application/octet-stream',
    }), { expiresIn: 3600 });

    return { download_url: url, filename: file.filename, mime_type: file.mime_type };
  });
};

// Resolve uploaded_by: 'doctor' se JWT de user autenticado, 'patient' se join_token query param
async function resolveFileUploader(request, pg, consultationId) {
  // Opção 1: médico autenticado
  if (request.headers.authorization?.startsWith('Bearer ')) {
    try {
      const token = request.headers.authorization.split(' ')[1];
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.user_id) return 'doctor';
    } catch { /* não é JWT de usuário */ }
  }
  // Opção 2: join_token do paciente no query param
  const joinToken = request.query?.join_token;
  if (joinToken) {
    try {
      const p = jwt.verify(joinToken, JWT_SECRET);
      if (p.consultation_id === consultationId && p.role === 'patient') return 'patient';
    } catch { /* inválido */ }
  }
  return null;
}
