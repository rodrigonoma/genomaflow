'use strict';

const BRAND = 'GenomaFlow';
const PRIMARY = '#494bd6';
const FG = '#0b1326';
const FG2 = '#3a3b57';

function layout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${FG};">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <div style="margin-bottom:24px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:20px;color:${PRIMARY};letter-spacing:-0.02em;">${BRAND}</div>
      ${bodyHtml}
    </div>
    <div style="margin-top:16px;font-size:12px;color:${FG2};text-align:center;">
      Este é um email automático — responder a este endereço não gera retorno.<br>
      © ${new Date().getFullYear()} GenomaFlow. Plataforma de Inteligência Clínica.
    </div>
  </div>
</body>
</html>`;
}

function button(url, label) {
  return `<a href="${url}" style="display:inline-block;background:${PRIMARY};color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;font-size:14px;">${label}</a>`;
}

// ──────────────────────────────────────────────────────────────────────────
// Verificação de email
// ──────────────────────────────────────────────────────────────────────────
function emailVerification({ verifyUrl }) {
  const subject = `${BRAND} — confirme seu e-mail`;
  const text = [
    `Bem-vindo ao ${BRAND}!`,
    '',
    'Pra finalizar seu cadastro, confirme seu e-mail clicando no link abaixo:',
    '',
    verifyUrl,
    '',
    'O link é válido por 48 horas e só funciona uma vez.',
    '',
    'Se você não criou essa conta, pode ignorar este e-mail.',
  ].join('\n');
  const html = layout(subject, `
    <h2 style="font-size:18px;margin:0 0 12px;">Bem-vindo ao ${BRAND}!</h2>
    <p style="font-size:14px;line-height:1.5;color:${FG2};margin:0 0 20px;">
      Pra finalizar seu cadastro, confirme seu e-mail clicando no botão abaixo.
      O link é válido por <strong>48 horas</strong> e só funciona uma vez.
    </p>
    <p style="margin:24px 0;">${button(verifyUrl, 'Confirmar e-mail')}</p>
    <p style="font-size:12px;line-height:1.5;color:${FG2};margin:16px 0 0;">
      Se o botão não funcionar, copie e cole o link no navegador:<br>
      <span style="word-break:break-all;color:${PRIMARY};">${verifyUrl}</span>
    </p>
    <p style="font-size:12px;line-height:1.5;color:${FG2};margin:24px 0 0;">
      Se você não criou essa conta, pode ignorar este e-mail.
    </p>
  `);
  return { subject, text, html };
}

// ──────────────────────────────────────────────────────────────────────────
// Reset de senha
// ──────────────────────────────────────────────────────────────────────────
function passwordReset({ resetUrl }) {
  const subject = `${BRAND} — redefinir sua senha`;
  const text = [
    `Recebemos uma solicitação pra redefinir sua senha no ${BRAND}.`,
    '',
    'Clique no link abaixo pra definir uma nova senha:',
    '',
    resetUrl,
    '',
    'O link é válido por 1 hora e só funciona uma vez.',
    '',
    'Se você não pediu a redefinição, pode ignorar este e-mail.',
    'Sua senha atual continua válida.',
  ].join('\n');
  const html = layout(subject, `
    <h2 style="font-size:18px;margin:0 0 12px;">Redefinir sua senha</h2>
    <p style="font-size:14px;line-height:1.5;color:${FG2};margin:0 0 20px;">
      Recebemos uma solicitação pra redefinir sua senha no ${BRAND}.
      Clique no botão abaixo pra definir uma nova senha.
      O link é válido por <strong>1 hora</strong> e só funciona uma vez.
    </p>
    <p style="margin:24px 0;">${button(resetUrl, 'Redefinir senha')}</p>
    <p style="font-size:12px;line-height:1.5;color:${FG2};margin:16px 0 0;">
      Se o botão não funcionar, copie e cole o link no navegador:<br>
      <span style="word-break:break-all;color:${PRIMARY};">${resetUrl}</span>
    </p>
    <p style="font-size:12px;line-height:1.5;color:${FG2};margin:24px 0 0;">
      Se você não pediu a redefinição, pode ignorar este e-mail — sua senha atual continua válida.
    </p>
  `);
  return { subject, text, html };
}

module.exports = { emailVerification, passwordReset };
