// Mocka @anthropic-ai/sdk + valida parsing/saneamento.
let mockResponse;

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class Anthropic {
    constructor() {}
    get messages() {
      return { create: async () => mockResponse };
    }
  },
}));

const { analyze } = require('../../src/services/encounter-copilot');

const validDraft = {
  module: 'human',
  chief_complaint: 'Dor torácica retroesternal há 2h, irradiando pra braço esquerdo',
  anamnesis: 'Paciente 62 anos, hipertenso, tabagista, refere dor de forte intensidade',
  physical_exam: 'Sudoréico, FC 110, PA 160x95',
  age_years: 62,
  sex: 'M',
};

describe('encounter-copilot.analyze', () => {
  it('rejeita input muito curto', async () => {
    await expect(analyze({ module: 'human', chief_complaint: 'dor' })).rejects.toMatchObject({ code: 'INPUT_TOO_SHORT' });
  });

  it('parseia output completo + sane priorities/urgency', async () => {
    mockResponse = {
      content: [{ type: 'text', text: JSON.stringify({
        hypotheses: [
          { name: 'IAM', icd10: 'I21.9', prob_score: 0.7, rationale: 'Dor tipica + fatores de risco' },
          { name: 'Angina instável', icd10: 'I20.0', prob_score: 0.5, rationale: 'Apresentação compatível' },
        ],
        recommended_exams: [
          { name: 'ECG 12 derivações', type: 'other', priority: 'high', indication: 'Diferenciar IAM' },
          { name: 'Troponina', type: 'lab', priority: 'high', indication: 'Necrose miocárdica' },
        ],
        red_flags: [
          { signal: 'Instabilidade hemodinâmica', urgency: 'imediata', recommendation: 'Encaminhar emergência' },
        ],
        needs_more_info: ['Tempo exato de início', 'Uso prévio de AAS'],
      }) }],
    };

    const out = await analyze(validDraft);
    expect(out.hypotheses).toHaveLength(2);
    expect(out.hypotheses[0].name).toBe('IAM');
    expect(out.hypotheses[0].prob_score).toBeCloseTo(0.7);
    expect(out.recommended_exams[0].priority).toBe('high');
    expect(out.red_flags[0].urgency).toBe('imediata');
    expect(out.needs_more_info).toHaveLength(2);
    expect(out.model_version).toBeDefined();
  });

  it('clampa prob_score fora de range', async () => {
    mockResponse = {
      content: [{ type: 'text', text: JSON.stringify({
        hypotheses: [
          { name: 'X', icd10: null, prob_score: 1.7, rationale: 'overshoot' },
          { name: 'Y', icd10: null, prob_score: -0.5, rationale: 'undershoot' },
        ],
      }) }],
    };
    const out = await analyze(validDraft);
    expect(out.hypotheses[0].prob_score).toBe(1);
    expect(out.hypotheses[1].prob_score).toBe(0);
  });

  it('fallback "esta_semana" pra urgency inválida', async () => {
    mockResponse = {
      content: [{ type: 'text', text: JSON.stringify({
        red_flags: [{ signal: 'X', urgency: 'urgentíssimo', recommendation: 'Y' }],
      }) }],
    };
    const out = await analyze(validDraft);
    expect(out.red_flags[0].urgency).toBe('esta_semana');
  });

  it('lança BAD_LLM_OUTPUT em texto não-JSON', async () => {
    mockResponse = { content: [{ type: 'text', text: 'apenas texto livre sem JSON' }] };
    await expect(analyze(validDraft)).rejects.toMatchObject({ code: 'BAD_LLM_OUTPUT' });
  });

  it('arrays vazios saem coerentes (não null)', async () => {
    mockResponse = { content: [{ type: 'text', text: '{}' }] };
    const out = await analyze(validDraft);
    expect(out.hypotheses).toEqual([]);
    expect(out.recommended_exams).toEqual([]);
    expect(out.red_flags).toEqual([]);
    expect(out.needs_more_info).toEqual([]);
  });
});
