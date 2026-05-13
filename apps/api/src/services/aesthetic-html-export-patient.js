'use strict';

/**
 * Versão HTML standalone do relatório paciente. Pra inline em email
 * (SES sendEmail body=html) ou preview no browser.
 *
 * Self-contained: CSS inline, sem JavaScript, escapado contra XSS via
 * encodeText helper. Aspectos visuais batem com o PDF buildPatientPDF.
 *
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase4-design.md §6
 */

function encodeText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scoreLabel(score) {
  if (typeof score !== 'number') return 'a ser avaliado';
  if (score >= 80) return 'ótimo';
  if (score >= 65) return 'bom';
  if (score >= 50) return 'razoável';
  if (score >= 30) return 'requer atenção';
  return 'prioridade';
}

function scoreColor(score) {
  if (typeof score !== 'number') return '#8a8a96';
  if (score >= 80) return '#0fa667';
  if (score >= 65) return '#4d99d9';
  if (score >= 50) return '#f29826';
  return '#d94040';
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

function buildPatientHTML({ tenant, subject, analysis, metrics, customMessage } = {}) {
  const aggregates = Object.entries(metrics || {})
    .filter(([k, v]) => k.startsWith('aggregate_') && v && typeof v.score === 'number');

  const okCount = aggregates.filter(([, m]) => m.score >= 65).length;
  const attentionCount = aggregates.filter(([, m]) => m.score < 50).length;

  let interpretation;
  if (okCount > 0 && attentionCount === 0) {
    interpretation = 'Sua pele está em ótimas condições! Mantenha os cuidados diários.';
  } else if (attentionCount > 0 && okCount > 0) {
    interpretation = `Pontos fortes: ${okCount} áreas com bom resultado. Áreas com atenção: ${attentionCount}. Vamos trabalhar nelas.`;
  } else if (attentionCount > 0) {
    interpretation = `Identificamos ${attentionCount} áreas que merecem atenção. Temos tratamentos eficazes para cada uma.`;
  } else {
    interpretation = 'Sua análise mostra resultados gerais bons.';
  }

  const aggregateCards = aggregates.map(([key, m]) => {
    const color = scoreColor(m.score);
    return `
      <div style="display:inline-block;width:48%;margin:0 0 12px 0;vertical-align:top;">
        <div style="background:#fafafe;border:1px solid #e0e0e8;border-radius:8px;border-left:4px solid ${color};padding:12px 14px;">
          <div style="font-weight:700;font-size:13px;color:#22222a;margin-bottom:4px;">
            ${encodeText(AGGREGATE_LAY_LABELS[key] || key)}
          </div>
          <div style="font-weight:700;font-size:14px;color:${color};margin-bottom:4px;">
            ${encodeText(scoreLabel(m.score))}
          </div>
          <div style="font-size:11px;color:#7a7a86;">
            ${encodeText(AGGREGATE_LAY_DESCRIPTIONS[key] || '')}
          </div>
        </div>
      </div>`;
  }).join('');

  const dt = analysis?.completed_at
    ? new Date(analysis.completed_at).toLocaleDateString('pt-BR')
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Sua Análise Estética — ${encodeText(tenant?.name || 'GenomaFlow')}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Inter',Arial,Helvetica,sans-serif;color:#22222a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="max-width:640px;width:100%;background:#ffffff;margin:24px auto;">
    <!-- Header -->
    <tr><td style="background:#eeeefe;border-top:4px solid #9966d9;padding:32px 36px 24px;">
      <div style="font-size:22px;font-weight:700;color:#5a4490;margin:0 0 4px;">Sua Análise Estética</div>
      <div style="font-size:11px;color:#7a7a86;">${encodeText(tenant?.name || 'GenomaFlow')}</div>
    </td></tr>

    <!-- Saudação -->
    <tr><td style="padding:24px 36px 6px;">
      <div style="font-weight:700;font-size:16px;margin-bottom:6px;">
        Olá, ${encodeText(subject?.name || 'paciente')}!
      </div>
      <p style="font-size:13px;line-height:1.6;color:#3a3a44;margin:0 0 8px;">
        Aqui está um resumo da sua análise estética, em linguagem simples.
        Conversamos com mais detalhes na consulta.
      </p>
      ${customMessage ? `
        <div style="background:#fff7ed;border-left:3px solid #f29826;padding:10px 14px;margin:14px 0;font-size:12px;line-height:1.5;color:#5a4a25;">
          ${encodeText(customMessage)}
        </div>` : ''}
    </td></tr>

    <!-- Cards de scores -->
    <tr><td style="padding:18px 30px 6px;">
      <div style="font-weight:700;font-size:15px;color:#5a4490;margin-bottom:10px;">
        Como sua pele está hoje
      </div>
      <div>${aggregateCards || '<p style="font-size:12px;color:#7a7a86;">Avaliação detalhada na consulta com o profissional.</p>'}</div>
    </td></tr>

    <!-- Interpretação -->
    <tr><td style="padding:14px 36px 6px;">
      <div style="font-weight:700;font-size:15px;color:#5a4490;margin-bottom:6px;">
        O que isso significa pra você
      </div>
      <p style="font-size:13px;line-height:1.6;color:#3a3a44;margin:0;">
        ${encodeText(interpretation)}
      </p>
    </td></tr>

    <!-- Próximos passos -->
    <tr><td style="padding:14px 36px 6px;">
      <div style="font-weight:700;font-size:15px;color:#5a4490;margin-bottom:6px;">
        Próximos passos
      </div>
      <ul style="font-size:13px;line-height:1.7;color:#3a3a44;margin:0;padding-left:18px;">
        <li>Continue com sua rotina de cuidados.</li>
        <li>Hidratação e proteção solar diárias são essenciais.</li>
        <li>Volte para reavaliação conforme indicação do profissional.</li>
        <li>Em caso de dúvida, entre em contato com a clínica.</li>
      </ul>
    </td></tr>

    <!-- Disclaimer -->
    <tr><td style="padding:22px 36px 12px;">
      <div style="background:#f4f4f8;padding:12px 14px;border-radius:6px;font-size:11px;line-height:1.5;color:#6a6a76;">
        Este relatório é informativo e baseado em análise de imagens por IA.
        Decisões clínicas e indicação de tratamentos são responsabilidade do
        profissional habilitado.
      </div>
    </td></tr>

    <!-- Rodapé -->
    <tr><td style="padding:6px 36px 26px;font-size:10px;color:#9a9aa6;">
      ${dt ? `Análise gerada em ${encodeText(dt)} · ` : ''}GenomaFlow Estética
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { buildPatientHTML };
