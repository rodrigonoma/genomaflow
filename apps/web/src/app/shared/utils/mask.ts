/**
 * Helpers de máscara para campos brasileiros (display-only).
 * Todos aplicam sobre o input do usuário e retornam a string formatada.
 * Use unmask() para extrair apenas dígitos antes de enviar ao backend.
 */

export function unmask(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
}

/**
 * CPF: 000.000.000-00 (até 11 dígitos)
 */
export function formatCpf(value: string | null | undefined): string {
  const d = unmask(value).slice(0, 11);
  if (d.length <= 3)  return d;
  if (d.length <= 6)  return `${d.slice(0,3)}.${d.slice(3)}`;
  if (d.length <= 9)  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
}

/**
 * Telefone: (00) 00000-0000 (11 dígitos) ou (00) 0000-0000 (10).
 */
export function formatPhone(value: string | null | undefined): string {
  const d = unmask(value).slice(0, 11);
  if (d.length <= 2)  return d.length ? `(${d}` : '';
  if (d.length <= 6)  return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}

/**
 * CEP: 00000-000 (8 dígitos)
 */
export function formatCep(value: string | null | undefined): string {
  const d = unmask(value).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0,5)}-${d.slice(5)}`;
}
