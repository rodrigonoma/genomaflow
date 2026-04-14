'use strict';

const { scrubText } = require('../../src/anonymizer/text');

describe('scrubText', () => {
  it('removes lines with PII labels', () => {
    const input = [
      'Paciente: João Silva',
      'Nome: Maria Souza',
      'CPF: 123.456.789-00',
      'Data de Nascimento: 15/03/1980',
      'Hemoglobina: 14.5 g/dL',
      'Glicose: 95 mg/dL'
    ].join('\n');

    const result = scrubText(input);

    expect(result).not.toContain('João Silva');
    expect(result).not.toContain('Maria Souza');
    expect(result).toContain('Hemoglobina: 14.5 g/dL');
    expect(result).toContain('Glicose: 95 mg/dL');
  });

  it('redacts CPF patterns in non-labeled lines', () => {
    const input = 'Resultado para 123.456.789-00: dentro do esperado';
    const result = scrubText(input);
    expect(result).not.toContain('123.456.789-00');
    expect(result).toContain('[CPF REMOVIDO]');
  });

  it('redacts date patterns (DD/MM/YYYY)', () => {
    const input = 'Coleta em 15/03/2024';
    const result = scrubText(input);
    expect(result).not.toContain('15/03/2024');
    expect(result).toContain('[DATA REMOVIDA]');
  });

  it('preserves lines with clinical markers', () => {
    const input = [
      'Leucócitos: 7.500/mm³',
      'Plaquetas: 220.000/mm³',
      'LDL: 130 mg/dL'
    ].join('\n');

    const result = scrubText(input);
    expect(result).toContain('Leucócitos: 7.500/mm³');
    expect(result).toContain('Plaquetas: 220.000/mm³');
    expect(result).toContain('LDL: 130 mg/dL');
  });

  it('handles empty text without throwing', () => {
    expect(() => scrubText('')).not.toThrow();
    expect(scrubText('')).toBe('');
  });
});
