'use strict';
/**
 * Unit tests for the V1 image redactor (Tesseract + regex + Haiku + Sharp).
 *
 * Cobre:
 *   - PII_PATTERNS (mesma matriz do PDF redactor, pra garantir paridade)
 *   - classifyByRegex (palavras → Set de índices) com casos críticos
 *   - drawRedaction (Sharp + SVG composite) — passthrough quando sem regiões,
 *     produz buffer válido quando há regiões.
 *
 * NÃO cobre o pipeline completo (`redactPiiFromImage`) porque Tesseract.js é
 * pesado, async e exige fixture de imagem real — deixa pra teste de integração
 * em ambiente dedicado.
 */

jest.mock('@anthropic-ai/sdk', () => {
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
  drawRedaction,
  _internals: { classifyByRegex, PII_PATTERNS },
} = require('../../src/imaging/redactor');

describe('imaging/redactor — PII_PATTERNS', () => {
  // Matriz paralela à do PDF redactor — patterns são duplicados de propósito
  // (CLAUDE.md: "evita acoplamento com OCR-specific code"). Testes em paralelo
  // garantem que se um lado mudar e o outro não, alguém perceba via CI.
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

  test('all kinds defined are unique', () => {
    const kinds = PII_PATTERNS.map(p => p.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe('imaging/redactor — classifyByRegex', () => {
  const word = (text, x = 0, y = 0, w = 50, h = 12, confidence = 90) =>
    ({ text, confidence, bbox: { x, y, w, h } });

  test('returns empty Set for empty input', () => {
    expect(classifyByRegex([]).size).toBe(0);
  });

  test('marks the word containing a CPF', () => {
    const words = [
      word('Paciente:'),
      word('123.456.789-00'),
      word('idade'),
    ];
    const matched = classifyByRegex(words);
    expect(matched.has(1)).toBe(true);
    expect(matched.has(0)).toBe(false);
    expect(matched.has(2)).toBe(false);
  });

  test('marks email and phone in the same input', () => {
    const words = [
      word('Contato:'),
      word('fulano@clinica.com'),
      word('Tel:'),
      word('(11)'),
      word('91234-5678'),
    ];
    const matched = classifyByRegex(words);
    expect(matched.has(1)).toBe(true); // email
    // phone splits across "(11)" and "91234-5678" — fullText "Tel: (11) 91234-5678"
    // regex requer formato contíguo; nesse split pode ou não casar dependendo
    // do regex exato. Aceitamos qualquer dos dois marcando.
    expect(matched.has(3) || matched.has(4)).toBe(true);
  });

  test('skips words shorter than 2 chars (OCR artifacts, punctuation)', () => {
    const words = [
      word('-'),               // single char — skip
      word('01/01/2024'),      // date — match
    ];
    const matched = classifyByRegex(words);
    expect(matched.has(0)).toBe(false);
    expect(matched.has(1)).toBe(true);
  });

  test('does not falsely mark medical/imaging terms (false positive guard)', () => {
    // Termos comuns em laudo médico que NÃO devem ser marcados pelos PATTERNS
    const words = [
      word('T1'), word('FLAIR'), word('AX'), word('SAGITAL'),
      word('ACL'), word('RM'), word('TC'), word('ECG'),
      word('Siemens'), word('mg/dL'),
    ];
    const matched = classifyByRegex(words);
    expect(matched.size).toBe(0);
  });

  test('marks date in DD/MM/AAAA format', () => {
    const words = [word('Exame:'), word('15/03/2024')];
    const matched = classifyByRegex(words);
    expect(matched.has(1)).toBe(true);
  });
});

describe('imaging/redactor — drawRedaction', () => {
  const sharp = require('sharp');

  // Cria imagem PNG vazia (100x100 cinza) pra teste
  async function makePng() {
    return sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 200, b: 200 } }
    }).png().toBuffer();
  }

  test('returns input buffer unchanged when regions is empty', async () => {
    const input = await makePng();
    const out = await drawRedaction(input, []);
    expect(out).toBe(input); // mesma referência — passthrough explícito
  });

  test('produces a valid image buffer when applying regions', async () => {
    const input = await makePng();
    const out = await drawRedaction(input, [
      { x: 10, y: 10, w: 30, h: 20 },
      { x: 50, y: 50, w: 20, h: 10 },
    ]);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    // Output ainda é PNG (Sharp preserva formato)
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
  });

  test('clips rectangles that exceed image bounds', async () => {
    // Região maior que a imagem deve ser clipada — Sharp não deve crashar
    const input = await makePng();
    const out = await drawRedaction(input, [
      { x: 90, y: 90, w: 100, h: 100 }, // estende além da imagem
    ]);
    expect(Buffer.isBuffer(out)).toBe(true);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(100);
  });
});
