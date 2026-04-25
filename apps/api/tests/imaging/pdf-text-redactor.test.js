'use strict';
/**
 * Unit tests for the V2 PDF redactor (text-layer strategy).
 *
 * Cobre:
 *   - Cada PII_PATTERN matching nos kinds esperados
 *   - classifyByRegexInItems mapeia items que se sobrepõem ao match (não só o item exato)
 *   - Heurística MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER para detecção de PDF escaneado
 *   - Pipeline ponta-a-ponta com PDF gerado pelo pd-lib (digital → redige; vazio → has_text_layer:false)
 *
 * Mocka @anthropic-ai/sdk pra evitar chamadas reais de rede e isolar a parte
 * regex+pd-lib que é a parte deterministica e crítica do módulo.
 */

jest.mock('@anthropic-ai/sdk', () => {
  // Por padrão Haiku retorna [] (não marca nada além do regex)
  return class Anthropic {
    constructor() {}
    get messages() {
      return {
        create: async () => ({ content: [{ text: '[]' }] }),
      };
    }
  };
});

const {
  redactPiiInTextLayerPdf,
  MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER,
  _internals: { classifyByRegexInItems, PII_PATTERNS },
} = require('../../src/imaging/pdf-text-redactor');

describe('pdf-text-redactor — PII_PATTERNS', () => {
  // Matriz: cada pattern testa exemplos válidos e contra-exemplos
  const cases = [
    { kind: 'cpf',   match: ['123.456.789-00', '12345678900'],            noMatch: ['12345', 'abc.def.ghi-jk'] },
    { kind: 'cnpj',  match: ['12.345.678/0001-99', '12345678000199'],     noMatch: ['12.345.678', 'abc'] },
    { kind: 'rg',    match: ['12.345.678-9', '1.234.567-X'],              noMatch: ['abc', ''] },
    { kind: 'phone', match: ['(11) 91234-5678', '+55 11 91234-5678', '(21) 9876-5432'], noMatch: ['123', '0800', '11 1234'] },
    { kind: 'email', match: ['joao@clinica.com.br', 'a.b+tag@x.io'],      noMatch: ['joao@', '@clinica.com'] },
    { kind: 'cep',   match: ['01234-567', '01234567'],                    noMatch: ['1234', 'abc-def'] },
    { kind: 'date',  match: ['01/01/2024', '31/12/1999'],                 noMatch: ['2024-01-01', '01/01'] },
  ];

  for (const c of cases) {
    test(`pattern ${c.kind} matches expected examples`, () => {
      const pattern = PII_PATTERNS.find(p => p.kind === c.kind);
      expect(pattern).toBeDefined();
      for (const sample of c.match) {
        expect(pattern.re.test(sample)).toBe(true);
      }
      for (const sample of c.noMatch) {
        expect(pattern.re.test(sample)).toBe(false);
      }
    });
  }
});

describe('pdf-text-redactor — classifyByRegexInItems', () => {
  test('returns empty Map for empty items', () => {
    const result = classifyByRegexInItems([]);
    expect(result.size).toBe(0);
  });

  test('marks the item containing CPF as kind=cpf', () => {
    const items = [
      { str: 'Paciente:', x: 0, y: 0, width: 50, height: 12 },
      { str: '123.456.789-00', x: 60, y: 0, width: 100, height: 12 },
      { str: 'idade 42', x: 0, y: 20, width: 50, height: 12 },
    ];
    const result = classifyByRegexInItems(items);
    expect(result.get(1)).toBe('cpf');
    expect(result.has(2)).toBe(false);
  });

  test('marks email items', () => {
    const items = [
      { str: 'Contato:', x: 0, y: 0, width: 50, height: 12 },
      { str: 'fulano@x.com', x: 60, y: 0, width: 100, height: 12 },
    ];
    const result = classifyByRegexInItems(items);
    expect(result.get(1)).toBe('email');
  });

  test('marks multiple items when each contains its own match', () => {
    // Cada item tem um match independente — função deve marcar todos
    const items = [
      { str: 'CPF: 123.456.789-00', x: 0, y: 0,  width: 200, height: 12 },
      { str: 'fulano@x.com',        x: 0, y: 20, width: 100, height: 12 },
      { str: '01/01/2024',          x: 0, y: 40, width: 80,  height: 12 },
    ];
    const result = classifyByRegexInItems(items);
    expect(result.get(0)).toBe('cpf');
    expect(result.get(1)).toBe('email');
    expect(result.get(2)).toBe('date');
  });

  test('skips items shorter than 2 chars to avoid noise (single-letter glyphs)', () => {
    // Items de 1 char (ex: pdfjs separando letras de logos) não devem ser marcados
    // mesmo se sobrepõem um match — ruído visual.
    const items = [
      { str: 'X', x: 0, y: 0, width: 5, height: 12 },           // 1 char — skip
      { str: '01/01/2024', x: 10, y: 0, width: 80, height: 12 }, // date — match
    ];
    const result = classifyByRegexInItems(items);
    expect(result.has(0)).toBe(false);
    expect(result.get(1)).toBe('date');
  });

  test('does not mark medical terms that look like RG/code (false positive guard)', () => {
    // ACL, T1, FLAIR, etc. devem ser ignorados pelos PATTERNS de regex
    // (Haiku é a camada que cuida de nomes; aqui validamos só regex)
    const items = [
      { str: 'T1',     x: 0, y: 0, width: 20, height: 12 },
      { str: 'FLAIR',  x: 25, y: 0, width: 40, height: 12 },
      { str: 'ACL',    x: 70, y: 0, width: 30, height: 12 },
    ];
    const result = classifyByRegexInItems(items);
    expect(result.size).toBe(0);
  });
});

// TODO(test-debt): integração end-to-end depende de `pdfjs-dist/legacy/build/pdf.mjs`
// (ESM) que exige `NODE_OPTIONS=--experimental-vm-modules` no jest. Habilitar
// quando configurarmos jest pra ESM globalmente. Por ora, os 13 testes de
// regex+classify acima cobrem a parte determinística e crítica.
describe.skip('pdf-text-redactor — redactPiiInTextLayerPdf (integração)', () => {
  // Geramos um PDF leve via pd-lib pra testar o pipeline completo sem fixtures
  // binárias no repo. PDFs gerados pelo pd-lib têm text layer extraível pelo pdfjs.
  async function buildPdf(text) {
    const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 200]);
    page.drawText(text, { x: 20, y: 150, size: 12, font, color: rgb(0, 0, 0) });
    return Buffer.from(await doc.save());
  }

  test('returns has_text_layer=false for an empty PDF (heuristic)', async () => {
    const pdf = await buildPdf(''); // page sem texto
    const out = await redactPiiInTextLayerPdf(pdf);
    expect(out.hasTextLayer).toBe(false);
    expect(out.pageCount).toBe(1);
    expect(typeof out.reasoning).toBe('string');
  });

  test('returns has_text_layer=true and applies redaction for a digital PDF with PII', async () => {
    // ≥ MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER chars + 1 CPF detectável por regex
    const text = 'Paciente Joao da Silva CPF 123.456.789-00 idade 42 anos consulta cardiologia';
    const pdf = await buildPdf(text);
    const out = await redactPiiInTextLayerPdf(pdf);
    expect(out.hasTextLayer).toBe(true);
    expect(out.pageCount).toBe(1);
    expect(out.totalRegions).toBeGreaterThanOrEqual(1);
    expect(out.summary).toHaveProperty('cpf');
    expect(Buffer.isBuffer(out.redactedBuffer)).toBe(true);
    // Output mantém formato PDF (header %PDF-)
    expect(out.redactedBuffer.slice(0, 5).toString()).toBe('%PDF-');
  });

  test('summary aggregates counts per kind', async () => {
    const text = 'Contato fulano@clinica.com e ciclano@x.org telefone (11) 91234-5678';
    const pdf = await buildPdf(text);
    const out = await redactPiiInTextLayerPdf(pdf);
    expect(out.hasTextLayer).toBe(true);
    expect(out.summary.email).toBeGreaterThanOrEqual(2);
    expect(out.summary.phone).toBeGreaterThanOrEqual(1);
  });
});

describe('pdf-text-redactor — MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER', () => {
  test('exposes the heuristic threshold as a module export', () => {
    expect(typeof MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER).toBe('number');
    expect(MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER).toBeGreaterThan(0);
  });
});
