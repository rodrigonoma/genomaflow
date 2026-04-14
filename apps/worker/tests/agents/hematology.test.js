jest.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      get messages() {
        return {
          create: async () => ({
            content: [{ text: JSON.stringify({
              interpretation: 'Anemia microcítica sugestiva de deficiência de ferro.',
              risk_scores: { hematology: 'MEDIUM' },
              alerts: [{ marker: 'Hemoglobina', value: '10.5 g/dL', severity: 'medium' }],
              disclaimer: 'Esta análise não substitui avaliação médica.'
            }) }]
          })
        };
      }
    }
  };
});

const { runHematologyAgent } = require('../../src/agents/hematology');

const ctx = {
  examText: 'Hemoglobina: 10.5 g/dL\nHematócrito: 31%\nLeucócitos: 7500/mm³',
  patient: { sex: 'F', age_range: '30-39' },
  guidelines: [{ title: 'OMS Anemia', content: 'Hb <12 g/dL em mulheres = anemia', source: 'WHO' }]
};

describe('runHematologyAgent', () => {
  it('returns interpretation string', async () => {
    expect(typeof (await runHematologyAgent(ctx)).interpretation).toBe('string');
  });

  it('returns hematology risk score', async () => {
    expect((await runHematologyAgent(ctx)).risk_scores).toHaveProperty('hematology');
  });

  it('returns alerts array', async () => {
    expect(Array.isArray((await runHematologyAgent(ctx)).alerts)).toBe(true);
  });

  it('always sets the mandatory disclaimer', async () => {
    expect((await runHematologyAgent(ctx)).disclaimer).toContain('não substitui avaliação médica');
  });
});
