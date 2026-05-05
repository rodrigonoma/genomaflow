'use strict';

/**
 * Validação e normalização de telefone brasileiro.
 *
 * Regra: DDD obrigatório em todos os campos de telefone.
 *
 * Aceita formatos:
 *   - 11 dígitos: DDD + celular com 9 → (11) 99999-9999
 *   - 10 dígitos: DDD + fixo OU celular antigo → (11) 9999-9999
 *   - 12 dígitos: DDI 55 + DDD + fixo → 5511999999999
 *   - 13 dígitos: DDI 55 + DDD + celular → 5511999999999
 *   - Pontuação livre: parênteses, traços, espaços, +
 *
 * Rejeita:
 *   - <10 dígitos (sem DDD)
 *   - DDD inválido (não está na lista oficial)
 *   - Celular (11 dígitos local) sem o "9" obrigatório no terceiro dígito
 *
 * Demanda 2026-05-05: obrigar DDD em todos os locais (subjects.phone,
 * owners.phone, tenants.phone, tenants.whatsapp_phone, etc.) pra evitar
 * cadastro de números curtos/inválidos que quebram WhatsApp e SMS.
 */

// DDDs ativos no Brasil (Anatel)
const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,            // SP
  21, 22, 24,                                     // RJ
  27, 28,                                         // ES
  31, 32, 33, 34, 35, 37, 38,                     // MG
  41, 42, 43, 44, 45, 46,                         // PR
  47, 48, 49,                                     // SC
  51, 53, 54, 55,                                 // RS
  61,                                             // DF
  62, 64,                                         // GO
  63,                                             // TO
  65, 66,                                         // MT
  67,                                             // MS
  68,                                             // AC
  69,                                             // RO
  71, 73, 74, 75, 77,                             // BA
  79,                                             // SE
  81, 87,                                         // PE
  82,                                             // AL
  83,                                             // PB
  84,                                             // RN
  85, 88,                                         // CE
  86, 89,                                         // PI
  91, 93, 94,                                     // PA
  92, 97,                                         // AM
  95,                                             // RR
  96,                                             // AP
  98, 99,                                         // MA
]);

/**
 * @param {string|null|undefined} value
 * @returns {boolean} true se telefone é válido brasileiro com DDD
 */
function validatePhoneBR(value) {
  if (!value || typeof value !== 'string') return false;
  const digits = value.replace(/\D/g, '');

  // Remove DDI 55 se presente (12-13 dígitos)
  let local = digits;
  if (digits.length === 12 || digits.length === 13) {
    if (!digits.startsWith('55')) return false;
    local = digits.slice(2);
  }

  // Local: 10 dígitos (DDD + fixo) ou 11 (DDD + celular com 9)
  if (local.length !== 10 && local.length !== 11) return false;

  const ddd = parseInt(local.slice(0, 2), 10);
  if (!VALID_DDDS.has(ddd)) return false;

  // Celular (11 dígitos local) tem que começar com 9 no terceiro dígito
  if (local.length === 11 && local[2] !== '9') return false;

  // Fixo (10 dígitos local) começa com 2-5 (não 0,1,6,7,8,9)
  if (local.length === 10) {
    const firstDigit = local[2];
    if (!'2345'.includes(firstDigit)) return false;
  }

  return true;
}

/**
 * Normaliza telefone pra E.164 sem o '+' (formato Z-API: 5511999999999).
 * Retorna null se inválido.
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function normalizePhoneBR(value) {
  if (!validatePhoneBR(value)) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 12 || digits.length === 13) return digits;
  return '55' + digits;
}

module.exports = {
  validatePhoneBR,
  normalizePhoneBR,
  VALID_DDDS,
};
