'use strict';

const { describe, test, expect } = require('@jest/globals');
const { buildPatientHTML } = require('../../src/services/aesthetic-html-export-patient');

describe('buildPatientHTML', () => {
  test('retorna HTML self-contained com header + cards', () => {
    const html = buildPatientHTML({
      tenant: { name: 'Clínica Demo' },
      subject: { name: 'Ana Silva' },
      analysis: { completed_at: '2026-05-13T10:00:00Z' },
      metrics: {
        aggregate_skin_texture: { score: 75, source: 'aggregate' },
        aggregate_spots: { score: 55, source: 'aggregate' },
      },
    });
    expect(typeof html).toBe('string');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Sua Análise Estética');
    expect(html).toContain('Ana Silva');
    expect(html).toContain('Clínica Demo');
    expect(html).toContain('Textura da pele');
    expect(html).toContain('Manchas');
  });

  test('escape XSS no nome do paciente', () => {
    const html = buildPatientHTML({
      subject: { name: '<script>alert(1)</script>' },
      analysis: { completed_at: '2026-05-13' },
      metrics: {},
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('escape XSS no customMessage', () => {
    const html = buildPatientHTML({
      subject: { name: 'Ana' },
      analysis: {},
      metrics: {},
      customMessage: '"><img src=x onerror=alert(1)>',
    });
    expect(html).not.toMatch(/<img src=x/);
    expect(html).toContain('&quot;');
  });

  test('customMessage aparece quando fornecido', () => {
    const html = buildPatientHTML({
      subject: { name: 'Ana' },
      analysis: {},
      metrics: {},
      customMessage: 'Lembre-se de tomar bastante água!',
    });
    expect(html).toContain('Lembre-se de tomar bastante água!');
  });

  test('disclaimer LGPD sempre presente', () => {
    const html = buildPatientHTML({ metrics: {} });
    expect(html).toContain('profissional habilitado');
  });

  test('filtra só aggregate_* (ignora rugas, simetria, etc atômicas)', () => {
    const html = buildPatientHTML({
      metrics: {
        rugas: { score: 70, source: 'anthropic_vision' },
        aggregate_wrinkles: { score: 60, source: 'aggregate' },
      },
    });
    expect(html).toContain('Linhas de expressão'); // aggregate_wrinkles label
    expect(html).not.toContain('>rugas<');         // raw key não aparece
  });
});
