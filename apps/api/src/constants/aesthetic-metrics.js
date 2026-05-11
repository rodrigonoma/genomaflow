'use strict';

// Catálogo de métricas por região anatômica. Usado pelo agente IA pra
// saber quais métricas avaliar + pelo frontend pra renderizar UI.
// Métricas em kebab_case minúsculo, alinhadas com indications em
// aesthetic_treatments (F3).

const REGION_METRICS = {
  facial: [
    'rugas', 'firmeza', 'elasticidade', 'textura', 'manchas',
    'poros', 'olheiras', 'vermelhidao', 'uniformidade_tom',
    'acne', 'simetria',
  ],
  eyelids: [
    'ptose_superior', 'bolsas_inferiores', 'hooding',
    'rugas_periorbital', 'flacidez_palpebra_superior',
  ],
  neck: [
    'rugas_pescoco', 'flacidez_pescoco', 'manchas_pescoco',
    'papada', 'textura_pescoco',
  ],
  breast: [
    'ptose_mamaria', 'simetria_mamaria', 'volume_aparente',
    'qualidade_pele_torax',
  ],
  arms: [
    'flacidez_triceps', 'manchas_brazos', 'textura_brazos',
    'celulite_brazos', 'firmeza_brazos',
  ],
  abdomen: [
    'flacidez_abdominal', 'estrias_abdominais', 'manchas_abdominais',
    'volume_aparente_abdomen', 'diastase_visivel',
  ],
  legs: [
    'culote_esquerdo', 'culote_direito', 'celulite_coxas',
    'estrias_coxas', 'firmeza_coxas', 'flacidez_interna_coxa',
  ],
  glutes: [
    'firmeza_gluteos', 'celulite_gluteos', 'estrias_gluteos',
    'projecao_glutea',
  ],
  full_body: [
    'proporcao_corporal', 'postura_visual', 'simetria_global',
    'volume_aparente_global',
  ],
  other: [],
};

const VALID_ANALYSIS_TYPES = Object.keys(REGION_METRICS);

const SENSITIVE_REGIONS = ['breast', 'glutes', 'abdomen'];

function metricsForRegion(region) {
  return REGION_METRICS[region] || [];
}

function isValidMetric(region, metric) {
  return metricsForRegion(region).includes(metric);
}

module.exports = {
  REGION_METRICS,
  VALID_ANALYSIS_TYPES,
  SENSITIVE_REGIONS,
  metricsForRegion,
  isValidMetric,
};
