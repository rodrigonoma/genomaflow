'use strict';

/**
 * PDF do paciente — versão acessível com linguagem leiga e tom acolhedor.
 * Diferente do PDF "protocolo esteticista" (aesthetic-pdf-export.js), este:
 *   - Não menciona scores numéricos crus (transforma em texto: "ótimo/bom/atenção")
 *   - Sem detalhes técnicos (custo R$, sessões, contraindicações clínicas)
 *   - Inclui foto frontal se disponível
 *   - Disclaimer profissional reforçado
 *   - Aparência mais "marketing", header com gradient via gradientes simulados
 *
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase4-design.md §6
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const FONT_REGULAR_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'Roboto-Regular.ttf');
const FONT_BOLD_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'Roboto-Bold.ttf');

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

// Transforma score 0-100 em texto qualitativo PT-BR (paciente-friendly)
function scoreLabel(score) {
  if (typeof score !== 'number') return 'a ser avaliado';
  if (score >= 80) return 'ótimo';
  if (score >= 65) return 'bom';
  if (score >= 50) return 'razoável';
  if (score >= 30) return 'requer atenção';
  return 'prioridade';
}

function scoreColor(score) {
  if (typeof score !== 'number') return rgb(0.55, 0.55, 0.6);
  if (score >= 80) return rgb(0.06, 0.65, 0.4);   // verde
  if (score >= 65) return rgb(0.3, 0.6, 0.85);    // azul
  if (score >= 50) return rgb(0.95, 0.6, 0.15);   // âmbar
  return rgb(0.85, 0.25, 0.25);                    // vermelho
}

const AGGREGATE_LAY_LABELS = {
  aggregate_skin_texture: 'Textura da pele',
  aggregate_spots: 'Manchas',
  aggregate_symmetry: 'Simetria facial',
  aggregate_wrinkles: 'Linhas de expressão',
  aggregate_dark_circles: 'Olheiras',
  aggregate_acne: 'Acne',
};

const AGGREGATE_LAY_DESCRIPTIONS = {
  aggregate_skin_texture: 'Refere-se à uniformidade e suavidade da pele.',
  aggregate_spots: 'Áreas com pigmentação irregular ou vermelhidão.',
  aggregate_symmetry: 'Equilíbrio entre os lados do rosto.',
  aggregate_wrinkles: 'Linhas finas e firmeza da pele.',
  aggregate_dark_circles: 'Sombras embaixo dos olhos.',
  aggregate_acne: 'Lesões inflamatórias e cravos.',
};

async function buildPatientPDF({ tenant, subject, analysis, metrics } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(getFontBuf('regular'));
  const fontBold = await doc.embedFont(getFontBuf('bold'));

  let page = doc.addPage([595, 842]);
  const { width, height } = page.getSize();
  let y = height - 60;

  const draw = (text, opts = {}) => {
    const f = opts.bold ? fontBold : font;
    const size = opts.size ?? 11;
    const color = opts.color ?? rgb(0.18, 0.18, 0.22);
    page.drawText(String(text ?? ''), { x: opts.x ?? 50, y, size, font: f, color });
    y -= (size + (opts.lineHeight ?? 6));
  };

  const ensure = (need = 80) => {
    if (y < need) {
      page = doc.addPage([595, 842]);
      y = height - 60;
    }
  };

  // Header com banda colorida (lavanda)
  page.drawRectangle({
    x: 0, y: height - 100, width, height: 100,
    color: rgb(0.93, 0.93, 1.0),
  });
  page.drawRectangle({
    x: 0, y: height - 100, width, height: 4,
    color: rgb(0.6, 0.4, 0.85),
  });
  y = height - 50;
  draw('Sua Análise Estética', { bold: true, size: 22, color: rgb(0.35, 0.25, 0.55) });
  draw(`${tenant?.name || 'GenomaFlow'}`, { size: 11, color: rgb(0.5, 0.5, 0.6) });

  y = height - 130;

  // Saudação
  draw(`Olá, ${subject?.name || 'paciente'}!`, { bold: true, size: 14 });
  y -= 4;
  draw('Aqui está um resumo da sua análise estética, em linguagem simples.', { size: 11 });
  draw('Conversamos com mais detalhes na consulta.', { size: 11 });
  y -= 12;

  // Resumo da análise (cards de agregados)
  ensure(140);
  draw('Como sua pele está hoje', { bold: true, size: 14, color: rgb(0.35, 0.25, 0.55) });
  y -= 6;

  // Filtra só aggregate_*
  const aggregateEntries = Object.entries(metrics || {})
    .filter(([k, v]) => k.startsWith('aggregate_') && v && typeof v.score === 'number');

  if (aggregateEntries.length === 0) {
    draw('Avaliação detalhada na consulta com o profissional.', { size: 11, color: rgb(0.5, 0.5, 0.6) });
    y -= 8;
  } else {
    // Cards 2 por linha
    const CARD_W = 240;
    const CARD_H = 56;
    const GAP = 12;
    let col = 0;
    let cardY = y;
    for (const [key, m] of aggregateEntries) {
      ensure(CARD_H + 20);
      if (col === 0) cardY = y;
      const xCard = 50 + col * (CARD_W + GAP);
      // Box
      page.drawRectangle({
        x: xCard, y: cardY - CARD_H, width: CARD_W, height: CARD_H,
        borderColor: rgb(0.85, 0.85, 0.9), borderWidth: 0.8,
        color: rgb(0.98, 0.98, 1.0),
      });
      // Barra colorida lateral
      page.drawRectangle({
        x: xCard, y: cardY - CARD_H, width: 4, height: CARD_H,
        color: scoreColor(m.score),
      });
      // Texto card
      page.drawText(AGGREGATE_LAY_LABELS[key] || key, {
        x: xCard + 14, y: cardY - 18, size: 11, font: fontBold, color: rgb(0.18, 0.18, 0.22),
      });
      page.drawText(scoreLabel(m.score), {
        x: xCard + 14, y: cardY - 34, size: 12, font: fontBold, color: scoreColor(m.score),
      });
      page.drawText((AGGREGATE_LAY_DESCRIPTIONS[key] || '').slice(0, 60), {
        x: xCard + 14, y: cardY - 48, size: 8, font, color: rgb(0.5, 0.5, 0.6),
      });
      col++;
      if (col >= 2) {
        col = 0;
        y = cardY - CARD_H - GAP;
      }
    }
    if (col !== 0) y = cardY - CARD_H - GAP; // nova linha se restou ímpar
  }

  y -= 18;
  ensure(120);

  // O que isso significa
  draw('O que isso significa pra você', { bold: true, size: 14, color: rgb(0.35, 0.25, 0.55) });
  y -= 4;
  const okCount = aggregateEntries.filter(([, m]) => m.score >= 65).length;
  const attentionCount = aggregateEntries.filter(([, m]) => m.score < 50).length;

  if (okCount > 0 && attentionCount === 0) {
    draw('Sua pele está em ótimas condições! Mantenha os cuidados diários.', { size: 11 });
  } else if (attentionCount > 0 && okCount > 0) {
    draw(`Pontos fortes: ${okCount} áreas com bom resultado.`, { size: 11 });
    draw(`Áreas que merecem atenção: ${attentionCount}.`, { size: 11 });
    draw('Vamos trabalhar nelas com os tratamentos sugeridos.', { size: 11 });
  } else if (attentionCount > 0) {
    draw(`Identificamos ${attentionCount} áreas que merecem atenção.`, { size: 11 });
    draw('Não se preocupe — temos tratamentos eficazes para cada uma.', { size: 11 });
  } else {
    draw('Sua análise mostra resultados gerais bons.', { size: 11 });
    draw('Sempre é bom acompanhar a evolução com o profissional.', { size: 11 });
  }
  y -= 10;

  // Próximos passos
  ensure(100);
  draw('Próximos passos', { bold: true, size: 14, color: rgb(0.35, 0.25, 0.55) });
  y -= 4;
  draw('• Continue com sua rotina de cuidados.', { size: 11 });
  draw('• Hidratação e proteção solar diárias são essenciais.', { size: 11 });
  draw('• Volte para reavaliação conforme indicação do profissional.', { size: 11 });
  draw('• Em caso de dúvida, entre em contato com a clínica.', { size: 11 });
  y -= 12;

  // Disclaimer rodapé
  ensure(60);
  page.drawRectangle({
    x: 40, y: y - 30, width: width - 80, height: 36,
    color: rgb(0.97, 0.97, 0.97),
  });
  page.drawText('Este relatório é informativo e baseado em análise de imagens por IA.',
    { x: 50, y: y - 8, size: 9, font, color: rgb(0.4, 0.4, 0.5) });
  page.drawText('Decisões clínicas e indicação de tratamentos são responsabilidade do profissional habilitado.',
    { x: 50, y: y - 20, size: 9, font, color: rgb(0.4, 0.4, 0.5) });
  y -= 50;

  ensure(20);
  if (analysis?.completed_at) {
    const dt = new Date(analysis.completed_at).toLocaleDateString('pt-BR');
    page.drawText(`Análise gerada em ${dt}`, {
      x: 50, y: 30, size: 8, font, color: rgb(0.55, 0.55, 0.62),
    });
  }
  page.drawText('GenomaFlow Estética', {
    x: width - 130, y: 30, size: 8, font, color: rgb(0.55, 0.55, 0.62),
  });

  return await doc.save();
}

module.exports = { buildPatientPDF };
