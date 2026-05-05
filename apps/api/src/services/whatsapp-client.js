'use strict';

/**
 * Z-API WhatsApp client.
 *
 * Z-API (https://developer.z-api.io/) é um intermediário (não-Meta direto):
 * - Mais barato (~R$60/mês/conta sem aprovação Meta)
 * - Sem template oficial obrigatório (mensagens free-form)
 * - Latência ~2-3s, OK pra lembretes não-críticos
 *
 * Variáveis env obrigatórias:
 *   ZAPI_INSTANCE_ID     identificador da conta
 *   ZAPI_TOKEN           token específico da instância
 *   ZAPI_CLIENT_TOKEN    Client-Token header (segurança da Z-API)
 *
 * Mock em dev: ZAPI_MOCK=1 → loga em vez de enviar.
 *
 * Decisão arquitetural: NÃO usar Meta Cloud API direto na Fase 3.
 * Razões: (1) requer aprovação Meta + business verification, (2) templates
 * pré-aprovados obrigatórios pra mensagens proativas, (3) rate limits estritos.
 * Z-API absorve toda essa complexidade. Quando volume >5k msg/mês, vale
 * migrar pra Meta direto pra reduzir custo unitário.
 */

const BASE_URL = 'https://api.z-api.io/instances';

function isMock() {
  return process.env.ZAPI_MOCK === '1' || process.env.ZAPI_MOCK === 'true';
}

function getConfig() {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const token = process.env.ZAPI_TOKEN;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN;
  if (!instanceId || !token || !clientToken) {
    if (isMock()) return null;
    throw new Error('ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN obrigatórios');
  }
  return { instanceId, token, clientToken };
}

/**
 * Normaliza phone para E.164 sem prefixo + (Z-API aceita 5511999999999).
 * Aceita: "+55 (11) 99999-9999", "(11) 99999-9999", "5511999999999".
 * Default Brasil (55) se 10/11 dígitos sem código de país.
 */
function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length === 11 || digits.length === 10) return '55' + digits;
  if (digits.length === 13 && digits.startsWith('55')) return digits;
  if (digits.length === 12 && digits.startsWith('55')) return digits;
  // Outros formatos passam direto (provider valida)
  return digits;
}

/**
 * Envia mensagem de texto. Retorna { messageId, status }.
 * Em mock, loga e retorna messageId fake.
 */
async function sendText({ phone, body, log }) {
  const phoneE164 = normalizePhone(phone);
  if (!phoneE164) throw new Error('phone inválido');

  if (isMock()) {
    if (log) log.info({ phone: phoneE164, body: body.slice(0, 100) }, 'ZAPI_MOCK: sendText');
    return { messageId: `mock-${Date.now()}`, status: 'sent' };
  }

  const cfg = getConfig();
  const url = `${BASE_URL}/${cfg.instanceId}/token/${cfg.token}/send-text`;

  // Node 20 tem fetch nativo
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': cfg.clientToken,
    },
    body: JSON.stringify({ phone: phoneE164, message: body }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    const e = new Error(`Z-API ${res.status}: ${errBody.slice(0, 200)}`);
    e.statusCode = res.status;
    throw e;
  }

  const data = await res.json();
  return {
    messageId: data.messageId || data.id || data.zaapId || null,
    status: 'sent',
    raw: data,
  };
}

/**
 * Verifica se webhook signature da Z-API é válida.
 * Z-API envia header `X-Token` com o ZAPI_CLIENT_TOKEN configurado na conta.
 * Se mock ou env não setado, aceita tudo (dev).
 */
function verifyWebhook(headers) {
  if (isMock()) return true;
  const expected = process.env.ZAPI_CLIENT_TOKEN;
  if (!expected) return true;  // sem token = sem validação (não recomendado prod)
  const received = headers['x-token'] || headers['X-Token'];
  return received === expected;
}

module.exports = {
  sendText,
  verifyWebhook,
  normalizePhone,
  isMock,
};
