'use strict';

const { describe, test, expect } = require('@jest/globals');

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic { constructor() {} messages = { create: mockCreate }; },
}));

const { recommendProtocol, sanitizeRecommendations, normalize, resolveCanonical, TREATMENT_SYNONYMS } = require('../../src/agents/aesthetic-recommender');

describe('recommendProtocol', () => {
  test('retorna recommendations + tokens', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Microagulhamento',
          target_metric: 'rugas',
          indication_text: 'Estímulo de colágeno pra rugas dinâmicas',
          sessions_recommended: 3,
          interval_days: 30,
          urgency: 'medium',
          expected_outcome: 'Melhora visível em 3 sessões',
        }],
        lifestyle_recommendations: {
          estimated_daily_calories_kcal: 1800,
          hydration_ml_per_day: 2500,
          disclaimer: 'Consulte nutricionista (CRN)',
        },
        summary_for_patient: 'Plano simples...',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });
    const result = await recommendProtocol({
      metrics: { rugas: { score: 70, regions: [] } },
      subject: { age_years: 40, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
    });
    expect(result.recommendations.treatment_protocol).toHaveLength(1);
    expect(result.tokens_output).toBe(400);
  });

  test('esteticista NÃO recebe sugestões que requerem medico', () => {
    const raw = {
      treatment_protocol: [
        { treatment_name: 'Botox', requires_medico: true, target_metric: 'rugas' },
        { treatment_name: 'Microagulhamento', requires_medico: false, target_metric: 'rugas' },
      ],
    };
    const clean = sanitizeRecommendations(raw, 'esteticista');
    expect(clean.treatment_protocol).toHaveLength(1);
    expect(clean.treatment_protocol[0].treatment_name).toBe('Microagulhamento');
  });

  test('medico recebe tudo', () => {
    const raw = {
      treatment_protocol: [
        { treatment_name: 'Botox', requires_medico: true, target_metric: 'rugas' },
        { treatment_name: 'Microagulhamento', requires_medico: false, target_metric: 'rugas' },
      ],
    };
    const clean = sanitizeRecommendations(raw, 'medico');
    expect(clean.treatment_protocol).toHaveLength(2);
  });

  test('disclaimer nutrição sempre presente quando lifestyle existe', () => {
    const raw = {
      lifestyle_recommendations: { estimated_daily_calories_kcal: 2000 },
    };
    const clean = sanitizeRecommendations(raw, 'medico');
    expect(clean.lifestyle_recommendations.disclaimer).toBeDefined();
    expect(clean.lifestyle_recommendations.disclaimer).toMatch(/nutricionista|CRN/i);
  });

  test('clamp sessions + interval pra valores razoáveis', () => {
    const raw = {
      treatment_protocol: [{
        treatment_name: 'X', target_metric: 'rugas',
        sessions_recommended: 100, interval_days: -10,
        requires_medico: false,
      }],
    };
    const clean = sanitizeRecommendations(raw, 'medico');
    expect(clean.treatment_protocol[0].sessions_recommended).toBeLessThanOrEqual(20);
    expect(clean.treatment_protocol[0].interval_days).toBeGreaterThanOrEqual(7);
  });

  test('BAD_LLM_OUTPUT em JSON inválido', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: 'lorem ipsum não é json' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await expect(recommendProtocol({
      metrics: { rugas: { score: 70 } },
      subject: { age_years: 30, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
    })).rejects.toMatchObject({ code: 'BAD_LLM_OUTPUT' });
  });

  test('catalog matching: nome exato (case-insensitive) enriquece com treatment_id e in_catalog=true', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Microagulhamento',
          target_metric: 'rugas',
          indication_text: 'Estímulo de colágeno',
          sessions_recommended: 3,
          interval_days: 30,
          urgency: 'medium',
          expected_outcome: 'Melhora em 3 sessões',
          requires_medico: false,
        }],
        lifestyle_recommendations: {},
        summary_for_patient: 'Plano teste',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });

    const availableTreatments = [
      { id: 'cat-uuid-001', name: 'Microagulhamento', category: 'skin', requires_medico: false },
      { id: 'cat-uuid-002', name: 'Botox', category: 'injectable', requires_medico: true },
    ];

    const result = await recommendProtocol({
      metrics: { rugas: { score: 70 } },
      subject: { age_years: 40, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
      availableTreatments,
    });

    const tx = result.recommendations.treatment_protocol[0];
    expect(tx.treatment_id).toBe('cat-uuid-001');
    expect(tx.in_catalog).toBe(true);
    // requires_medico deve vir do catálogo, não do LLM
    expect(tx.requires_medico).toBe(false);
  });

  test('catalog matching: nome fora do catálogo → in_catalog=false, sem treatment_id', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Tratamento Novo XYZ',
          target_metric: 'rugas',
          indication_text: 'Tratamento experimental',
          sessions_recommended: 2,
          interval_days: 45,
          urgency: 'low',
          expected_outcome: 'Resultado hipotético',
          requires_medico: false,
        }],
        lifestyle_recommendations: {},
        summary_for_patient: 'Plano teste',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });

    const availableTreatments = [
      { id: 'cat-uuid-001', name: 'Microagulhamento', category: 'skin', requires_medico: false },
    ];

    const result = await recommendProtocol({
      metrics: { rugas: { score: 70 } },
      subject: { age_years: 40, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
      availableTreatments,
    });

    const tx = result.recommendations.treatment_protocol[0];
    expect(tx.in_catalog).toBe(false);
    expect(tx.treatment_id).toBeUndefined();
  });

  test('sem availableTreatments → comportamento legacy (in_catalog=false no sanitize, sem treatment_id)', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Microagulhamento',
          target_metric: 'rugas',
          indication_text: 'Estímulo de colágeno',
          sessions_recommended: 3,
          interval_days: 30,
          urgency: 'medium',
          expected_outcome: 'Melhora em 3 sessões',
          requires_medico: false,
        }],
        lifestyle_recommendations: {},
        summary_for_patient: 'Plano teste',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });

    const result = await recommendProtocol({
      metrics: { rugas: { score: 70 } },
      subject: { age_years: 40, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
      // availableTreatments omitido — comportamento F1/F2 legacy
    });

    const tx = result.recommendations.treatment_protocol[0];
    expect(tx.treatment_id).toBeUndefined();
    // in_catalog=false vem do sanitizeTreatment (valor padrão para o campo)
    expect(tx.in_catalog).toBe(false);
  });
});

// ===========================================================================
// F4: aestheticProfile + computedNutrition
// ===========================================================================

describe('recommendProtocol — F4 aestheticProfile + nutrition', () => {
  test('aestheticProfile vazio → lifestyle é sanitizado normalmente (sem fallback de computedNutrition)', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [],
        lifestyle_recommendations: null,
        summary_for_patient: 'Sem perfil nutricional',
      })}],
      usage: { input_tokens: 500, output_tokens: 200 },
    });

    const result = await recommendProtocol({
      metrics: { rugas: { score: 60 } },
      subject: { age_years: 35, sex: 'F', aesthetic_profile: {} },
      professionalType: 'medico',
      aestheticProfile: {},      // vazio
      computedNutrition: null,   // sem cálculo
    });

    // Quando LLM retorna null e computedNutrition é null → lifestyle_recommendations é null
    expect(result.recommendations.lifestyle_recommendations).toBeNull();
  });

  test('computedNutrition presente → prompt contém calorias + macros + instrução de uso exato', async () => {
    let capturedPrompt = '';
    mockCreate.mockImplementationOnce(async (params) => {
      capturedPrompt = params.messages[0].content;
      return {
        content: [{ text: JSON.stringify({
          treatment_protocol: [],
          lifestyle_recommendations: {
            estimated_daily_calories_kcal: 2000,
            macro_distribution_g: { protein: 125, carbs: 225, fat: 67 },
            hydration_ml_per_day: 2100,
            foods_to_emphasize: ['frango', 'aveia'],
            foods_to_minimize: ['açúcar', 'frituras'],
          },
          summary_for_patient: 'Ok',
        })}],
        usage: { input_tokens: 900, output_tokens: 400 },
      };
    });

    const computedNutrition = { tmb: 1400, calories: 2170, macros: { protein_g: 136, carbs_g: 244, fat_g: 72 }, primary_goal: 'wellness' };

    await recommendProtocol({
      metrics: { rugas: { score: 60 } },
      subject: { age_years: 35, sex: 'F', aesthetic_profile: {} },
      professionalType: 'medico',
      aestheticProfile: { height_cm: 165, weight_kg: 60, age: 35, sex: 'F', activity_level: 'moderate', goals: ['wellness'] },
      computedNutrition,
    });

    // Prompt deve conter os valores pré-computados
    expect(capturedPrompt).toContain('2170');
    expect(capturedPrompt).toContain('1400');
    expect(capturedPrompt).toContain('NÃO recalcule');
  });

  test('CRN disclaimer sempre presente no lifestyle, mesmo quando LLM não retorna disclaimer', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [],
        lifestyle_recommendations: {
          estimated_daily_calories_kcal: 1800,
          // Sem disclaimer — LLM esqueceu
        },
        summary_for_patient: 'Ok',
      })}],
      usage: { input_tokens: 500, output_tokens: 200 },
    });

    const result = await recommendProtocol({
      metrics: { rugas: { score: 60 } },
      subject: { age_years: 35, sex: 'F', aesthetic_profile: {} },
      professionalType: 'medico',
    });

    expect(result.recommendations.lifestyle_recommendations).not.toBeNull();
    expect(result.recommendations.lifestyle_recommendations.disclaimer).toMatch(/CRN/);
    expect(result.recommendations.lifestyle_recommendations.disclaimer).toMatch(/nutricionista/i);
  });

  test('sanitização: calories absurda (99999) → clamp para 5000', () => {
    const raw = {
      lifestyle_recommendations: {
        estimated_daily_calories_kcal: 99999,
        macro_distribution_g: { protein: 50, carbs: 100, fat: 40 },
      },
    };
    const clean = sanitizeRecommendations(raw, 'medico', null);
    expect(clean.lifestyle_recommendations.estimated_daily_calories_kcal).toBe(5000);
  });

  test('sanitização: calories muito baixa (100) → clamp para 800', () => {
    const raw = {
      lifestyle_recommendations: {
        estimated_daily_calories_kcal: 100,
      },
    };
    const clean = sanitizeRecommendations(raw, 'medico', null);
    expect(clean.lifestyle_recommendations.estimated_daily_calories_kcal).toBe(800);
  });

  test('LLM não retorna lifestyle + computedNutrition presente → fallback com valores do backend', () => {
    const raw = {
      lifestyle_recommendations: null,
    };
    const computedNutrition = {
      tmb: 1400,
      calories: 2170,
      macros: { protein_g: 136, carbs_g: 244, fat_g: 72 },
      primary_goal: 'wellness',
    };
    const clean = sanitizeRecommendations(raw, 'medico', computedNutrition);
    expect(clean.lifestyle_recommendations).not.toBeNull();
    expect(clean.lifestyle_recommendations.estimated_daily_calories_kcal).toBe(2170);
    expect(clean.lifestyle_recommendations.macro_distribution_g.protein).toBe(136);
    expect(clean.lifestyle_recommendations.disclaimer).toMatch(/CRN/);
  });

  test('hydration clamp: abaixo de 1500 → 1500; acima de 4000 → 4000', () => {
    const rawLow = { lifestyle_recommendations: { estimated_daily_calories_kcal: 2000, hydration_ml_per_day: 500 } };
    const cleanLow = sanitizeRecommendations(rawLow, 'medico', null);
    expect(cleanLow.lifestyle_recommendations.hydration_ml_per_day).toBe(1500);

    const rawHigh = { lifestyle_recommendations: { estimated_daily_calories_kcal: 2000, hydration_ml_per_day: 9999 } };
    const cleanHigh = sanitizeRecommendations(rawHigh, 'medico', null);
    expect(cleanHigh.lifestyle_recommendations.hydration_ml_per_day).toBe(4000);
  });

  test('foods arrays: truncados a 15 itens, strings cortadas em 80 chars', () => {
    const longStr = 'a'.repeat(200);
    const manyFoods = Array.from({ length: 20 }, (_, i) => `food_${i}`);
    const raw = {
      lifestyle_recommendations: {
        estimated_daily_calories_kcal: 2000,
        foods_to_emphasize: [...manyFoods, longStr],
        foods_to_minimize: [longStr],
      },
    };
    const clean = sanitizeRecommendations(raw, 'medico', null);
    expect(clean.lifestyle_recommendations.foods_to_emphasize.length).toBeLessThanOrEqual(15);
    expect(clean.lifestyle_recommendations.foods_to_minimize[0].length).toBeLessThanOrEqual(80);
  });
});

// ===========================================================================
// TODO#3: normalize() + synonym matching (diacritic-insensitive + brand names)
// ===========================================================================

describe('normalize()', () => {
  test('strip acentos: Análise → analise', () => {
    expect(normalize('Análise')).toBe('analise');
  });

  test('collapse espaços + trim + lowercase', () => {
    expect(normalize('  Botox   Cosmético  ')).toBe('botox cosmetico');
  });

  test('string vazia retorna string vazia', () => {
    expect(normalize('')).toBe('');
  });

  test('non-string retorna string vazia', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
    expect(normalize(42)).toBe('');
  });

  test('Toxina Botulínica normaliza igual a Toxina Botulinica', () => {
    expect(normalize('Toxina Botulínica')).toBe(normalize('Toxina Botulinica'));
  });
});

describe('TREATMENT_SYNONYMS + resolveCanonical()', () => {
  test('botox resolve para toxina botulinica', () => {
    expect(resolveCanonical('botox')).toBe('toxina botulinica');
  });

  test('nome sem synonym retorna o mesmo nome', () => {
    expect(resolveCanonical('microagulhamento')).toBe('microagulhamento');
  });

  test('TREATMENT_SYNONYMS tem entradas para marcas principais BR', () => {
    // Toxina Botulínica brands
    expect(TREATMENT_SYNONYMS.get('botox')).toBe('toxina botulinica');
    expect(TREATMENT_SYNONYMS.get('dysport')).toBe('toxina botulinica');
    expect(TREATMENT_SYNONYMS.get('xeomin')).toBe('toxina botulinica');
    // RF Microagulhada brands
    expect(TREATMENT_SYNONYMS.get('morpheus8')).toBe('radiofrequencia microagulhada');
    expect(TREATMENT_SYNONYMS.get('vivace')).toBe('radiofrequencia microagulhada');
    // HIFU brands
    expect(TREATMENT_SYNONYMS.get('ultraformer')).toBe('hifu facial');
    expect(TREATMENT_SYNONYMS.get('ultherapy')).toBe('hifu facial');
    // Bioestimulador brands
    expect(TREATMENT_SYNONYMS.get('sculptra')).toBe('bioestimulador de colageno');
    expect(TREATMENT_SYNONYMS.get('radiesse')).toBe('bioestimulador de colageno');
  });
});

describe('applyCatalogMatching — diacritic-insensitive + synonyms', () => {
  // Catalog rows mimic what the DB returns (names with proper diacritics as seeded)
  const catalog = [
    { id: 'uuid-toxina',     name: 'Toxina Botulínica',          requires_medico: true  },
    { id: 'uuid-rf',         name: 'Radiofrequência Microagulhada', requires_medico: true },
    { id: 'uuid-micro',      name: 'Microagulhamento',           requires_medico: false },
    { id: 'uuid-bio',        name: 'Bioestimulador de Colágeno', requires_medico: true  },
    { id: 'uuid-ah',         name: 'Ácido Hialurônico Facial',   requires_medico: true  },
    { id: 'uuid-criolipolise', name: 'Criolipólise',             requires_medico: false },
  ];

  test('match diacritic-insensitive: LLM "Toxina Botulinica" (sem acento) bate com catálogo "Toxina Botulínica"', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Toxina Botulinica',   // LLM sem acento
          target_metric: 'rugas',
          indication_text: 'Rugas dinâmicas',
          sessions_recommended: 1,
          interval_days: 120,
          urgency: 'medium',
          expected_outcome: 'Relaxamento muscular',
          requires_medico: false,   // LLM errou — catálogo deve sobrescrever
        }],
        lifestyle_recommendations: {},
        summary_for_patient: 'Teste diacritic',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });

    const result = await recommendProtocol({
      metrics: { rugas: { score: 75 } },
      subject: { age_years: 45, sex: 'F', fitzpatrick_type: 2, aesthetic_profile: {} },
      professionalType: 'medico',
      availableTreatments: catalog,
    });

    const tx = result.recommendations.treatment_protocol[0];
    expect(tx.in_catalog).toBe(true);
    expect(tx.treatment_id).toBe('uuid-toxina');
    expect(tx.requires_medico).toBe(true);  // catálogo sobrescreve LLM
  });

  test('match via synonym: LLM "Botox" → catálogo "Toxina Botulínica"', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Botox',
          target_metric: 'rugas',
          indication_text: 'Rugas da glabela',
          sessions_recommended: 1,
          interval_days: 120,
          urgency: 'medium',
          expected_outcome: 'Suavização das rugas',
          requires_medico: false,
        }],
        lifestyle_recommendations: {},
        summary_for_patient: 'Teste synonym botox',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });

    const result = await recommendProtocol({
      metrics: { rugas: { score: 80 } },
      subject: { age_years: 42, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
      availableTreatments: catalog,
    });

    const tx = result.recommendations.treatment_protocol[0];
    expect(tx.in_catalog).toBe(true);
    expect(tx.treatment_id).toBe('uuid-toxina');
    expect(tx.requires_medico).toBe(true);
  });

  test('match via synonym brand: LLM "Morpheus8" → catálogo "Radiofrequência Microagulhada"', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Morpheus8',
          target_metric: 'firmeza',
          indication_text: 'Flacidez e rugas',
          sessions_recommended: 3,
          interval_days: 45,
          urgency: 'medium',
          expected_outcome: 'Remodelação profunda',
          requires_medico: false,
        }],
        lifestyle_recommendations: {},
        summary_for_patient: 'Teste Morpheus8',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });

    const result = await recommendProtocol({
      metrics: { firmeza: { score: 65 } },
      subject: { age_years: 48, sex: 'F', fitzpatrick_type: 2, aesthetic_profile: {} },
      professionalType: 'medico',
      availableTreatments: catalog,
    });

    const tx = result.recommendations.treatment_protocol[0];
    expect(tx.in_catalog).toBe(true);
    expect(tx.treatment_id).toBe('uuid-rf');
    expect(tx.requires_medico).toBe(true);
  });

  test('off-catalog: LLM "Procedimento Aleatório Y" → in_catalog=false, sem treatment_id', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Procedimento Aleatório Y',
          target_metric: 'rugas',
          indication_text: 'Experimental',
          sessions_recommended: 2,
          interval_days: 30,
          urgency: 'low',
          expected_outcome: 'Hipotético',
          requires_medico: false,
        }],
        lifestyle_recommendations: {},
        summary_for_patient: 'Teste off-catalog',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });

    const result = await recommendProtocol({
      metrics: { rugas: { score: 60 } },
      subject: { age_years: 35, sex: 'F', fitzpatrick_type: 3, aesthetic_profile: {} },
      professionalType: 'medico',
      availableTreatments: catalog,
    });

    const tx = result.recommendations.treatment_protocol[0];
    expect(tx.in_catalog).toBe(false);
    expect(tx.treatment_id).toBeUndefined();
  });

  test('backward compat: catálogo exato com acentos ainda funciona', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        treatment_protocol: [{
          treatment_name: 'Microagulhamento',   // exact match no synonym needed
          target_metric: 'textura',
          indication_text: 'Textura e poros',
          sessions_recommended: 4,
          interval_days: 30,
          urgency: 'medium',
          expected_outcome: 'Melhora de textura',
          requires_medico: false,
        }],
        lifestyle_recommendations: {},
        summary_for_patient: 'Teste exato',
      })}],
      usage: { input_tokens: 800, output_tokens: 400 },
    });

    const result = await recommendProtocol({
      metrics: { textura: { score: 70 } },
      subject: { age_years: 35, sex: 'F', fitzpatrick_type: 2, aesthetic_profile: {} },
      professionalType: 'medico',
      availableTreatments: catalog,
    });

    const tx = result.recommendations.treatment_protocol[0];
    expect(tx.in_catalog).toBe(true);
    expect(tx.treatment_id).toBe('uuid-micro');
    expect(tx.requires_medico).toBe(false);
  });
});
