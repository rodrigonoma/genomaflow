'use strict';

const VALID_DOCTOR_SPECIALTIES = [
  'endocrinologia', 'cardiologia', 'hematologia', 'clínica_geral', 'nutrição',
  'nefrologia', 'hepatologia', 'gastroenterologia', 'ginecologia', 'urologia',
  'pediatria', 'neurologia', 'ortopedia', 'pneumologia', 'reumatologia',
  'oncologia', 'infectologia', 'dermatologia', 'psiquiatria', 'geriatria',
  'medicina_esporte'
];

const VALID_AGENT_TYPES = [
  'metabolic', 'cardiovascular', 'hematology', 'small_animals', 'equine',
  'bovine', 'therapeutic', 'nutrition'
];

const VALID_CREDIT_PACKAGES = [100, 250, 500];

const VALID_MODULES = ['human', 'veterinary'];

module.exports = { VALID_DOCTOR_SPECIALTIES, VALID_AGENT_TYPES, VALID_CREDIT_PACKAGES, VALID_MODULES };
