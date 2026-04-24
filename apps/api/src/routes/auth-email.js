'use strict';

const bcrypt = require('bcrypt');
const { randomBytes, createHash } = require('crypto');
const { sendEmail } = require('../mailer');
const { passwordReset } = require('../mailer/templates');
const { sendEmailVerification } = require('../mailer/verification');

const RESET_TTL_MINUTES = 60;
const RESEND_COOLDOWN_SECONDS = 60;

function frontendBase() {
  return (process.env.FRONTEND_URL || 'https://genomaflow.com.br').replace(/\/$/, '');
}

function newToken() {
  const plain = randomBytes(32).toString('hex'); // 64 chars, url-safe
  const hash = createHash('sha256').update(plain).digest('hex');
  return { plain, hash };
}

function sha256(plain) {
  return createHash('sha256').update(plain).digest('hex');
}

module.exports = async function (fastify) {

  // ────────────────────────────────────────────────────────────────────────
  // POST /auth/email-verification/send
  // Autenticado — o próprio usuário pede reenvio pro seu próprio email.
  // Rate-limited: 5/hora por IP + cooldown de 60s via coluna last_sent_at.
  // ────────────────────────────────────────────────────────────────────────
  fastify.post('/email-verification/send', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { user_id } = request.user;

    const { rows } = await fastify.pg.query(
      `SELECT id, email, email_verified_at, email_verification_last_sent_at
       FROM users WHERE id = $1`,
      [user_id]
    );
    const user = rows[0];
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' });
    if (user.email_verified_at) {
      return reply.status(409).send({ error: 'E-mail já verificado' });
    }
    if (user.email_verification_last_sent_at) {
      const elapsed = (Date.now() - new Date(user.email_verification_last_sent_at).getTime()) / 1000;
      if (elapsed < RESEND_COOLDOWN_SECONDS) {
        return reply.status(429).send({
          error: `Aguarde ${Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed)}s antes de reenviar`,
        });
      }
    }

    try {
      await sendEmailVerification(fastify.pg, user.id, user.email);
    } catch (err) {
      request.log.error({ err }, 'falha ao enviar email de verificação');
      return reply.status(500).send({ error: 'Falha ao enviar email. Tente novamente.' });
    }
    return reply.status(204).send();
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST /auth/email-verification/send-by-email
  // Público — usa quando usuário tenta logar e login retorna EMAIL_NOT_VERIFIED.
  // Rate-limited agressivo + sempre retorna 204 (evita enumeration).
  // ────────────────────────────────────────────────────────────────────────
  fastify.post('/email-verification/send-by-email', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const email = String(request.body?.email || '').toLowerCase().trim();
    if (!email) return reply.status(400).send({ error: 'email obrigatório' });

    const { rows } = await fastify.pg.query(
      `SELECT id, email, email_verified_at, email_verification_last_sent_at
       FROM users WHERE LOWER(email) = $1`,
      [email]
    );
    const user = rows[0];
    // Responder 204 mesmo se usuário não existe ou já verificado — não vaza info
    if (!user || user.email_verified_at) return reply.status(204).send();

    if (user.email_verification_last_sent_at) {
      const elapsed = (Date.now() - new Date(user.email_verification_last_sent_at).getTime()) / 1000;
      if (elapsed < RESEND_COOLDOWN_SECONDS) return reply.status(204).send();
    }

    try {
      await sendEmailVerification(fastify.pg, user.id, user.email);
    } catch (err) {
      request.log.error({ err }, 'falha ao reenviar email de verificação (public)');
      // não vaza erro externo
    }
    return reply.status(204).send();
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST /auth/email-verification/verify
  // Público — consome token do email, marca verified.
  // ────────────────────────────────────────────────────────────────────────
  fastify.post('/email-verification/verify', {
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const token = String(request.body?.token || '').trim();
    if (!token || token.length < 32) {
      return reply.status(400).send({ error: 'Token inválido' });
    }

    const hash = sha256(token);
    const { rows } = await fastify.pg.query(
      `UPDATE users
         SET email_verified_at = NOW(),
             email_verification_token_hash = NULL,
             email_verification_expires_at = NULL
       WHERE email_verification_token_hash = $1
         AND email_verification_expires_at > NOW()
       RETURNING id, email`,
      [hash]
    );
    if (!rows[0]) {
      return reply.status(400).send({ error: 'Token inválido ou expirado' });
    }
    return { ok: true, email: rows[0].email };
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST /auth/password-reset/request
  // Público — sempre retorna 204 pra evitar enumeration.
  // Rate-limited: 3/hora por IP + cooldown de 60s na linha do user.
  // ────────────────────────────────────────────────────────────────────────
  fastify.post('/password-reset/request', {
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const email = String(request.body?.email || '').toLowerCase().trim();
    if (!email) return reply.status(400).send({ error: 'email obrigatório' });

    const { rows } = await fastify.pg.query(
      `SELECT id, email, password_reset_last_sent_at, active
       FROM users WHERE LOWER(email) = $1`,
      [email]
    );
    const user = rows[0];
    if (!user || !user.active) return reply.status(204).send();

    if (user.password_reset_last_sent_at) {
      const elapsed = (Date.now() - new Date(user.password_reset_last_sent_at).getTime()) / 1000;
      if (elapsed < RESEND_COOLDOWN_SECONDS) return reply.status(204).send();
    }

    const { plain, hash } = newToken();
    const expires = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);

    await fastify.pg.query(
      `UPDATE users
         SET password_reset_token_hash = $1,
             password_reset_expires_at = $2,
             password_reset_last_sent_at = NOW()
       WHERE id = $3`,
      [hash, expires, user.id]
    );

    const resetUrl = `${frontendBase()}/reset-password?token=${plain}`;
    const { subject, text, html } = passwordReset({ resetUrl });
    try {
      await sendEmail({ to: user.email, subject, text, html });
    } catch (err) {
      request.log.error({ err }, 'falha ao enviar email de reset');
      // Não vaza erro — usuário tenta de novo.
    }
    return reply.status(204).send();
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST /auth/password-reset/confirm
  // Público — valida token + nova senha, atualiza password_hash, invalida token.
  // ────────────────────────────────────────────────────────────────────────
  fastify.post('/password-reset/confirm', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const token = String(request.body?.token || '').trim();
    const newPassword = String(request.body?.new_password || '');

    if (!token || token.length < 32) {
      return reply.status(400).send({ error: 'Token inválido' });
    }
    if (newPassword.length < 8) {
      return reply.status(400).send({ error: 'Senha deve ter no mínimo 8 caracteres' });
    }

    const hash = sha256(token);
    const { rows } = await fastify.pg.query(
      `SELECT id, email FROM users
       WHERE password_reset_token_hash = $1
         AND password_reset_expires_at > NOW()`,
      [hash]
    );
    const user = rows[0];
    if (!user) return reply.status(400).send({ error: 'Token inválido ou expirado' });

    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Atualiza senha, invalida o token, e invalida sessão ativa (session:<userid>)
    // pra forçar re-login com a nova senha em todos os devices.
    await fastify.pg.query(
      `UPDATE users
         SET password_hash = $1,
             password_reset_token_hash = NULL,
             password_reset_expires_at = NULL
       WHERE id = $2`,
      [passwordHash, user.id]
    );
    try { await fastify.redis.del(`session:${user.id}`); } catch (_) {}

    return { ok: true };
  });
};
