// Testes do service de IA pró-ativa.
// Mocka @anthropic-ai/sdk + valida parsing/saneamento do output do LLM
// e shape do contexto montado.

let mockResponse;

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class Anthropic {
    constructor() {}
    get messages() {
      return {
        create: async () => mockResponse,
      };
    }
  },
}));

const { generateSuggestions, buildSubjectContext } = require('../../src/services/ai-suggestions');

function mockPg(sequence) {
  let i = 0;
  return {
    query: async () => {
      const r = sequence[i] || { rows: [] };
      i++;
      return r;
    },
  };
}

describe('generateSuggestions', () => {
  it('parseia JSON válido e atribui ids + sane priority', async () => {
    mockResponse = {
      content: [{ type: 'text', text: JSON.stringify({
        suggestions: [
          { title: 'Solicitar HbA1c', rationale: 'Diabético há 6m sem coleta recente', suggested_action: 'Pedir HbA1c', priority: 'high', source_guideline: 'ADA 2023' },
          { title: 'Lipidograma', rationale: 'Sem perfil lipídico há 12m', priority: 'medium' },
        ]
      }) }],
      usage: { input_tokens: 100, output_tokens: 200 },
    };
    const out = await generateSuggestions({ subject: {}, recent_exams: [], recent_prescriptions: [], recent_encounters: [] }, 'human');
    expect(out.suggestions).toHaveLength(2);
    expect(out.suggestions[0].id).toMatch(/[0-9a-f-]{36}/);
    expect(out.suggestions[0].priority).toBe('high');
    expect(out.suggestions[1].priority).toBe('medium');
    expect(out.suggestions[1].source_guideline).toBe(null);
  });

  it('extrai JSON quando o LLM retorna prefixo/texto extra', async () => {
    mockResponse = {
      content: [{ type: 'text', text: 'Aqui está minha análise:\n\n```json\n' + JSON.stringify({ suggestions: [] }) + '\n```' }],
    };
    const out = await generateSuggestions({}, 'human');
    expect(out.suggestions).toEqual([]);
  });

  it('descarta entries sem title ou rationale', async () => {
    mockResponse = {
      content: [{ type: 'text', text: JSON.stringify({
        suggestions: [
          { title: 'Ok', rationale: 'tem' },
          { title: 'Sem rationale' },
          { rationale: 'sem title' },
        ]
      }) }],
    };
    const out = await generateSuggestions({}, 'human');
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].title).toBe('Ok');
  });

  it('força priority válida (default medium)', async () => {
    mockResponse = {
      content: [{ type: 'text', text: JSON.stringify({
        suggestions: [
          { title: 'X', rationale: 'Y', priority: 'urgent' },
          { title: 'X', rationale: 'Y' },
        ]
      }) }],
    };
    const out = await generateSuggestions({}, 'human');
    expect(out.suggestions[0].priority).toBe('medium');
    expect(out.suggestions[1].priority).toBe('medium');
  });

  it('lança BAD_LLM_OUTPUT em JSON inválido', async () => {
    mockResponse = { content: [{ type: 'text', text: 'this is not json at all' }] };
    await expect(generateSuggestions({}, 'human')).rejects.toMatchObject({ code: 'BAD_LLM_OUTPUT' });
  });

  it('lança BAD_LLM_OUTPUT quando suggestions não é array', async () => {
    mockResponse = { content: [{ type: 'text', text: '{"foo":"bar"}' }] };
    await expect(generateSuggestions({}, 'human')).rejects.toMatchObject({ code: 'BAD_LLM_OUTPUT' });
  });
});

describe('buildSubjectContext', () => {
  it('lança NOT_FOUND quando subject não existe', async () => {
    const pg = mockPg([{ rows: [] }]);
    await expect(buildSubjectContext(pg, 'sub-id', 'tenant-id')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('monta contexto com agregação correta', async () => {
    const pg = mockPg([
      { rows: [{
        id: 'sub', name: 'Anderson', subject_type: 'human', sex: 'M',
        birth_date: '1980-01-01', species: null, breed: null,
        weight: 80, height: 180, allergies: 'penicilina',
        comorbidities: 'diabetes', medications: 'metformina',
      }] },
      { rows: [
        { id: 'ex1', created_at: new Date(), file_type: 'pdf', agent_types: ['metabolic'], all_alerts: [[{ severity: 'high', marker: 'glicemia', description: 'alta' }]] },
      ] },
      { rows: [{ agent_type: 'therapeutic', items: [{}, {}], notes: 'ok', created_at: new Date() }] },
      { rows: [] },
    ]);
    const ctx = await buildSubjectContext(pg, 'sub-id', 'tenant-id');
    expect(ctx.subject.comorbidities).toBe('diabetes');
    expect(ctx.subject.age_years).toBeGreaterThan(40);
    expect(ctx.recent_exams).toHaveLength(1);
    expect(ctx.recent_exams[0].alerts[0].severity).toBe('high');
    expect(ctx.recent_prescriptions[0].item_count).toBe(2);
  });
});
