'use strict';

const { describe, test, expect } = require('@jest/globals');
const { buildAnalysisPDF } = require('../../src/services/aesthetic-pdf-export');

describe('buildAnalysisPDF', () => {
  test('gera PDF nao-vazio com paciente + metricas + tratamentos', async () => {
    const buf = await buildAnalysisPDF({
      tenant: { name: 'Clinica X' },
      subject: { name: 'Maria', birth_date: '1990-05-01', sex: 'F' },
      analysis: { id: 'a1', analysis_type: 'facial', completed_at: '2026-05-11T10:00:00Z' },
      metrics: { rugas: { score: 70, confidence: 'high' }, firmeza: { score: 60 } },
      treatments: [{ treatment_name: 'Microagulhamento', indication_text: 'Rugas', sessions_recommended: 4, interval_days: 30 }],
      lifestyle: { calories: 1800, macros: { protein_g: 100, carbs_g: 180, fat_g: 60 } },
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  test('lida com campos ausentes (argumento vazio)', async () => {
    const buf = await buildAnalysisPDF({});
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  test('lida com chamada sem argumentos', async () => {
    const buf = await buildAnalysisPDF();
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  test('lida com muitas metricas (cap visual em 12)', async () => {
    const metrics = {};
    for (let i = 0; i < 30; i++) metrics[`metrica_${i}`] = { score: 100 - i };
    const buf = await buildAnalysisPDF({ metrics });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  test('inclui secao de lifestyle com alimentos recomendados e a reduzir', async () => {
    const buf = await buildAnalysisPDF({
      lifestyle: {
        calories: 2000,
        hydration_ml: 2500,
        exercise_minutes: 30,
        foods: {
          to_emphasize: ['Frango', 'Broccolis', 'Ovos'],
          to_minimize: ['Acucar', 'Refrigerante'],
        },
      },
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  test('gera multiplas paginas com muitos tratamentos', async () => {
    const treatments = [];
    for (let i = 0; i < 15; i++) {
      treatments.push({
        treatment_name: `Tratamento ${i}`,
        indication_text: 'Indicacao longa para teste de paginacao automatica no PDF gerado',
        sessions_recommended: 6,
        interval_days: 21,
        cost_estimate_brl_min: 300,
        cost_estimate_brl_max: 500,
        expected_outcome: 'Melhora significativa na aparencia geral',
      });
    }
    const buf = await buildAnalysisPDF({ treatments });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
    // Com 15 tratamentos o PDF deve ser maior que um PDF minimalista
    expect(buf.length).toBeGreaterThan(2000);
  });

  test('renderiza UTF-8 acentuado sem throw', async () => {
    const buf = await buildAnalysisPDF({
      tenant: { name: 'Clínica Estética Ltda' },
      subject: { name: 'Maria Conceição', sex: 'F' },
      analysis: { id: 'a1', analysis_type: 'facial' },
      metrics: { rugas: { score: 70 }, manchas_solares: { score: 60 } },
      lifestyle: {
        hydration_ml: 2000,
        foods: {
          to_emphasize: ['Abóbora', 'Açaí'],
          to_minimize: ['Açúcar', 'Álcool'],
        },
      },
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
    // Roboto TTF é embutido no PDF — arquivo fica bem maior que o antigo Helvetica (referência ~2KB)
    expect(buf.length).toBeGreaterThan(50000);
  });
});
