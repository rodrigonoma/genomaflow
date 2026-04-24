'use strict';

const { randomBytes, createHash } = require('crypto');
const { sendEmail } = require('./index');
const { emailVerification } = require('./templates');

const VERIFICATION_TTL_HOURS = 48;

function newToken() {
  const plain = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(plain).digest('hex');
  return { plain, hash };
}

function frontendBase() {
  return (process.env.FRONTEND_URL || 'https://genomaflow.com.br').replace(/\/$/, '');
}

/**
 * Gera token novo, atualiza a linha do user (hash + expiração + last_sent_at)
 * e dispara o email. Lança se SES falhar — caller decide como tratar.
 *
 * @param {import('pg').Pool} pg
 * @param {string} userId
 * @param {string} email
 */
async function sendEmailVerification(pg, userId, email) {
  const { plain, hash } = newToken();
  const expires = new Date(Date.now() + VERIFICATION_TTL_HOURS * 3600 * 1000);

  await pg.query(
    `UPDATE users
       SET email_verification_token_hash = $1,
           email_verification_expires_at = $2,
           email_verification_last_sent_at = NOW()
     WHERE id = $3`,
    [hash, expires, userId]
  );

  const verifyUrl = `${frontendBase()}/verify-email?token=${plain}`;
  const tmpl = emailVerification({ verifyUrl });
  return sendEmail({ to: email, subject: tmpl.subject, text: tmpl.text, html: tmpl.html });
}

module.exports = { sendEmailVerification, VERIFICATION_TTL_HOURS };
