const { classifyAgents } = require('../../src/classifier/markers');

describe('classifyAgents', () => {
  it('detects metabolic markers', () => {
    expect(classifyAgents('Glicemia: 126 mg/dL\nTSH: 5.2')).toContain('metabolic');
  });

  it('detects cardiovascular markers', () => {
    expect(classifyAgents('Colesterol Total: 240\nLDL: 180\nHDL: 38')).toContain('cardiovascular');
  });

  it('detects hematology markers', () => {
    expect(classifyAgents('Hemoglobina: 11.2 g/dL\nLeucócitos: 9800')).toContain('hematology');
  });

  it('returns multiple agents for mixed exam', () => {
    const agents = classifyAgents('Glicemia: 126\nColesterol: 230\nHemoglobina: 12');
    expect(agents.length).toBeGreaterThan(1);
  });

  it('returns empty array for unrecognized text', () => {
    expect(classifyAgents('texto sem marcadores reconhecidos')).toEqual([]);
  });
});
