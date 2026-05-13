'use strict';

const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const FONT_REGULAR_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'Roboto-Regular.ttf');
const FONT_BOLD_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'Roboto-Bold.ttf');

// Module-level cache so we don't re-read from disk on every call
let _fontBufRegular = null;
let _fontBufBold = null;

function getFontBuf(which) {
  if (which === 'regular') {
    if (!_fontBufRegular) _fontBufRegular = fs.readFileSync(FONT_REGULAR_PATH);
    return _fontBufRegular;
  }
  if (!_fontBufBold) _fontBufBold = fs.readFileSync(FONT_BOLD_PATH);
  return _fontBufBold;
}

async function buildAnalysisPDF({ tenant, subject, analysis, metrics, treatments, lifestyle } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const helvetica = await doc.embedFont(getFontBuf('regular'));
  const helveticaBold = await doc.embedFont(getFontBuf('bold'));

  let page = doc.addPage([595, 842]); // A4 portrait
  const { width, height } = page.getSize();
  let y = height - 60;

  const draw = (text, opts = {}) => {
    const font = opts.bold ? helveticaBold : helvetica;
    const size = opts.size ?? 11;
    const color = opts.color ?? rgb(0.1, 0.1, 0.15);
    page.drawText(String(text ?? ''), { x: opts.x ?? 50, y, size, font, color });
    y -= (size + (opts.lineHeight ?? 6));
  };

  const ensure = (need = 60) => {
    if (y < need) {
      page = doc.addPage([595, 842]);
      y = height - 60;
    }
  };

  const hr = () => {
    page.drawLine({
      start: { x: 50, y: y + 4 }, end: { x: width - 50, y: y + 4 },
      thickness: 0.5, color: rgb(0.7, 0.7, 0.78),
    });
    y -= 8;
  };

  // Header
  draw('PROTOCOLO ESTÉTICO — GenomaFlow', { bold: true, size: 16 });
  draw(`${tenant?.name || 'Clínica'}`, { size: 10, color: rgb(0.4, 0.4, 0.5) });
  hr();

  // Patient
  draw('Paciente', { bold: true, size: 12 });
  draw(`Nome: ${subject?.name || '—'}`);
  if (subject?.birth_date) draw(`Nascimento: ${new Date(subject.birth_date).toLocaleDateString('pt-BR')}`);
  if (subject?.sex) draw(`Sexo: ${subject.sex}`);
  hr();

  // Analysis
  draw('Análise', { bold: true, size: 12 });
  draw(`Tipo: ${analysis?.analysis_type || '—'}`);
  if (analysis?.tier === 'advanced') {
    draw('Tier: AVANÇADA (Captura Guiada)', { bold: true, size: 10 });
  }
  if (analysis?.completed_at) {
    draw(`Concluída: ${new Date(analysis.completed_at).toLocaleString('pt-BR')}`);
  }
  hr();

  // Metrics — V2: split por source (Vision | mediapipe | aggregate)
  if (metrics && typeof metrics === 'object') {
    const validEntries = Object.entries(metrics)
      .filter(([, v]) => v && typeof v === 'object' && typeof v.score === 'number');
    const aggregateEntries = validEntries
      .filter(([, v]) => v.source === 'aggregate');
    const visionEntries = validEntries
      .filter(([, v]) => v.source !== 'mediapipe' && v.source !== 'aggregate')
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, 12);
    const geometryEntries = validEntries
      .filter(([, v]) => v.source === 'mediapipe')
      .sort((a, b) => b[1].score - a[1].score);

    // V2 Fase 2: Resumo da Análise (6 scores agregados) no topo
    if (aggregateEntries.length > 0) {
      const HUMAN_LABEL = {
        aggregate_skin_texture: 'Textura da pele',
        aggregate_spots: 'Manchas',
        aggregate_symmetry: 'Simetria',
        aggregate_wrinkles: 'Rugas / Firmeza',
        aggregate_dark_circles: 'Olheiras',
        aggregate_acne: 'Acne',
      };
      draw('Resumo da Análise', { bold: true, size: 12 });
      for (const [name, m] of aggregateEntries) {
        ensure(20);
        const label = HUMAN_LABEL[name] || name.replace(/^aggregate_/, '');
        draw(`• ${label}: ${m.score}/100${m.confidence === 'low' ? ' (confiança baixa)' : ''}`);
      }
      hr();
    }

    if (visionEntries.length > 0) {
      draw('Análise Visual (IA) — score 0-100', { bold: true, size: 12 });
      for (const [name, m] of visionEntries) {
        ensure(20);
        draw(`• ${name}: ${m.score}/100${m.confidence ? ` (${m.confidence})` : ''}`);
      }
      hr();
    }

    if (geometryEntries.length > 0) {
      draw('Métricas Geométricas (Análise Avançada) — score 0-100', { bold: true, size: 12 });
      for (const [name, m] of geometryEntries) {
        ensure(20);
        const valueStr = typeof m.value_raw === 'number' ? ` [bruto: ${m.value_raw.toFixed(3)}]` : '';
        draw(`• ${name}: ${m.score}/100${m.confidence ? ` (${m.confidence})` : ''}${valueStr}`);
      }
      ensure(20);
      draw('Geometria calculada via MediaPipe — útil pra acompanhar evolução entre sessões.', { size: 9 });
      hr();
    }
  }

  // Treatment protocol
  if (Array.isArray(treatments) && treatments.length > 0) {
    draw('Protocolo de Tratamento Sugerido', { bold: true, size: 12 });
    for (const tx of treatments) {
      ensure(60);
      draw(`${tx.treatment_name}`, { bold: true });
      if (tx.indication_text) draw(`  Indicação: ${tx.indication_text}`, { size: 10 });
      if (tx.sessions_recommended != null) {
        draw(`  Sessões: ${tx.sessions_recommended} (intervalo ${tx.interval_days || '?'} dias)`, { size: 10 });
      }
      if (tx.cost_estimate_brl_min != null && tx.cost_estimate_brl_max != null) {
        draw(`  Custo estimado: R$ ${tx.cost_estimate_brl_min} – R$ ${tx.cost_estimate_brl_max}`, { size: 10 });
      }
      if (tx.expected_outcome) draw(`  Resultado esperado: ${tx.expected_outcome}`, { size: 10 });
      y -= 4;
    }
    hr();
  }

  // Lifestyle
  if (lifestyle) {
    draw('Orientações de Estilo de Vida', { bold: true, size: 12 });
    if (lifestyle.calories) draw(`Calorias: ${lifestyle.calories} kcal/dia`);
    if (lifestyle.macros) {
      draw(`Macros: P ${lifestyle.macros.protein_g}g · C ${lifestyle.macros.carbs_g}g · F ${lifestyle.macros.fat_g}g`);
    }
    if (lifestyle.hydration_ml) draw(`Hidratação: ${lifestyle.hydration_ml} ml/dia`);
    if (lifestyle.exercise_minutes) draw(`Exercício: ${lifestyle.exercise_minutes} min/dia`);
    if (lifestyle.foods?.to_emphasize?.length) {
      ensure(40);
      draw('Alimentos recomendados:', { bold: true, size: 10 });
      for (const f of lifestyle.foods.to_emphasize.slice(0, 10)) {
        ensure(15); draw(`  • ${f}`, { size: 10 });
      }
    }
    if (lifestyle.foods?.to_minimize?.length) {
      ensure(40);
      draw('Alimentos a reduzir:', { bold: true, size: 10 });
      for (const f of lifestyle.foods.to_minimize.slice(0, 10)) {
        ensure(15); draw(`  • ${f}`, { size: 10 });
      }
    }
    hr();
  }

  // Disclaimer
  ensure(120);
  draw('DISCLAIMER REGULATÓRIO', { bold: true, size: 10, color: rgb(0.5, 0.1, 0.1) });
  const disclaimer = [
    'Sugestões geradas por IA têm caráter informativo. Decisão clínica e prescrição',
    'são responsabilidade do profissional habilitado (CFM/CFE/CRN).',
    'Orientações de estilo de vida NÃO substituem consulta com nutricionista (CRN).',
    'Procedimentos médicos exigem avaliação médica presencial.',
  ];
  for (const line of disclaimer) {
    draw(line, { size: 9, color: rgb(0.3, 0.3, 0.4) });
  }

  // Footer
  ensure(40);
  draw('Documento gerado pelo GenomaFlow — sistema de gestão clínica multimódulo', { size: 8, color: rgb(0.5, 0.5, 0.55) });
  draw(`Emitido em ${new Date().toLocaleString('pt-BR')}`, { size: 8, color: rgb(0.5, 0.5, 0.55) });

  return Buffer.from(await doc.save());
}

module.exports = { buildAnalysisPDF };
