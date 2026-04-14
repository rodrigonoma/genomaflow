jest.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      get messages() {
        return {
          create: async () => ({
            content: [{ text: JSON.stringify({
              interpretation: 'LDL elevado com risco cardiovascular aumentado.',
              risk_scores: { cardiovascular: 'HIGH' },
              alerts: [{ marker: 'LDL', value: '195 mg/dL', severity: 'high' }],
              disclaimer: 'Esta análise não substitui avaliação médica.'
            }) }]
          })
        };
      }
    }
  };
});

const { runCardiovascularAgent } = require('../../src/agents/cardiovascular');

const ctx = {
  examText: 'Colesterol Total: 260 mg/dL\nLDL: 195 mg/dL\nHDL: 35 mg/dL',
  patient: { sex: 'M', age_range: '50-59' },
  guidelines: [{ title: 'SBC 2023', content: 'LDL >160 = alto risco', source: 'SBC' }]
};

describe('runCardiovascularAgent', () => {
  it('returns interpretation string', async () => {
    expect(typeof (await runCardiovascularAgent(ctx)).interpretation).toBe('string');
  });

  it('returns cardiovascular risk score', async () => {
    expect((await runCardiovascularAgent(ctx)).risk_scores).toHaveProperty('cardiovascular');
  });

  it('returns alerts array', async () => {
    expect(Array.isArray((await runCardiovascularAgent(ctx)).alerts)).toBe(true);
  });

  it('always sets the mandatory disclaimer', async () => {
    expect((await runCardiovascularAgent(ctx)).disclaimer).toContain('não substitui avaliação médica');
  });
});
