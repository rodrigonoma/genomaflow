'use strict';

const { describe, test, expect } = require('@jest/globals');
const { buildPatientPDF } = require('../../src/services/aesthetic-pdf-export-patient');

describe('buildPatientPDF', () => {
  test('gera PDF não-vazio com aggregates', async () => {
    const pdf = await buildPatientPDF({
      tenant: { name: 'Clínica Demo' },
      subject: { name: 'Ana Silva' },
      analysis: { completed_at: '2026-05-13T10:00:00Z' },
      metrics: {
        aggregate_skin_texture: { score: 75, source: 'aggregate' },
        aggregate_spots: { score: 55, source: 'aggregate' },
        aggregate_symmetry: { score: 88, source: 'aggregate' },
        aggregate_wrinkles: { score: 40, source: 'aggregate' },
        // não-aggregate são filtrados:
        rugas: { score: 70, source: 'anthropic_vision' },
      },
    });
    // PDF magic bytes: "%PDF-"
    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf[0]).toBe(0x25); // %
    expect(pdf[1]).toBe(0x50); // P
    expect(pdf[2]).toBe(0x44); // D
    expect(pdf[3]).toBe(0x46); // F
  });

  test('gera PDF mesmo sem aggregates (fallback texto)', async () => {
    const pdf = await buildPatientPDF({
      tenant: { name: 'Clínica X' },
      subject: { name: 'João' },
      analysis: { completed_at: '2026-05-13' },
      metrics: {},
    });
    expect(pdf.length).toBeGreaterThan(500);
  });

  test('aceita campos faltando (tenant/subject undefined)', async () => {
    const pdf = await buildPatientPDF({ metrics: {} });
    expect(pdf.length).toBeGreaterThan(500);
  });
});
