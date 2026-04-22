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
