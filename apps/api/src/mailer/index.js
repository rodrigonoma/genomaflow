'use strict';

const FROM = process.env.SES_FROM_EMAIL || 'noreply@genomaflow.com.br';
// SMTP_FROM_EMAIL overrides FROM when sending via SMTP (Zoho auth requer mesmo endereço).
const SMTP_FROM = process.env.SMTP_FROM_EMAIL || FROM;
const REPLY_TO = process.env.SES_REPLY_TO || null;

// ---------------------------------------------------------------------------
// SMTP transport (Zoho / qualquer SMTP) — ativo quando SMTP_HOST está definido.
// Quando SES sair de sandbox, basta remover as env vars SMTP_* e o mailer
// volta automaticamente a usar SES.
// ---------------------------------------------------------------------------
function buildSmtpTransport() {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE !== 'false', // true = SSL (porta 465)
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

let _smtpTransport = null;
function smtpTransport() {
  if (!_smtpTransport) _smtpTransport = buildSmtpTransport();
  return _smtpTransport;
}

// ---------------------------------------------------------------------------
// SES transport (padrão de produção)
// ---------------------------------------------------------------------------
let _sesClient = null;
function sesClient() {
  if (!_sesClient) {
    const { SESv2Client } = require('@aws-sdk/client-sesv2');
    const REGION = process.env.AWS_REGION || process.env.SES_REGION || 'us-east-1';
    _sesClient = new SESv2Client({ region: REGION });
  }
  return _sesClient;
}

async function sendViaSes({ to, subject, html, text }) {
  const { SendEmailCommand } = require('@aws-sdk/client-sesv2');
  const CONFIG_SET = process.env.SES_CONFIGURATION_SET || null;
  const cmd = new SendEmailCommand({
    FromEmailAddress: FROM,
    ...(REPLY_TO ? { ReplyToAddresses: [REPLY_TO] } : {}),
    ...(CONFIG_SET ? { ConfigurationSetName: CONFIG_SET } : {}),
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: text, Charset: 'UTF-8' },
        },
      },
    },
  });
  return sesClient().send(cmd);
}

async function sendViaSmtp({ to, subject, html, text }) {
  const info = await smtpTransport().sendMail({
    from: SMTP_FROM,
    ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
    to,
    subject,
    html,
    text,
  });
  return { MessageId: info.messageId };
}

/**
 * Envia email transacional — usa SMTP (Zoho) se SMTP_HOST estiver definido,
 * caso contrário usa AWS SES v2.
 *
 * @param {{to, subject, html, text, pg?, log?}} opts
 */
async function sendEmail({ to, subject, html, text, pg, log }) {
  if (pg) {
    try {
      const supp = require('../services/email-suppressions');
      if (await supp.isSuppressed(pg, to)) {
        if (log) log.info({ to, subject }, '[mailer] email suprimido — skip envio');
        else console.log('[mailer] suppressed: %s — skip', to);
        return { suppressed: true, MessageId: null };
      }
    } catch (err) {
      if (log) log.warn({ err: err.message }, '[mailer] check suppression falhou — segue envio');
    }
  }

  if (process.env.SES_MOCK === '1') {
    console.log('[mailer:mock] to=%s subject=%s', to, subject);
    console.log('[mailer:mock] text:\n%s', text);
    return { MessageId: 'mock-' + Date.now() };
  }

  if (process.env.SMTP_HOST) {
    console.log('[mailer] usando SMTP (%s) → %s', process.env.SMTP_HOST, to);
    return sendViaSmtp({ to, subject, html, text });
  }

  return sendViaSes({ to, subject, html, text });
}

module.exports = { sendEmail };
