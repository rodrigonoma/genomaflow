// Mock do SDK do Anthropic ANTES do require — segue padrão de pdf.test.js.
// Cobre 3 casos: classify=medical_image, classify=document, OCR retorna texto.

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

const { classifyImageContent, ocrLabReport } = require('../../src/parsers/image');

describe('classifyImageContent', () => {
  it('returns medical_image when Vision responds with medical_image', async () => {
    mockResponse = { content: [{ type: 'text', text: 'medical_image' }] };
    const r = await classifyImageContent('base64data', 'image/jpeg');
    expect(r).toBe('medical_image');
  });

  it('returns document when Vision responds with document', async () => {
    mockResponse = { content: [{ type: 'text', text: 'document' }] };
    const r = await classifyImageContent('base64data', 'image/jpeg');
    expect(r).toBe('document');
  });

  it('returns unknown when Vision response is ambiguous', async () => {
    mockResponse = { content: [{ type: 'text', text: 'something else' }] };
    const r = await classifyImageContent('base64data', 'image/jpeg');
    expect(r).toBe('unknown');
  });

  it('returns unknown when SDK throws', async () => {
    mockResponse = null;
    // Force a throw by setting messages.create to throw via mockResponse=null
    // (acesso a content[0] vai dar TypeError dentro do try/catch — função retorna 'unknown')
    const r = await classifyImageContent('base64data', 'image/jpeg');
    expect(r).toBe('unknown');
  });
});

describe('ocrLabReport', () => {
  it('returns extracted text trimmed', async () => {
    mockResponse = { content: [{ type: 'text', text: '  Hemograma\nHb: 14.2 g/dL\n  ' }] };
    const text = await ocrLabReport('base64data', 'image/png');
    expect(text).toBe('Hemograma\nHb: 14.2 g/dL');
  });

  it('returns empty string when content missing', async () => {
    mockResponse = { content: [] };
    const text = await ocrLabReport('base64data', 'image/png');
    expect(text).toBe('');
  });
});
