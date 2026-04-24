'use strict';

const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const REGION = process.env.AWS_REGION || process.env.SES_REGION || 'us-east-1';
const FROM = process.env.SES_FROM_EMAIL || 'noreply@genomaflow.com.br';
const REPLY_TO = process.env.SES_REPLY_TO || null;

let _client = null;
function client() {
  if (!_client) _client = new SESv2Client({ region: REGION });
  return _client;
}

/**
 * Envia email transacional via AWS SES v2.
 *
 * Em dev, se SES_MOCK=1 no env, só loga o email (útil sem configurar SES local).
 * Em prod, se SES falhar, relançamos o erro — caller decide o que fazer
 * (em fluxos críticos como onboarding, devolvemos 500; em fluxos best-effort
 * tipo resend, engolimos).
 *
 * @param {{to: string, subject: string, html: string, text: string}} opts
 */
async function sendEmail({ to, subject, html, text }) {
  if (process.env.SES_MOCK === '1') {
    console.log('[mailer:mock] to=%s subject=%s', to, subject);
    console.log('[mailer:mock] text:\n%s', text);
    return { MessageId: 'mock-' + Date.now() };
  }

  const cmd = new SendEmailCommand({
    FromEmailAddress: FROM,
    ...(REPLY_TO ? { ReplyToAddresses: [REPLY_TO] } : {}),
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
