const { retrieveGuidelines } = require('../../src/rag/retriever');

jest.mock('../../src/rag/embedder', () => ({ embed: async () => Array(1536).fill(0) }));

describe('retrieveGuidelines', () => {
  it('accepts module and species params without error', async () => {
    let capturedQuery = null;
    const mockClient = {
      query: async (sql, params) => {
        capturedQuery = { sql, params };
        return { rows: [] };
      }
    };

    await retrieveGuidelines(mockClient, 'glicose alta', 5, 'human', null);
    expect(capturedQuery.sql).toContain('module IN');
  });

  it('passes correct params for veterinary with species', async () => {
    let capturedParams = null;
    const mockClient = {
      query: async (sql, params) => {
        capturedParams = params;
        return { rows: [] };
      }
    };

    await retrieveGuidelines(mockClient, 'test', 5, 'veterinary', 'dog');
    expect(capturedParams[0]).toBe('veterinary');
    expect(capturedParams[1]).toBe('dog');
  });
});
