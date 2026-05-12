'use strict';

// Mifflin-St Jeor TMB formula — gold standard for adult BMR estimation
// TMB (homem)  = 10·peso(kg) + 6.25·altura(cm) − 5·idade + 5
// TMB (mulher) = 10·peso(kg) + 6.25·altura(cm) − 5·idade − 161
// Calorias diárias = TMB × activity_factor × goal_adjustment

const ACTIVITY_FACTOR = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const GOAL_ADJUSTMENT = {
  fat_loss: 0.80,    // 20% deficit
  tone: 0.95,        // 5% deficit
  wellness: 1.00,    // maintenance
  mass: 1.10,        // 10% surplus
};

const VALID_SEX = new Set(['F', 'M']);
const VALID_ACTIVITY = new Set(Object.keys(ACTIVITY_FACTOR));
const VALID_GOALS = new Set(Object.keys(GOAL_ADJUSTMENT));

function computeTMB({ height_cm, weight_kg, age, sex }) {
  if (![height_cm, weight_kg, age].every(v => typeof v === 'number' && Number.isFinite(v))) {
    return null;
  }
  if (!VALID_SEX.has(sex)) return null;
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age;
  return sex === 'M' ? base + 5 : base - 161;
}

function computeCalories({ tmb, activity_level = 'moderate', primary_goal = 'wellness' }) {
  if (tmb == null) return null;
  const af = ACTIVITY_FACTOR[activity_level] ?? ACTIVITY_FACTOR.moderate;
  const ga = GOAL_ADJUSTMENT[primary_goal] ?? GOAL_ADJUSTMENT.wellness;
  return Math.round(tmb * af * ga);
}

function computeMacros({ calories, primary_goal = 'wellness' }) {
  if (calories == null) return null;
  // Macros conservadores: protein-forward para fat_loss/tone, balanceado pra wellness
  // Defaults: 25% protein, 45% carbs, 30% fat — ajustes leves por goal
  let pPct = 0.25, cPct = 0.45, fPct = 0.30;
  if (primary_goal === 'fat_loss' || primary_goal === 'tone') {
    pPct = 0.30; cPct = 0.40; fPct = 0.30;
  } else if (primary_goal === 'mass') {
    pPct = 0.25; cPct = 0.50; fPct = 0.25;
  }
  return {
    protein_g: Math.round((calories * pPct) / 4),
    carbs_g: Math.round((calories * cPct) / 4),
    fat_g: Math.round((calories * fPct) / 9),
  };
}

function computeAll(profile) {
  const tmb = computeTMB(profile);
  if (tmb == null) return null;
  const primary_goal = (Array.isArray(profile.goals) && profile.goals.length)
    ? profile.goals[0]
    : 'wellness';
  const calories = computeCalories({ tmb, activity_level: profile.activity_level, primary_goal });
  const macros = computeMacros({ calories, primary_goal });
  return { tmb: Math.round(tmb), calories, macros };
}

module.exports = {
  computeTMB,
  computeCalories,
  computeMacros,
  computeAll,
  ACTIVITY_FACTOR,
  GOAL_ADJUSTMENT,
  VALID_SEX,
  VALID_ACTIVITY,
  VALID_GOALS,
};
