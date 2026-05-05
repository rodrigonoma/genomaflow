/**
 * Helpers de máscara para campos brasileiros (display-only).
 * Todos aplicam sobre o input do usuário e retornam a string formatada.
 * Use unmask() para extrair apenas dígitos antes de enviar ao backend.
 */

export function unmask(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
}

/**
 * CPF: 000.000.000-00 (até 11 dígitos)
 */
export function formatCpf(value: string | null | undefined): string {
  const d = unmask(value).slice(0, 11);
  if (d.length <= 3)  return d;
  if (d.length <= 6)  return `${d.slice(0,3)}.${d.slice(3)}`;
  if (d.length <= 9)  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
}

/**
 * Telefone: (00) 00000-0000 (11 dígitos) ou (00) 0000-0000 (10).
 */
export function formatPhone(value: string | null | undefined): string {
  const d = unmask(value).slice(0, 11);
  if (d.length <= 2)  return d.length ? `(${d}` : '';
  if (d.length <= 6)  return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}

/**
 * CEP: 00000-000 (8 dígitos)
 */
export function formatCep(value: string | null | undefined): string {
  const d = unmask(value).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0,5)}-${d.slice(5)}`;
}

/**
 * Validador BR pra telefone com DDD obrigatório.
 * Aceita 10 (fixo) ou 11 (celular com 9) dígitos com DDD válido.
 * Aceita também com DDI 55 (12-13 dígitos total).
 *
 * Vazio = válido (caller usa required separado se exigir não-vazio).
 *
 * @returns true se válido OU vazio
 */
const VALID_DDDS_BR = new Set([
  11,12,13,14,15,16,17,18,19, 21,22,24, 27,28, 31,32,33,34,35,37,38,
  41,42,43,44,45,46, 47,48,49, 51,53,54,55, 61, 62,64, 63, 65,66, 67,
  68, 69, 71,73,74,75,77, 79, 81,87, 82, 83, 84, 85,88, 86,89,
  91,93,94, 92,97, 95, 96, 98,99,
]);

export function isValidPhoneBR(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return true;
  const digits = unmask(String(value));
  let local = digits;
  if (digits.length === 12 || digits.length === 13) {
    if (!digits.startsWith('55')) return false;
    local = digits.slice(2);
  }
  if (local.length !== 10 && local.length !== 11) return false;
  const ddd = parseInt(local.slice(0, 2), 10);
  if (!VALID_DDDS_BR.has(ddd)) return false;
  if (local.length === 11 && local[2] !== '9') return false;
  if (local.length === 10 && !'2345'.includes(local[2])) return false;
  return true;
}
