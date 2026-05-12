'use strict';

const { describe, test, expect } = require('@jest/globals');
const { computeTMB, computeCalories, computeMacros, computeAll, ACTIVITY_FACTOR, GOAL_ADJUSTMENT } = require('../../src/lib/tmb');

describe('computeTMB', () => {
  test('calcula TMB correto para homem', () => {
    // 10*80 + 6.25*175 - 5*30 + 5 = 800 + 1093.75 - 150 + 5 = 1748.75
    const tmb = computeTMB({ height_cm: 175, weight_kg: 80, age: 30, sex: 'M' });
    expect(tmb).toBeCloseTo(1748.75, 1);
  });

  test('calcula TMB correto para mulher', () => {
    // 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25
    const tmb = computeTMB({ height_cm: 165, weight_kg: 60, age: 25, sex: 'F' });
    expect(tmb).toBeCloseTo(1345.25, 1);
  });

  test('retorna null para input inválido (sem sex)', () => {
    const tmb = computeTMB({ height_cm: 170, weight_kg: 70, age: 30, sex: 'X' });
    expect(tmb).toBeNull();
  });

  test('retorna null se height_cm for string', () => {
    const tmb = computeTMB({ height_cm: '170', weight_kg: 70, age: 30, sex: 'M' });
    expect(tmb).toBeNull();
  });

  test('retorna null se age for NaN', () => {
    const tmb = computeTMB({ height_cm: 170, weight_kg: 70, age: NaN, sex: 'F' });
    expect(tmb).toBeNull();
  });

  test('retorna null se input parcial', () => {
    const tmb = computeTMB({ height_cm: 170, weight_kg: 70, sex: 'M' });
    expect(tmb).toBeNull();
  });
});

describe('computeCalories', () => {
  test('aplica fator de atividade moderado e goal wellness', () => {
    const calories = computeCalories({ tmb: 1500, activity_level: 'moderate', primary_goal: 'wellness' });
    // 1500 * 1.55 * 1.00 = 2325
    expect(calories).toBe(2325);
  });

  test('aplica fator de atividade sedentary e goal fat_loss', () => {
    const calories = computeCalories({ tmb: 1500, activity_level: 'sedentary', primary_goal: 'fat_loss' });
    // 1500 * 1.2 * 0.80 = 1440
    expect(calories).toBe(1440);
  });

  test('retorna null se tmb for null', () => {
    const calories = computeCalories({ tmb: null });
    expect(calories).toBeNull();
  });

  test('usa moderate como fallback quando activity_level é desconhecido', () => {
    const calories = computeCalories({ tmb: 1500, activity_level: 'unknown_level', primary_goal: 'wellness' });
    // 1500 * 1.55 * 1.00 = 2325
    expect(calories).toBe(2325);
  });
});

describe('computeMacros', () => {
  test('macros para wellness (25p/45c/30f)', () => {
    const macros = computeMacros({ calories: 2000, primary_goal: 'wellness' });
    expect(macros.protein_g).toBe(Math.round((2000 * 0.25) / 4));  // 125
    expect(macros.carbs_g).toBe(Math.round((2000 * 0.45) / 4));    // 225
    expect(macros.fat_g).toBe(Math.round((2000 * 0.30) / 9));      // 67
  });

  test('macros para fat_loss (30p/40c/30f — mais proteína)', () => {
    const macros = computeMacros({ calories: 2000, primary_goal: 'fat_loss' });
    expect(macros.protein_g).toBe(Math.round((2000 * 0.30) / 4));  // 150
    expect(macros.carbs_g).toBe(Math.round((2000 * 0.40) / 4));    // 200
  });

  test('macros para mass (25p/50c/25f — mais carbos)', () => {
    const macros = computeMacros({ calories: 2000, primary_goal: 'mass' });
    expect(macros.carbs_g).toBe(Math.round((2000 * 0.50) / 4));    // 250
    expect(macros.fat_g).toBe(Math.round((2000 * 0.25) / 9));      // 56
  });

  test('retorna null se calories for null', () => {
    expect(computeMacros({ calories: null })).toBeNull();
  });
});

describe('computeAll', () => {
  test('retorna tmb/calories/macros/primary_goal para perfil completo masculino', () => {
    const result = computeAll({
      height_cm: 175, weight_kg: 80, age: 30, sex: 'M',
      activity_level: 'moderate', goals: ['wellness'],
    });
    expect(result).not.toBeNull();
    expect(result.tmb).toBeGreaterThan(0);
    expect(result.calories).toBeGreaterThan(0);
    expect(result.macros).toHaveProperty('protein_g');
    expect(result.macros).toHaveProperty('carbs_g');
    expect(result.macros).toHaveProperty('fat_g');
    expect(result.primary_goal).toBe('wellness');
  });

  test('retorna tmb/calories/macros para perfil feminino com goal fat_loss', () => {
    const result = computeAll({
      height_cm: 165, weight_kg: 60, age: 25, sex: 'F',
      activity_level: 'light', goals: ['fat_loss'],
    });
    expect(result).not.toBeNull();
    expect(result.primary_goal).toBe('fat_loss');
    // Fat loss macro: proteína maior (30%)
    expect(result.macros.protein_g).toBe(Math.round((result.calories * 0.30) / 4));
  });

  test('retorna null se perfil incompleto (sem sex)', () => {
    const result = computeAll({ height_cm: 170, weight_kg: 70, age: 28 });
    expect(result).toBeNull();
  });

  test('usa wellness como goal padrão quando goals está vazio', () => {
    const result = computeAll({
      height_cm: 170, weight_kg: 70, age: 28, sex: 'M',
      goals: [],
    });
    expect(result).not.toBeNull();
    expect(result.primary_goal).toBe('wellness');
  });

  test('primary_goal pega o primeiro item do array goals', () => {
    const result = computeAll({
      height_cm: 170, weight_kg: 70, age: 28, sex: 'M',
      goals: ['tone', 'wellness'],
    });
    expect(result.primary_goal).toBe('tone');
  });
});
