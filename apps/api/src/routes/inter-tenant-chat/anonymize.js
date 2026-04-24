/**
 * Converte exam + clinical_results + subject em payload anonimizado
 * pra anexo de chat entre tenants. NUNCA retorna nome, cpf, owner_name,
 * microchip, data de nascimento exata, telefone ou outro PII direto.
 *
 * Spec: docs/superpowers/specs/2026-04-23-inter-tenant-chat-design.md §5.7
 * Plan: docs/superpowers/plans/2026-04-23-inter-tenant-chat-phase4.md
 */

function ageRange(birthDate) {
  if (!birthDate) return null;
  const years = Math.floor((Date.now() - new Date(birthDate).getTime()) / (365.25 * 24 * 3600 * 1000));
  if (!Number.isFinite(years) || years < 0) return null;
  if (years >= 70) return '70+';
  const bucket = Math.floor(years / 10) * 10;
  return `${bucket}-${bucket + 10}`;
}

function roundWeight(w) {
  if (w == null) return null;
  const n = Number(w);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function anonymizeAiAnalysis({ exam, subject, results }) {
  const isVet = subject.subject_type === 'animal';
  const anonSubject = {
    subject_type: subject.subject_type,
    age_range: ageRange(subject.birth_date),
    sex: subject.sex,
  };
  if (isVet) {
    anonSubject.species = subject.species || null;
    anonSubject.breed = subject.breed || null;
    anonSubject.weight_kg = roundWeight(subject.weight);
  }

  return {
    exam_source_tenant_id: exam.tenant_id,
    exam_created_at: exam.created_at,
    subject: anonSubject,
    results: (results || []).map(r => ({
      agent_type: r.agent_type,
      interpretation: r.interpretation,
      risk_scores: r.risk_scores || {},
      alerts: r.alerts || [],
      recommendations: r.recommendations || [],
    })),
  };
}

module.exports = { anonymizeAiAnalysis, ageRange, roundWeight };
