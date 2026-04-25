// Mocka pdf-parse e o SDK do Anthropic ANTES de require do módulo sob teste.
// Mock do SDK garante que `extractTextViaOcr` seja exercitado sem chave real.
jest.mock('pdf-parse', () => async (buf) => {
  if (buf.length === 0) return { text: '' };
  // ≥ 100 chars (MIN_TEXT_LENGTH) — abaixo disso o módulo cai pra OCR
  return { text:
    'Glicemia em jejum: 126 mg/dL (referência 70-99 mg/dL)\n' +
    'TSH: 5.2 mUI/L (referência 0.4-4.0 mUI/L)\n' +
    'HbA1c: 6.8% (referência <5.7%)\n' +
    'Colesterol total: 220 mg/dL (referência <200 mg/dL)' };
});

jest.mock('@anthropic-ai/sdk', () => {
  // pdf.js usa `require('@anthropic-ai/sdk')` direto (não `.default`), então
  // exportamos uma classe compatível com `new Anthropic({apiKey})`.
  return class Anthropic {
    constructor() {}
    get messages() {
      return {
        create: async () => ({
          content: [{ type: 'text', text: 'OCR fallback text' }]
        })
      };
    }
  };
});

const { extractText } = require('../../src/parsers/pdf');

describe('extractText', () => {
  it('returns text + usedOcr=false when pdf-parse extracts ≥ MIN_TEXT_LENGTH chars', async () => {
    const result = await extractText(Buffer.from('%PDF-1.4 sample'));
    expect(result.text).toContain('Glicemia');
    expect(result.usedOcr).toBe(false);
  });

  it('falls back to OCR when pdf-parse returns empty/short text (e.g. scanned PDF)', async () => {
    const result = await extractText(Buffer.alloc(0));
    expect(result.text).toBe('OCR fallback text');
    expect(result.usedOcr).toBe(true);
  });
});
