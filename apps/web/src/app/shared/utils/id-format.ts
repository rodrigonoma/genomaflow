/**
 * Helpers para formatação de identificadores exibidos ao usuário.
 */

/**
 * Converte um UUID em um identificador curto e legível.
 * Ex: shortId('a3f8c2d4-1234-...', 'EX') → 'EX-a3f8c2'
 */
export function shortId(uuid: string | null | undefined, prefix: string): string {
  if (!uuid) return '';
  const clean = uuid.replace(/-/g, '').slice(0, 6);
  return `${prefix}-${clean}`;
}

/**
 * Remove prefixo de timestamp e extensão do filename de upload.
 * Ex: '1776747515024-Theresa_HEMOGRAMA_00456 (1).pdf' → 'Theresa_HEMOGRAMA_00456 (1)'
 */
export function cleanFilename(path: string | null | undefined): string {
  if (!path) return '';
  const name = path.split('/').pop() ?? path;
  return name
    .replace(/^\d{10,}-/, '')        // timestamp prefix (10+ digits)
    .replace(/\.[a-z0-9]+$/i, '');   // extension
}

/**
 * Label clínico para um agente de IA.
 */
const AGENT_LABEL: Record<string, string> = {
  hematology: 'HEMATOLOGIA',
  metabolic: 'METABÓLICO',
  cardiovascular: 'CARDIOVASCULAR',
  imaging_rx: 'RX',
  imaging_ecg: 'ECG',
  imaging_ultrasound: 'ULTRASSOM',
  imaging_mri: 'RESSONÂNCIA',
  small_animals: 'PEQUENOS ANIMAIS',
  equine: 'EQUINO',
  bovine: 'BOVINO',
  therapeutic: 'TERAPÊUTICO',
  nutrition: 'NUTRIÇÃO',
  clinical_correlation: 'CORRELAÇÃO CLÍNICA',
};

export function agentTypeLabel(type: string): string {
  return AGENT_LABEL[type] ?? type.toUpperCase();
}

/**
 * Agentes que caracterizam o tipo do exame (Fase 1 + imaging), excluindo
 * os derivados (therapeutic, nutrition, clinical_correlation).
 */
const PRIMARY_AGENTS = new Set([
  'hematology', 'metabolic', 'cardiovascular',
  'imaging_rx', 'imaging_ecg', 'imaging_ultrasound', 'imaging_mri',
  'small_animals', 'equine', 'bovine',
]);

/**
 * Deriva o tipo do exame a partir dos clinical_results existentes.
 * Ex: [{ agent_type: 'hematology' }, { agent_type: 'metabolic' }] → 'HEMATOLOGIA · METABÓLICO'
 * Para imagens, retorna a modalidade única (RX, ECG, ULTRASSOM, RESSONÂNCIA).
 * Retorna string vazia se o exame ainda não foi analisado.
 */
export function examTypeLabel(results: Array<{ agent_type: string }> | null | undefined): string {
  if (!results?.length) return '';
  const primary = results.filter(r => PRIMARY_AGENTS.has(r.agent_type));
  if (!primary.length) return '';
  return primary.map(r => agentTypeLabel(r.agent_type)).join(' · ');
}
