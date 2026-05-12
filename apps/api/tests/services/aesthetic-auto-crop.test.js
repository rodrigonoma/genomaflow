'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');

// ─── Mock @anthropic-ai/sdk before requiring the service ───────────────────
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

const {
  parseJSON,
  sanitizeRegions,
  applyBlur,
  autoCropSensitive,
  MAX_REGIONS,
} = require('../../src/services/aesthetic-auto-crop');

// ─── parseJSON ─────────────────────────────────────────────────────────────
describe('parseJSON', () => {
  test('extrai JSON limpo', () => {
    expect(parseJSON('{"regions":[]}')).toEqual({ regions: [] });
  });

  test('extrai JSON com prefixo de texto', () => {
    expect(parseJSON('Aqui vai:\n{"regions":[]}\nFim.')).toEqual({ regions: [] });
  });

  test('extrai JSON com regiões populadas', () => {
    const input = 'texto {"regions":[{"type":"nipple","x":0.2,"y":0.3,"w":0.1,"h":0.1}]} ok';
    const r = parseJSON(input);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0].type).toBe('nipple');
  });

  test('lança BAD_LLM_OUTPUT em string vazia', () => {
    expect(() => parseJSON('')).toThrow('BAD_LLM_OUTPUT');
  });

  test('lança BAD_LLM_OUTPUT em texto sem JSON', () => {
    expect(() => parseJSON('sem json aqui')).toThrow('BAD_LLM_OUTPUT');
  });

  test('lança BAD_LLM_OUTPUT em JSON malformado', () => {
    expect(() => parseJSON('{broken json}}')).toThrow('BAD_LLM_OUTPUT');
  });

  test('lança BAD_LLM_OUTPUT em JSON sem regions[]', () => {
    expect(() => parseJSON('{"foo":1}')).toThrow('BAD_LLM_OUTPUT');
  });

  test('lança BAD_LLM_OUTPUT em null', () => {
    expect(() => parseJSON(null)).toThrow('BAD_LLM_OUTPUT');
  });
});

// ─── sanitizeRegions ───────────────────────────────────────────────────────
describe('sanitizeRegions', () => {
  test('região válida passa intacta', () => {
    const r = sanitizeRegions({ regions: [
      { type: 'nipple', x: 0.2, y: 0.3, w: 0.1, h: 0.1, confidence: 0.9 },
    ]});
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('nipple');
    expect(r[0].x).toBe(0.2);
    expect(r[0].confidence).toBe(0.9);
  });

  test('type inválido é normalizado para "other"', () => {
    const r = sanitizeRegions({ regions: [
      { type: 'bad_type', x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    ]});
    expect(r[0].type).toBe('other');
  });

  test('coordenadas fora de [0,1] são clamped', () => {
    const r = sanitizeRegions({ regions: [
      { type: 'other', x: -0.5, y: 2.0, w: 0.1, h: 0.1 },
    ]});
    expect(r).toHaveLength(1);
    expect(r[0].x).toBe(0);   // clamped from -0.5
    expect(r[0].y).toBe(1);   // clamped from 2.0
  });

  test('regiões com w=0 ou h=0 são descartadas', () => {
    const r = sanitizeRegions({ regions: [
      { type: 'genital', x: 0.5, y: 0.5, w: 0, h: 0.1 },
      { type: 'nipple', x: 0.5, y: 0.5, w: 0.1, h: 0 },
    ]});
    expect(r).toHaveLength(0);
  });

  test('coordenada não-numérica (NaN, string) → entrada descartada', () => {
    const r = sanitizeRegions({ regions: [
      { type: 'other', x: 'NaN', y: 0.5, w: 0.1, h: 0.1 },
      { type: 'other', x: 'abc', y: 0.5, w: 0.1, h: 0.1 },
    ]});
    expect(r).toHaveLength(0);
  });

  test('limita a MAX_REGIONS entradas', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      type: 'other', x: 0.1, y: 0.1, w: 0.1, h: 0.1,
    }));
    const r = sanitizeRegions({ regions: many });
    expect(r).toHaveLength(MAX_REGIONS);
  });

  test('regions[] vazio → array vazio', () => {
    expect(sanitizeRegions({ regions: [] })).toEqual([]);
  });

  test('entradas null/undefined no array são ignoradas', () => {
    const r = sanitizeRegions({ regions: [null, undefined, { type: 'nipple', x: 0.1, y: 0.1, w: 0.1, h: 0.1 }] });
    expect(r).toHaveLength(1);
  });

  test('confidence fora de range é clamped', () => {
    const r = sanitizeRegions({ regions: [
      { type: 'nipple', x: 0.1, y: 0.1, w: 0.1, h: 0.1, confidence: 5.5 },
    ]});
    expect(r[0].confidence).toBe(1);
  });

  test('confidence ausente → null', () => {
    const r = sanitizeRegions({ regions: [
      { type: 'nipple', x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    ]});
    expect(r[0].confidence).toBeNull();
  });
});

// ─── applyBlur (usa sharp com buffer real pequeno) ─────────────────────────
describe('applyBlur', () => {
  const sharp = require('sharp');

  test('regions[] vazio → buffer inalterado (mesma referência)', async () => {
    const buf = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#ff0000' },
    }).png().toBuffer();

    const { buffer, applied } = await applyBlur({ buffer: buf, regions: [], mode: 'pixelate' });
    expect(applied).toBe(0);
    expect(buffer).toBe(buf); // exata mesma referência
  });

  test('modo pixelate com região válida → applied=1, buffer diferente', async () => {
    const buf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#00ff00' },
    }).png().toBuffer();

    const { buffer, applied } = await applyBlur({
      buffer: buf,
      regions: [{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }],
      mode: 'pixelate',
    });
    expect(applied).toBe(1);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer).not.toBe(buf);
  });

  test('modo blur com região válida → applied=1', async () => {
    const buf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#0000ff' },
    }).png().toBuffer();

    const { buffer, applied } = await applyBlur({
      buffer: buf,
      regions: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.3 }],
      mode: 'blur',
    });
    expect(applied).toBe(1);
    expect(Buffer.isBuffer(buffer)).toBe(true);
  });

  test('múltiplas regiões → applied conta as sobrepostas', async () => {
    const buf = await sharp({
      create: { width: 200, height: 200, channels: 3, background: '#ffffff' },
    }).png().toBuffer();

    const { applied } = await applyBlur({
      buffer: buf,
      regions: [
        { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        { x: 0.6, y: 0.6, w: 0.2, h: 0.2 },
      ],
      mode: 'pixelate',
    });
    expect(applied).toBe(2);
  });
});

// ─── autoCropSensitive ─────────────────────────────────────────────────────
describe('autoCropSensitive', () => {
  const sharp = require('sharp');

  beforeEach(() => {
    mockCreate.mockReset();
    // Set ANTHROPIC_API_KEY for tests
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  test('regions vazias detectadas → buffer inalterado, applied=0', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"regions":[]}' }],
    });
    const buf = await sharp({
      create: { width: 50, height: 50, channels: 3, background: '#aaaaaa' },
    }).png().toBuffer();

    const result = await autoCropSensitive({ buffer: buf, mime: 'image/png' });
    expect(result.applied).toBe(0);
    expect(result.regions).toEqual([]);
    expect(result.buffer).toBe(buf);
  });

  test('regiões detectadas → applied>0, buffer diferente', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        regions: [{ type: 'nipple', x: 0.3, y: 0.3, w: 0.2, h: 0.2, confidence: 0.95 }],
      })}],
    });
    const buf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#cccccc' },
    }).png().toBuffer();

    const result = await autoCropSensitive({ buffer: buf, mime: 'image/png' });
    expect(result.applied).toBe(1);
    expect(result.regions).toHaveLength(1);
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
  });

  test('falha na API → non-fatal: buffer original, error informado', async () => {
    mockCreate.mockRejectedValue(new Error('timeout'));

    const buf = await sharp({
      create: { width: 50, height: 50, channels: 3, background: '#111111' },
    }).png().toBuffer();

    const result = await autoCropSensitive({ buffer: buf, mime: 'image/png' });
    expect(result.applied).toBe(0);
    expect(result.buffer).toBe(buf);
    expect(result.error).toContain('timeout');
  });

  test('BAD_LLM_OUTPUT → non-fatal: buffer original, error informado', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'não é JSON nenhum' }],
    });
    const buf = await sharp({
      create: { width: 50, height: 50, channels: 3, background: '#222222' },
    }).png().toBuffer();

    const result = await autoCropSensitive({ buffer: buf, mime: 'image/png' });
    expect(result.applied).toBe(0);
    expect(result.buffer).toBe(buf);
    expect(result.error).toMatch(/BAD_LLM_OUTPUT/);
  });

  test('ANTHROPIC_API_KEY ausente → non-fatal: buffer original, error informado', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const buf = await sharp({
      create: { width: 50, height: 50, channels: 3, background: '#333333' },
    }).png().toBuffer();

    const result = await autoCropSensitive({ buffer: buf, mime: 'image/png' });
    expect(result.applied).toBe(0);
    expect(result.buffer).toBe(buf);
    expect(result.error).toMatch(/ANTHROPIC_API_KEY/);
  });
});
