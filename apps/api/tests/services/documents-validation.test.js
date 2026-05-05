/**
 * Testes do validador de CPF e CNPJ via dígitos verificadores.
 */

const { validateCPF, validateCNPJ, validateCpfOrCnpj } = require('../../src/utils/documents');

// CPFs válidos conhecidos (gerados via algoritmo)
const VALID_CPFS = [
  '11144477735',     // exemplo clássico válido
  '529.982.247-25',  // formatado
  '52998224725',
  '111.444.777-35',
  '529-982-247-25',  // separador exótico mas dígitos válidos
];

const INVALID_CPFS = [
  '12345678900',     // dígitos quaisquer
  '11111111111',     // todos iguais
  '00000000000',     // todos zero
  '99999999999',
  '529.982.247-26',  // último DV errado
  '529.982.247-15',  // 2 dígitos diferentes
  '123456789',       // 9 dígitos
  '123456789012',    // 12 dígitos
  'abcdefghijk',     // não-dígitos
];

const VALID_CNPJS = [
  '11.222.333/0001-81',  // formatado
  '11222333000181',
  '00000000000191',      // CNPJ válido conhecido (ex: Receita)
  '64.052.716/0001-15',  // CNPJ real GenomaFlow (CLAUDE.md menciona)
];

const INVALID_CNPJS = [
  '11.222.333/0001-82',  // último DV errado
  '00000000000000',      // todos zero
  '11111111111111',
  '12345678901234',      // dígitos quaisquer
  '64.052.716/0001-16',  // GenomaFlow com DV errado
];

describe('validateCPF', () => {
  test.each(VALID_CPFS)('%s → válido', (cpf) => {
    expect(validateCPF(cpf)).toBe(true);
  });

  test.each(INVALID_CPFS)('%s → rejeitado', (cpf) => {
    expect(validateCPF(cpf)).toBe(false);
  });

  test('vazio → válido (campo opcional)', () => {
    expect(validateCPF('')).toBe(true);
    expect(validateCPF(null)).toBe(true);
    expect(validateCPF(undefined)).toBe(true);
  });

  test('número em vez de string → rejeita', () => {
    expect(validateCPF(11144477735)).toBe(false);
  });
});

describe('validateCNPJ', () => {
  test.each(VALID_CNPJS)('%s → válido', (cnpj) => {
    expect(validateCNPJ(cnpj)).toBe(true);
  });

  test.each(INVALID_CNPJS)('%s → rejeitado', (cnpj) => {
    expect(validateCNPJ(cnpj)).toBe(false);
  });

  test('vazio → válido (campo opcional)', () => {
    expect(validateCNPJ('')).toBe(true);
    expect(validateCNPJ(null)).toBe(true);
  });

  test('CPF (11 dígitos) → rejeita como CNPJ', () => {
    expect(validateCNPJ('11144477735')).toBe(false);
  });
});

describe('validateCpfOrCnpj', () => {
  test('CPF válido → aceita', () => {
    expect(validateCpfOrCnpj('11144477735')).toBe(true);
  });
  test('CNPJ válido → aceita', () => {
    expect(validateCpfOrCnpj('11222333000181')).toBe(true);
  });
  test('CPF inválido → rejeita', () => {
    expect(validateCpfOrCnpj('12345678900')).toBe(false);
  });
  test('CNPJ inválido → rejeita', () => {
    expect(validateCpfOrCnpj('11.222.333/0001-82')).toBe(false);
  });
  test('vazio → válido', () => {
    expect(validateCpfOrCnpj('')).toBe(true);
  });
  test('comprimento errado (10 dígitos) → rejeita', () => {
    expect(validateCpfOrCnpj('1234567890')).toBe(false);
  });
  test('comprimento errado (12 dígitos) → rejeita', () => {
    expect(validateCpfOrCnpj('123456789012')).toBe(false);
  });
});
