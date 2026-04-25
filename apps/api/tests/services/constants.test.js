'use strict';
/**
 * Sanity tests pra apps/api/src/constants.js — fonte única de verdade pra
 * validações compartilhadas (specialties, agent_types, credit packages, modules).
 *
 * Esses testes pegam violações silenciosas: alguém adiciona um agent novo no
 * worker, esquece de listar aqui, validação de rota rejeita silenciosamente.
 */

const {
  VALID_DOCTOR_SPECIALTIES,
  VALID_AGENT_TYPES,
  VALID_CREDIT_PACKAGES,
  VALID_MODULES,
} = require('../../src/constants');

describe('constants — VALID_DOCTOR_SPECIALTIES', () => {
  test('é array não-vazio de strings', () => {
    expect(Array.isArray(VALID_DOCTOR_SPECIALTIES)).toBe(true);
    expect(VALID_DOCTOR_SPECIALTIES.length).toBeGreaterThan(0);
    expect(VALID_DOCTOR_SPECIALTIES.every(s => typeof s === 'string' && s.length > 0)).toBe(true);
  });

  test('contém especialidades core esperadas', () => {
    for (const expected of ['cardiologia', 'hematologia', 'endocrinologia', 'clínica_geral', 'pediatria']) {
      expect(VALID_DOCTOR_SPECIALTIES).toContain(expected);
    }
  });

  test('sem duplicatas', () => {
    expect(new Set(VALID_DOCTOR_SPECIALTIES).size).toBe(VALID_DOCTOR_SPECIALTIES.length);
  });
});

describe('constants — VALID_AGENT_TYPES', () => {
  test('contém os agentes de fase 1 e 2 dos dois módulos', () => {
    // human
    expect(VALID_AGENT_TYPES).toEqual(expect.arrayContaining(['metabolic', 'cardiovascular', 'hematology']));
    // vet
    expect(VALID_AGENT_TYPES).toEqual(expect.arrayContaining(['small_animals', 'equine', 'bovine']));
    // shared phase 2
    expect(VALID_AGENT_TYPES).toEqual(expect.arrayContaining(['therapeutic', 'nutrition']));
  });

  test('sem duplicatas', () => {
    expect(new Set(VALID_AGENT_TYPES).size).toBe(VALID_AGENT_TYPES.length);
  });
});

describe('constants — VALID_CREDIT_PACKAGES', () => {
  test('lista exata de pacotes [100, 250, 500]', () => {
    expect(VALID_CREDIT_PACKAGES).toEqual([100, 250, 500]);
  });

  test('todos números positivos', () => {
    expect(VALID_CREDIT_PACKAGES.every(n => Number.isInteger(n) && n > 0)).toBe(true);
  });
});

describe('constants — VALID_MODULES', () => {
  test('lista exata [human, veterinary]', () => {
    expect(VALID_MODULES.sort()).toEqual(['human', 'veterinary'].sort());
  });
});
