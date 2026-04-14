jest.mock('pg', () => {
  const mockClient = {
    query: jest.fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // SET LOCAL app.tenant_id
      .mockResolvedValueOnce({}) // UPDATE status = processing
      .mockResolvedValue({ rows: [{ name: 'Maria', birth_date: '1975-03-20', sex: 'F' }] }),
    release: jest.fn()
  };
  return {
    Pool: jest.fn(() => ({
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn().mockResolvedValue({})
    }))
  };
});

jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue(Buffer.from('%PDF'))
}));

jest.mock('../../src/parsers/pdf', () => ({
  extractText: jest.fn().mockResolvedValue('Glicemia: 126 mg/dL')
}));

jest.mock('../../src/classifier/markers', () => ({
  classifyAgents: jest.fn().mockReturnValue(['metabolic'])
}));

jest.mock('../../src/rag/retriever', () => ({
  retrieveGuidelines: jest.fn().mockResolvedValue([{ title: 'ADA', content: '...', source: 'ADA' }])
}));

jest.mock('../../src/agents/metabolic', () => ({
  runMetabolicAgent: jest.fn().mockResolvedValue({
    interpretation: 'Glicemia elevada.',
    risk_scores: { metabolic: 'HIGH' },
    alerts: [],
    disclaimer: 'Esta análise não substitui avaliação médica.'
  })
}));

jest.mock('ioredis', () => jest.fn(() => ({
  publish: jest.fn().mockResolvedValue(1),
  quit: jest.fn().mockResolvedValue('OK')
})));

const { processExam } = require('../../src/processors/exam');

describe('processExam', () => {
  it('completes without throwing for a valid job', async () => {
    await expect(processExam({
      exam_id: 'exam-uuid',
      tenant_id: 'tenant-uuid',
      file_path: '/tmp/test.pdf'
    })).resolves.not.toThrow();
  });
});
