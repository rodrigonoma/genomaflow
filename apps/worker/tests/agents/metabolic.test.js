jest.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      get messages() {
        return {
          create: async () => ({
            content: [{ text: JSON.stringify({
              interpretation: 'Glicemia elevada sugere resistência à insulina.',
              risk_scores: { metabolic: 'HIGH' },
              alerts: [{ marker: 'Glicemia', value: '126 mg/dL', severity: 'medium' }],
              disclaimer: 'Esta análise não substitui avaliação médica.'
            }) }]
          })
        };
      }
    }
  };
});

const { runMetabolicAgent } = require('../../src/agents/metabolic');

const ctx = {
  examText: 'Glicemia: 126 mg/dL\nTSH: 5.2 mUI/L',
  patient: { sex: 'M', age_range: '40-49' },
  guidelines: [{ title: 'ADA 2024', content: 'Fasting glucose ≥126 = diabetes', source: 'ADA' }]
};

describe('runMetabolicAgent', () => {
  it('returns interpretation string', async () => {
    const result = await runMetabolicAgent(ctx);
    expect(typeof result.interpretation).toBe('string');
    expect(result.interpretation.length).toBeGreaterThan(0);
  });

  it('returns risk_scores object', async () => {
    const result = await runMetabolicAgent(ctx);
    expect(typeof result.risk_scores).toBe('object');
  });

  it('returns alerts array', async () => {
    const result = await runMetabolicAgent(ctx);
    expect(Array.isArray(result.alerts)).toBe(true);
  });

  it('always sets the mandatory disclaimer', async () => {
    const result = await runMetabolicAgent(ctx);
    expect(result.disclaimer).toContain('não substitui avaliação médica');
  });
});
