'use strict';

const { describe, test, expect } = require('@jest/globals');
const { computeTMB, computeCalories, computeMacros, computeAll } = require('../../src/services/aesthetic-tmb');

describe('aesthetic-tmb', () => {
  test('computeTMB Mifflin-St Jeor para mulher 30a 65kg 165cm', () => {
    // 10*65 + 6.25*165 - 5*30 - 161 = 650 + 1031.25 - 150 - 161 = 1370.25
    expect(computeTMB({ height_cm: 165, weight_kg: 65, age: 30, sex: 'F' })).toBeCloseTo(1370.25, 1);
  });

  test('computeTMB para homem 35a 80kg 178cm', () => {
    // 10*80 + 6.25*178 - 5*35 + 5 = 800 + 1112.5 - 175 + 5 = 1742.5
    expect(computeTMB({ height_cm: 178, weight_kg: 80, age: 35, sex: 'M' })).toBeCloseTo(1742.5, 1);
  });

  test('computeTMB retorna null com input inválido (height_cm null)', () => {
    expect(computeTMB({ height_cm: null, weight_kg: 65, age: 30, sex: 'F' })).toBeNull();
  });

  test('computeTMB retorna null com sex inválido', () => {
    expect(computeTMB({ height_cm: 165, weight_kg: 65, age: 30, sex: 'X' })).toBeNull();
  });

  test('computeTMB retorna null com NaN', () => {
    expect(computeTMB({ height_cm: NaN, weight_kg: 65, age: 30, sex: 'F' })).toBeNull();
  });

  test('computeCalories aplica activity + goal', () => {
    // tmb=1370 × 1.55 (moderate) × 0.80 (fat_loss) = 1370 * 1.55 * 0.80 = 1698.8 → round 1699
    expect(computeCalories({ tmb: 1370, activity_level: 'moderate', primary_goal: 'fat_loss' })).toBe(1699);
  });

  test('computeCalories usa defaults quando activity e goal omitidos', () => {
    // tmb=1370 × 1.55 (moderate) × 1.00 (wellness) = 2123.5 → round 2124
    expect(computeCalories({ tmb: 1370 })).toBe(2124);
  });

  test('computeCalories retorna null para tmb null', () => {
    expect(computeCalories({ tmb: null })).toBeNull();
  });

  test('computeMacros distribui 30/40/30 para fat_loss', () => {
    const m = computeMacros({ calories: 2000, primary_goal: 'fat_loss' });
    expect(m.protein_g).toBe(150);  // 2000*0.30/4 = 150
    expect(m.carbs_g).toBe(200);    // 2000*0.40/4 = 200
    expect(m.fat_g).toBeCloseTo(67, 0); // 2000*0.30/9 ≈ 66.67
  });

  test('computeMacros distribui 25/50/25 para mass', () => {
    const m = computeMacros({ calories: 2000, primary_goal: 'mass' });
    expect(m.protein_g).toBe(125);  // 2000*0.25/4
    expect(m.carbs_g).toBe(250);    // 2000*0.50/4
    expect(m.fat_g).toBeCloseTo(56, 0); // 2000*0.25/9
  });

  test('computeMacros retorna null para calories null', () => {
    expect(computeMacros({ calories: null })).toBeNull();
  });

  test('computeAll integra TMB + calorias + macros para mulher wellness moderate', () => {
    const r = computeAll({ height_cm: 165, weight_kg: 65, age: 30, sex: 'F', activity_level: 'moderate', goals: ['wellness'] });
    expect(r).not.toBeNull();
    expect(r.tmb).toBe(1370);
    expect(r.calories).toBeGreaterThan(2000);
    expect(r.calories).toBeLessThan(2200);
    expect(r.macros.protein_g).toBeGreaterThan(0);
  });

  test('computeAll retorna null se perfil incompleto (sem sex)', () => {
    const r = computeAll({ height_cm: 165, weight_kg: 65, age: 30 });
    expect(r).toBeNull();
  });

  test('computeAll usa primeiro goal do array', () => {
    const r = computeAll({ height_cm: 165, weight_kg: 65, age: 30, sex: 'F', activity_level: 'moderate', goals: ['fat_loss', 'wellness'] });
    expect(r).not.toBeNull();
    // fat_loss → calories devem ser menores que wellness (0.80 vs 1.00)
    const rWellness = computeAll({ height_cm: 165, weight_kg: 65, age: 30, sex: 'F', activity_level: 'moderate', goals: ['wellness'] });
    expect(r.calories).toBeLessThan(rWellness.calories);
  });
});
