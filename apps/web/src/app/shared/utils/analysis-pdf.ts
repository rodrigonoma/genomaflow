/**
 * Gera o PDF de exportação da análise da IA — interpretação, alertas,
 * risk scores e recomendações de todos os agentes do exame.
 *
 * Uso: client-side via jsPDF. Download direto pelo browser.
 */

import { Exam, Subject, ClinicalResult, ClinicProfile, Alert, Recommendation } from '../models/api.models';
import { agentTypeLabel, shortId } from './id-format';

interface ExportContext {
  exam: Exam;
  subject: Subject;
  clinic?: ClinicProfile | null;
}

const SEV_LABEL: Record<string, string> = {
  critical: 'CRÍTICO',
  high: 'ALTO',
  medium: 'MÉDIO',
  low: 'BAIXO',
  none: '—',
};

const SEV_COLOR: Record<string, [number, number, number]> = {
  critical: [255, 100, 80],
  high:     [240, 160, 40],
  medium:   [190, 150, 40],
  low:      [60, 180, 120],
  none:     [120, 120, 140],
};

function topSeverity(alerts: Alert[] | undefined): string {
  if (!alerts?.length) return 'none';
  for (const s of ['critical', 'high', 'medium', 'low']) {
    if (alerts.some(a => a.severity?.toLowerCase() === s)) return s;
  }
  return 'none';
}

export async function exportAnalysisPdf(ctx: ExportContext): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const { exam, subject, clinic } = ctx;

  const pageWidth = 210;
  const margin = 15;
  const contentWidth = pageWidth - 2 * margin;

  // ─── Cabeçalho ───
  let headerY = 18;
  if (clinic?.clinic_logo_url && !clinic.clinic_logo_url.startsWith('s3://')) {
    try { doc.addImage(clinic.clinic_logo_url, 'PNG', margin, 10, 22, 22); } catch (_) {}
  }
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(27, 27, 100);
  doc.text(clinic?.name ?? 'Análise Clínica por IA', pageWidth / 2, headerY, { align: 'center' });
  if (clinic?.cnpj) {
    doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(110, 110, 130);
    doc.text(`CNPJ: ${clinic.cnpj}`, pageWidth / 2, headerY + 5, { align: 'center' });
  }
  doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(110, 110, 130);
  doc.text(new Date().toLocaleDateString('pt-BR'), pageWidth - margin, headerY, { align: 'right' });

  doc.setDrawColor(192, 193, 255).setLineWidth(0.5);
  doc.line(margin, 35, pageWidth - margin, 35);

  // ─── Título ───
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(27, 27, 100);
  doc.text('RELATÓRIO DE ANÁLISE CLÍNICA POR IA', pageWidth / 2, 44, { align: 'center' });

  let y = 54;

  // ─── Identificação do paciente ───
  const isAnimal = subject.subject_type === 'animal';
  const sexLabel = subject.sex === 'M' ? (isAnimal ? 'Macho' : 'Masculino') : (isAnimal ? 'Fêmea' : 'Feminino');
  const age = subject.birth_date
    ? Math.floor((Date.now() - new Date(subject.birth_date).getTime()) / (365.25 * 24 * 3600 * 1000))
    : null;

  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(50, 50, 80);
  doc.text(`${isAnimal ? 'Animal' : 'Paciente'}:`, margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(subject.name, margin + 22, y);
  y += 5;

  const metaParts: string[] = [];
  if (subject.sex) metaParts.push(`Sexo: ${sexLabel}`);
  if (age !== null) metaParts.push(`Idade: ${age} anos`);
  if (isAnimal && subject.species) metaParts.push(`Espécie: ${subject.species}`);
  if (isAnimal && subject.breed) metaParts.push(`Raça: ${subject.breed}`);
  if (subject.weight) metaParts.push(`Peso: ${subject.weight} kg`);
  if (metaParts.length) {
    doc.setFontSize(9).setTextColor(80, 80, 100);
    doc.text(metaParts.join(' · '), margin, y);
    y += 5;
  }

  doc.setFontSize(9).setTextColor(100, 100, 120);
  doc.text(`Exame: ${shortId(exam.id, 'EX')} · Realizado em ${new Date(exam.created_at).toLocaleString('pt-BR')}`, margin, y);
  y += 8;

  doc.setDrawColor(220, 220, 230).setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // ─── Por agente ───
  const results = exam.results ?? [];
  if (results.length === 0) {
    doc.setFont('helvetica', 'italic').setFontSize(10).setTextColor(120, 120, 140);
    doc.text('Exame ainda não analisado ou sem resultados disponíveis.', margin, y);
    y += 5;
  }

  for (const cr of results) {
    if (y > 255) { doc.addPage(); y = 20; }

    const sev = topSeverity(cr.alerts);
    const [r, g, b] = SEV_COLOR[sev];

    // Barra colorida à esquerda
    doc.setFillColor(r, g, b);
    doc.rect(margin, y, 2, 6, 'F');

    // Título do agente
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(27, 27, 100);
    doc.text(agentTypeLabel(cr.agent_type), margin + 5, y + 4.5);

    // Badge de severidade à direita
    const sevText = SEV_LABEL[sev];
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(r, g, b);
    doc.text(sevText, pageWidth - margin, y + 4.5, { align: 'right' });

    y += 9;

    // Risk scores
    const riskEntries = Object.entries(cr.risk_scores ?? {});
    if (riskEntries.length) {
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(100, 100, 120);
      doc.text('RISK SCORES', margin, y);
      y += 4;
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(60, 60, 80);
      for (const [key, value] of riskEntries) {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(`• ${key}: ${value}`, margin + 2, y);
        y += 4;
      }
      y += 2;
    }

    // Interpretação
    if (cr.interpretation) {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(100, 100, 120);
      doc.text('INTERPRETAÇÃO', margin, y);
      y += 4;
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(40, 40, 60);
      const interpText = (cr.interpretation || '').trim();
      const interpLines = doc.splitTextToSize(interpText, contentWidth);
      for (const line of interpLines) {
        if (y > 278) { doc.addPage(); y = 20; }
        doc.text(line, margin, y);
        y += 4;
      }
      y += 2;
    }

    // Alertas
    if (cr.alerts && cr.alerts.length > 0) {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(100, 100, 120);
      doc.text('ALERTAS', margin, y);
      y += 4;
      for (const a of cr.alerts) {
        if (y > 275) { doc.addPage(); y = 20; }
        const [ar, ag, ab] = SEV_COLOR[a.severity?.toLowerCase() ?? 'none'];
        doc.setFillColor(ar, ag, ab);
        doc.circle(margin + 1.5, y - 1.3, 1.1, 'F');
        doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(40, 40, 60);
        doc.text(a.marker, margin + 5, y);
        doc.setFont('helvetica', 'normal').setTextColor(80, 80, 100);
        doc.text(`${a.value}  (${SEV_LABEL[a.severity?.toLowerCase() ?? 'none']})`, margin + 5, y + 4);
        y += 9;
      }
      y += 1;
    }

    // Recomendações
    const recs = (cr.recommendations ?? []).filter(r => r.type !== 'suggested_exam' && r.type !== 'contextual_factor');
    if (recs.length > 0) {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(100, 100, 120);
      doc.text('RECOMENDAÇÕES', margin, y);
      y += 4;
      for (const rec of recs) {
        if (y > 275) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(80, 80, 120);
        doc.text(`[${rec.type.toUpperCase()}]`, margin, y);
        const descX = margin + 26;
        doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(40, 40, 60);
        if (rec.type === 'medication' && rec.name) {
          const medLine = `${rec.name}${rec.dose ? ' · ' + rec.dose : ''}${rec.frequency ? ' · ' + rec.frequency : ''}${rec.duration ? ' · ' + rec.duration : ''}`;
          const lines = doc.splitTextToSize(medLine, contentWidth - 26);
          for (const l of lines) { doc.text(l, descX, y); y += 4; }
        }
        const descLines = doc.splitTextToSize(rec.description, contentWidth - 26);
        for (const l of descLines) { doc.text(l, descX, y); y += 4; }
        y += 1;
      }
      y += 1;
    }

    // Exames sugeridos
    const suggested = (cr.recommendations ?? []).filter(r => r.type === 'suggested_exam');
    if (suggested.length > 0) {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(100, 100, 120);
      doc.text('EXAMES SUGERIDOS', margin, y);
      y += 4;
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(60, 60, 80);
      for (const s of suggested) {
        if (y > 278) { doc.addPage(); y = 20; }
        doc.text(`• ${s._exam || s.description}`, margin + 2, y);
        y += 4;
        if (s._rationale) {
          doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(110, 110, 130);
          const rLines = doc.splitTextToSize(s._rationale, contentWidth - 4);
          for (const l of rLines) { doc.text(l, margin + 4, y); y += 3.5; }
          doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(60, 60, 80);
        }
      }
      y += 2;
    }

    // Separador entre agentes
    y += 2;
    doc.setDrawColor(230, 230, 240).setLineWidth(0.2);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
  }

  // ─── Disclaimer e rodapé em todas as páginas ───
  const range = doc.internal.pages.length - 1;
  for (let i = 1; i <= range; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'italic').setFontSize(7).setTextColor(130, 130, 150);
    const disclaimerText = 'Esta análise é suporte à decisão clínica e NÃO substitui avaliação profissional. O médico/veterinário habilitado valida integralmente todos os resultados antes de qualquer conduta.';
    const dLines = doc.splitTextToSize(disclaimerText, contentWidth);
    doc.text(dLines, pageWidth / 2, 288, { align: 'center' });
    doc.setFontSize(7).setTextColor(150, 150, 170);
    doc.text(`Página ${i}/${range}  ·  GenomaFlow · ${shortId(exam.id, 'EX')}`, pageWidth / 2, 294, { align: 'center' });
  }

  const fname = `analise-${shortId(exam.id, 'EX').toLowerCase()}-${new Date(exam.created_at).toISOString().slice(0, 10)}.pdf`;
  doc.save(fname);
}
