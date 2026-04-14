jest.mock('pdf-parse', () => async (buf) => {
  if (buf.length === 0) return { text: '' };
  return { text: 'Glicemia: 126 mg/dL\nTSH: 5.2 mUI/L' };
});

const { extractText } = require('../../src/parsers/pdf');

describe('extractText', () => {
  it('returns text from a non-empty PDF buffer', async () => {
    const text = await extractText(Buffer.from('%PDF-1.4'));
    expect(typeof text).toBe('string');
    expect(text).toContain('Glicemia');
  });

  it('throws for an empty buffer', async () => {
    await expect(extractText(Buffer.alloc(0))).rejects.toThrow('Empty PDF content');
  });
});
