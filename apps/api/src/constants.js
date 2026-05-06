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

// Packs de créditos vendidos via Stripe Checkout one-time payment.
// Alinhado com 4 packs anunciados na landing (Starter / Pro / Clínica / Enterprise).
const VALID_CREDIT_PACKAGES = [100, 250, 500, 1000];

// Preço de cada pack em CENTAVOS BRL (Stripe usa unit minor amount).
// Mantém alinhamento com a landing — qualquer mudança aqui exige ajustar a landing.
const PRICE_BY_PACK = {
  100: 4990,    // R$ 49,90
  250: 10990,   // R$ 109,90
  500: 19990,   // R$ 199,90
  1000: 37990,  // R$ 379,90
};

// Métodos de pagamento aceitos em /billing/checkout/topup.
const VALID_PAYMENT_METHODS = ['card', 'pix'];

const VALID_MODULES = ['human', 'veterinary', 'estetica'];

const VALID_PROFESSIONAL_TYPES = ['medico', 'esteticista', 'dentista', 'biomedico', 'outro'];

module.exports = {
  VALID_DOCTOR_SPECIALTIES,
  VALID_AGENT_TYPES,
  VALID_CREDIT_PACKAGES,
  PRICE_BY_PACK,
  VALID_PAYMENT_METHODS,
  VALID_MODULES,
  VALID_PROFESSIONAL_TYPES,
};
