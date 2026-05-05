'use strict';

/**
 * Templates de mensagens WhatsApp/email.
 * Placeholders: {{nome}}, {{data}}, {{hora}}, {{tenant_name}}.
 * Renderização simples por replace — sem libs externas (compatível com BullMQ worker).
 */

function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

const TEMPLATES = {
  appointment_reminder_24h:
    'Olá {{nome}}! Lembramos que você tem consulta amanhã às {{hora}} em {{tenant_name}}. ' +
    'Responda 1 pra confirmar ou 2 pra cancelar.',

  appointment_reminder_2h:
    'Olá {{nome}}! Sua consulta em {{tenant_name}} é hoje às {{hora}}. Te aguardamos!',

  appointment_confirmed:
    'Confirmado! Sua consulta em {{tenant_name}} está confirmada para {{data}} às {{hora}}.',

  appointment_cancelled_by_patient:
    'Consulta de {{data}} {{hora}} cancelada conforme sua solicitação. Para reagendar, entre em contato.',

  vaccine_reminder:
    'Olá {{nome}}! Está na hora da próxima dose da vacina {{vacina}} de {{paciente}}. ' +
    'Agende: {{tenant_name}}.',

  nps_request:
    'Olá! Sua opinião sobre o atendimento de {{paciente}} em {{tenant_name}} é importante. ' +
    'Em uma escala de 0 a 10, o quanto recomendaria? Acesse: {{link}}',

  portal_invite:
    'Olá {{nome}}! Acesse o portal de {{tenant_name}} para ver sua agenda, exames e prescrições: {{link}}',
};

function build(templateKey, vars) {
  const tpl = TEMPLATES[templateKey];
  if (!tpl) throw new Error(`template ${templateKey} não encontrado`);
  return render(tpl, vars);
}

module.exports = { render, build, TEMPLATES };
