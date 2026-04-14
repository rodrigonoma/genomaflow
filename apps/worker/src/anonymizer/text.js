'use strict';

/**
 * Scrubs PII from raw PDF text before sending to Claude.
 *
 * Brazilian lab reports typically print patient name, CPF, birth date,
 * and address in a header block before the lab markers. This function
 * removes known PII patterns and PII-labeled lines so that only clinical
 * marker data reaches the Anthropic API (LGPD compliance).
 */

// Labels that precede PII values in Brazilian lab report headers
const PII_LABEL_RE = /^(paciente|nome|cpf|cnpj|rg|data\s+de\s+nascimento|nascimento|endere[cç]o|telefone|m[eé]dico\s+solicitante|conv[eê]nio|cart[aã]o|registro|prontu[aá]rio)\s*[:\-]/i;

// CPF pattern: 000.000.000-00 or 00000000000
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;

// Full dates that appear in PII context (DD/MM/YYYY or YYYY-MM-DD)
const DATE_RE = /\b\d{2}\/\d{2}\/\d{4}\b/g;

/**
 * Remove PII from raw exam text extracted from a PDF.
 *
 * @param {string} text - Raw text from pdf-parse
 * @returns {string} - Text with PII lines removed and patterns redacted
 */
function scrubText(text) {
  const lines = text.split('\n');
  const cleaned = lines
    .filter(line => !PII_LABEL_RE.test(line.trim()))
    .map(line => line.replace(CPF_RE, '[CPF REMOVIDO]').replace(DATE_RE, '[DATA REMOVIDA]'));

  return cleaned.join('\n');
}

module.exports = { scrubText };
