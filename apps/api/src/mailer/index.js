'use strict';

const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const REGION = process.env.AWS_REGION || process.env.SES_REGION || 'us-east-1';
const FROM = process.env.SES_FROM_EMAIL || 'noreply@genomaflow.com.br';
const REPLY_TO = process.env.SES_REPLY_TO || null;
const CONFIG_SET = process.env.SES_CONFIGURATION_SET || null;  // ex: 'genomaflow-events'

let _client = null;
function client() {
  if (!_client) _client = new SESv2Client({ region: REGION });
  return _client;
}

/**
 * Envia email transacional via AWS SES v2.
 *
 * Suppression list (Phase 3.5 — feedback_ses_bounce_handling.md):
 * Antes de chamar SES, checa se email está em `email_suppressions`. Se sim,
 * skipa silenciosamente (retorna { suppressed: true }) — emails que deram
 * bounce permanente OU complaint não devem mais ser enviados pra manter
 * reputação SES (bounce <5%, complaint <0.1%, exigência da AWS).
 *
 * @param {{to: string, subject: string, html: string, text: string, pg?: object, log?: object}} opts
 *   pg: pool postgres pra checar suppressions (opcional — se não passar, skipa check)
 *   log: pino logger (opcional)
 */
async function sendEmail({ to, subject, html, text, pg, log }) {
  // Suppression check (best-effort — se pg não fornecido ou falhar, segue envio)
  if (pg) {
    try {
      const supp = require('../services/email-suppressions');
      if (await supp.isSuppressed(pg, to)) {
        if (log) log.info({ to, subject }, '[mailer] email suprimido — skip envio');
        else console.log('[mailer] suppressed: %s — skip', to);
        return { suppressed: true, MessageId: null };
      }
    } catch (err) {
      // Não bloqueia envio por falha na checagem (best-effort)
      if (log) log.warn({ err: err.message }, '[mailer] check suppression falhou — segue envio');
    }
  }

  if (process.env.SES_MOCK === '1') {
    console.log('[mailer:mock] to=%s subject=%s', to, subject);
    console.log('[mailer:mock] text:\n%s', text);
    return { MessageId: 'mock-' + Date.now() };
  }

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

  return client().send(cmd);
}

module.exports = { sendEmail };
