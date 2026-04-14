const { anonymize } = require('../../src/anonymizer/patient');

describe('anonymize', () => {
  const patient = { name: 'Maria da Silva', cpf_hash: 'abc123', birth_date: '1975-03-20', sex: 'F' };

  it('removes name and cpf_hash', () => {
    const result = anonymize(patient);
    expect(result.name).toBeUndefined();
    expect(result.cpf_hash).toBeUndefined();
  });

  it('replaces birth_date with age_range', () => {
    const result = anonymize(patient);
    expect(result.birth_date).toBeUndefined();
    expect(result.age_range).toMatch(/^\d{2}-\d{2}$/);
  });

  it('preserves sex', () => {
    expect(anonymize(patient).sex).toBe('F');
  });

  it('returns decade-based age_range', () => {
    // born 1975 → ~50 years old in 2026 → age_range = '50-59'
    expect(anonymize(patient).age_range).toBe('50-59');
  });
});
