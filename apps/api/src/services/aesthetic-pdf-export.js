'use strict';

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function buildAnalysisPDF({ tenant, subject, analysis, metrics, treatments, lifestyle } = {}) {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

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
  draw('PROTOCOLO ESTETICO — GenomaFlow', { bold: true, size: 16 });
  draw(`${tenant?.name || 'Clinica'}`, { size: 10, color: rgb(0.4, 0.4, 0.5) });
  hr();

  // Patient
  draw('Paciente', { bold: true, size: 12 });
  draw(`Nome: ${subject?.name || '—'}`);
  if (subject?.birth_date) draw(`Nascimento: ${new Date(subject.birth_date).toLocaleDateString('pt-BR')}`);
  if (subject?.sex) draw(`Sexo: ${subject.sex}`);
  hr();

  // Analysis
  draw('Analise', { bold: true, size: 12 });
  draw(`Tipo: ${analysis?.analysis_type || '—'}`);
  if (analysis?.completed_at) {
    draw(`Concluida: ${new Date(analysis.completed_at).toLocaleString('pt-BR')}`);
  }
  hr();

  // Metrics (top 12)
  if (metrics && typeof metrics === 'object') {
    draw('Metricas (score 0-100)', { bold: true, size: 12 });
    const entries = Object.entries(metrics)
      .filter(([, v]) => v && typeof v === 'object' && typeof v.score === 'number')
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, 12);
    for (const [name, m] of entries) {
      ensure(20);
      draw(`• ${name}: ${m.score}/100${m.confidence ? ` (${m.confidence})` : ''}`);
    }
    hr();
  }

  // Treatment protocol
  if (Array.isArray(treatments) && treatments.length > 0) {
    draw('Protocolo de Tratamento Sugerido', { bold: true, size: 12 });
    for (const tx of treatments) {
      ensure(60);
      draw(`${tx.treatment_name}`, { bold: true });
      if (tx.indication_text) draw(`  Indicacao: ${tx.indication_text}`, { size: 10 });
      if (tx.sessions_recommended != null) {
        draw(`  Sessoes: ${tx.sessions_recommended} (intervalo ${tx.interval_days || '?'} dias)`, { size: 10 });
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
    draw('Orientacoes de Estilo de Vida', { bold: true, size: 12 });
    if (lifestyle.calories) draw(`Calorias: ${lifestyle.calories} kcal/dia`);
    if (lifestyle.macros) {
      draw(`Macros: P ${lifestyle.macros.protein_g}g · C ${lifestyle.macros.carbs_g}g · F ${lifestyle.macros.fat_g}g`);
    }
    if (lifestyle.hydration_ml) draw(`Hidratacao: ${lifestyle.hydration_ml} ml/dia`);
    if (lifestyle.exercise_minutes) draw(`Exercicio: ${lifestyle.exercise_minutes} min/dia`);
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
  draw('DISCLAIMER REGULATORIO', { bold: true, size: 10, color: rgb(0.5, 0.1, 0.1) });
  const disclaimer = [
    'Sugestoes geradas por IA tem carater informativo. Decisao clinica e prescricao',
    'sao responsabilidade do profissional habilitado (CFM/CFE/CRN).',
    'Orientacoes de estilo de vida NAO substituem consulta com nutricionista (CRN).',
    'Procedimentos medicos exigem avaliacao medica presencial.',
  ];
  for (const line of disclaimer) {
    draw(line, { size: 9, color: rgb(0.3, 0.3, 0.4) });
  }

  // Footer
  ensure(40);
  draw('Documento gerado pelo GenomaFlow — sistema de gestao clinica multimodulo', { size: 8, color: rgb(0.5, 0.5, 0.55) });
  draw(`Emitido em ${new Date().toLocaleString('pt-BR')}`, { size: 8, color: rgb(0.5, 0.5, 0.55) });

  return Buffer.from(await doc.save());
}

module.exports = { buildAnalysisPDF };
