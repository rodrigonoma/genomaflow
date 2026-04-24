const { anonymizeAiAnalysis, ageRange, roundWeight } = require('../../../src/routes/inter-tenant-chat/anonymize');

describe('ageRange', () => {
  it('retorna null para birth_date nulo', () => {
    expect(ageRange(null)).toBeNull();
  });

  it('retorna bucket de 10 anos', () => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 25);
    expect(ageRange(d.toISOString())).toBe('20-30');
  });

  it('retorna 70+ para idade >= 70', () => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 75);
    expect(ageRange(d.toISOString())).toBe('70+');
  });

  it('retorna 0-10 para bebê', () => {
    const d = new Date(); d.setMonth(d.getMonth() - 6);
    expect(ageRange(d.toISOString())).toBe('0-10');
  });
});

describe('roundWeight', () => {
  it('arredonda peso', () => { expect(roundWeight(5.73)).toBe(6); });
  it('arredonda pra baixo quando < 0.5', () => { expect(roundWeight(27.3)).toBe(27); });
  it('retorna null para null/string', () => {
    expect(roundWeight(null)).toBeNull();
    expect(roundWeight('abc')).toBeNull();
    expect(roundWeight(undefined)).toBeNull();
  });
});

describe('anonymizeAiAnalysis', () => {
  it('remove nome/cpf/phone do subject human', () => {
    const exam = { id: 'e1', tenant_id: 't1', created_at: '2026-01-01T00:00:00Z' };
    const birthDate = new Date(); birthDate.setFullYear(birthDate.getFullYear() - 35);
    const subject = {
      id: 's1', name: 'João Silva', cpf_hash: 'xxx', phone: '11999',
      subject_type: 'human', birth_date: birthDate.toISOString(), sex: 'M'
    };
    const results = [
      { agent_type: 'cardiovascular', interpretation: 'ECG normal',
        risk_scores: { total: '3/10' }, alerts: [], recommendations: [] }
    ];

    const out = anonymizeAiAnalysis({ exam, subject, results });
    expect(out.subject.subject_type).toBe('human');
    expect(out.subject.age_range).toBe('30-40');
    expect(out.subject.sex).toBe('M');
    expect(out.subject).not.toHaveProperty('name');
    expect(out.subject).not.toHaveProperty('cpf_hash');
    expect(out.subject).not.toHaveProperty('phone');
    expect(out.subject).not.toHaveProperty('birth_date');
    expect(out.subject).not.toHaveProperty('id');
    expect(out.results[0].agent_type).toBe('cardiovascular');
    expect(out.results[0].interpretation).toBe('ECG normal');
    expect(out.exam_source_tenant_id).toBe('t1');
  });

  it('mantém species/breed/weight_kg no animal vet e remove microchip/owner', () => {
    const exam = { id: 'e1', tenant_id: 't1', created_at: '2026-01-01' };
    const subject = {
      id: 's1', name: 'Rex', subject_type: 'animal', sex: 'M',
      species: 'dog', breed: 'labrador', weight: 27.3,
      microchip: 'XYZ123', birth_date: null, owner_cpf_hash: 'yyy'
    };
    const out = anonymizeAiAnalysis({ exam, subject, results: [] });
    expect(out.subject.species).toBe('dog');
    expect(out.subject.breed).toBe('labrador');
    expect(out.subject.weight_kg).toBe(27);
    expect(out.subject.age_range).toBeNull();
    expect(out.subject).not.toHaveProperty('microchip');
    expect(out.subject).not.toHaveProperty('owner_cpf_hash');
    expect(out.subject).not.toHaveProperty('name');
  });

  it('results vazios retornam array vazio', () => {
    const out = anonymizeAiAnalysis({
      exam: { id: 'e', tenant_id: 't', created_at: '2026-01-01' },
      subject: { subject_type: 'human', sex: 'F', birth_date: null },
      results: []
    });
    expect(out.results).toEqual([]);
  });

  it('preserva risk_scores, alerts, recommendations por agente', () => {
    const exam = { id: 'e1', tenant_id: 't1', created_at: '2026-01-01' };
    const subject = { subject_type: 'human', sex: 'F', birth_date: null };
    const results = [{
      agent_type: 'hematology',
      interpretation: 'hemograma',
      risk_scores: { anemia: '7/10' },
      alerts: [{ marker: 'hemoglobina', value: '9.0', severity: 'high' }],
      recommendations: [{ type: 'medication', description: 'suplementação', priority: 'high' }]
    }];
    const out = anonymizeAiAnalysis({ exam, subject, results });
    expect(out.results[0].risk_scores.anemia).toBe('7/10');
    expect(out.results[0].alerts[0].severity).toBe('high');
    expect(out.results[0].recommendations[0].type).toBe('medication');
  });
});
