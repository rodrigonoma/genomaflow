/**
 * Testes do validador de telefone BR (DDD obrigatório).
 */

const { validatePhoneBR, normalizePhoneBR } = require('../../src/utils/phone');

describe('validatePhoneBR — aceita', () => {
  test.each([
    ['11999999999', 'celular SP sem formatação'],
    ['(11) 99999-9999', 'celular SP formatado'],
    ['+55 (11) 99999-9999', 'celular com DDI'],
    ['5511999999999', 'E.164 sem +'],
    ['+5511999999999', 'E.164 com +'],
    ['1133334444', 'fixo SP 10 dígitos'],
    ['(11) 3333-4444', 'fixo formatado'],
    ['21987654321', 'celular RJ'],
    ['85988887777', 'celular CE'],
    ['41999998888', 'celular PR'],
  ])('%s → válido (%s)', (input) => {
    expect(validatePhoneBR(input)).toBe(true);
  });
});

describe('validatePhoneBR — rejeita', () => {
  test.each([
    ['', 'vazio'],
    [null, 'null'],
    [undefined, 'undefined'],
    ['123', 'muito curto'],
    ['999999999', '9 dígitos sem DDD'],
    ['39999999999', '11 dígitos mas DDD 39 inválido (não existe)'],
    ['20999999999', '11 dígitos mas DDD 20 inválido (não existe)'],
    ['10999999999', 'DDD 10 inválido'],
    ['00999999999', 'DDD 00 inválido'],
    ['1199999999', 'celular SP 10 dígitos sem 9 (deveria ser 11)'],
    ['11899999999', 'celular SP com 8 em vez de 9 no terceiro dígito'],
    ['1109999999', 'fixo começando com 0'],
    ['1119999999', 'fixo começando com 1'],
    ['44999999999999', 'muitos dígitos'],
    ['abc', 'string sem dígitos'],
    [11999999999, 'number em vez de string'],
  ])('%s → rejeitado (%s)', (input) => {
    expect(validatePhoneBR(input)).toBe(false);
  });

  test('DDI errado (não 55) → rejeita', () => {
    expect(validatePhoneBR('+1 555 555 5555')).toBe(false);
    expect(validatePhoneBR('1234567890123')).toBe(false);  // 13 dígitos mas começa 12
  });
});

describe('normalizePhoneBR', () => {
  test('celular 11 dígitos → 5511999999999', () => {
    expect(normalizePhoneBR('11999999999')).toBe('5511999999999');
  });
  test('celular formatado → mesma normalização', () => {
    expect(normalizePhoneBR('(11) 99999-9999')).toBe('5511999999999');
    expect(normalizePhoneBR('+55 (11) 99999-9999')).toBe('5511999999999');
  });
  test('fixo 10 dígitos → 551133334444', () => {
    expect(normalizePhoneBR('1133334444')).toBe('551133334444');
  });
  test('inválido → null', () => {
    expect(normalizePhoneBR('999')).toBe(null);
    expect(normalizePhoneBR('')).toBe(null);
    expect(normalizePhoneBR(null)).toBe(null);
  });
  test('já em E.164 → retorna como está (digits)', () => {
    expect(normalizePhoneBR('5511999999999')).toBe('5511999999999');
    expect(normalizePhoneBR('+5511999999999')).toBe('5511999999999');
  });
});
