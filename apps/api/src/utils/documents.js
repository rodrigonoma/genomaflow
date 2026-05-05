'use strict';

/**
 * Validação de CPF/CNPJ via dígitos verificadores (algoritmo módulo 11).
 *
 * Demanda 2026-05-05: rejeitar CPFs/CNPJs digitados errado em qualquer
 * cadastro (paciente, tutor, clínica). Antes só validávamos formato/length.
 *
 * Aceita formatado ou só dígitos.
 * Vazio = válido (caller decide se exige).
 */

/**
 * Valida CPF (11 dígitos com 2 dígitos verificadores).
 * Rejeita CPFs com todos dígitos iguais (000... 111... etc — falha de
 * algoritmo conhecida).
 *
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
function validateCPF(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string') return false;
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11) return false;

  // Rejeita sequências (000...000, 111...111, etc.)
  if (/^(\d)\1{10}$/.test(digits)) return false;

  // 1º DV: soma 9 primeiros × peso (10..2)
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i], 10) * (10 - i);
  let rem = (sum * 10) % 11;
  if (rem === 10) rem = 0;
  if (rem !== parseInt(digits[9], 10)) return false;

  // 2º DV: soma 10 primeiros × peso (11..2)
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i], 10) * (11 - i);
  rem = (sum * 10) % 11;
  if (rem === 10) rem = 0;
  if (rem !== parseInt(digits[10], 10)) return false;

  return true;
}

/**
 * Valida CNPJ (14 dígitos com 2 DVs).
 *
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
function validateCNPJ(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string') return false;
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 14) return false;

  // Rejeita sequências
  if (/^(\d)\1{13}$/.test(digits)) return false;

  // 1º DV: pesos [5,4,3,2,9,8,7,6,5,4,3,2] sobre 12 primeiros
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(digits[i], 10) * weights1[i];
  let rem = sum % 11;
  let dv1 = rem < 2 ? 0 : 11 - rem;
  if (dv1 !== parseInt(digits[12], 10)) return false;

  // 2º DV: pesos [6,5,4,3,2,9,8,7,6,5,4,3,2] sobre 13 primeiros
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(digits[i], 10) * weights2[i];
  rem = sum % 11;
  let dv2 = rem < 2 ? 0 : 11 - rem;
  if (dv2 !== parseInt(digits[13], 10)) return false;

  return true;
}

/**
 * Aceita CPF (11 dígitos) OU CNPJ (14 dígitos). Útil em campos como
 * owners.cpf que pode ser pessoa física OU jurídica.
 */
function validateCpfOrCnpj(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string') return false;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) return validateCPF(digits);
  if (digits.length === 14) return validateCNPJ(digits);
  return false;
}

module.exports = {
  validateCPF,
  validateCNPJ,
  validateCpfOrCnpj,
};
