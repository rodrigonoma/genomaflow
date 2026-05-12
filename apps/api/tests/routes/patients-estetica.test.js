'use strict';

// Bug 2026-05-12: módulo estetica caía no fluxo veterinary (species required).
// Test garante que o branch human cobre 'human' E 'estetica' juntos.
// Test unit (sem DB) — valida via SQL source inspection.

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'routes', 'patients.js'),
  'utf8'
);

describe('POST /patients — module estetica fix (2026-05-12)', () => {
  test('branch human aceita estetica', () => {
    // Aceita ambas as quotes (single/double) entre os literais
    expect(SOURCE).toMatch(/module === ['"]human['"] \|\| module === ['"]estetica['"]/);
  });

  test('branch human NÃO exige species', () => {
    // O branch human valida só name/birth_date/sex
    expect(SOURCE).toContain("'name, birth_date and sex are required'");
  });

  test('branch veterinary segue exigindo species', () => {
    // Backward compat — vet branch intacto
    expect(SOURCE).toContain("'name, sex and species are required'");
  });

  test('INSERT human grava subject_type=human', () => {
    expect(SOURCE).toMatch(/INSERT INTO subjects[\s\S]*?'human'/);
  });
});
