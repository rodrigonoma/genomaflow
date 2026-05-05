'use strict';

// POST /onboarding/checkout — rota PÚBLICA, fluxo single-shot do onboarding.
//
// Decisão (Option E, 2026-05-04): NÃO grava nada no banco. Tenant + user só
// são criados pelo webhook checkout.session.completed quando o pagamento
// realmente confirmar (vide handleOnboardingSubscriptionCompleted em
// services/billing-events.js).
//
// Motivação: o fluxo anterior chamava /auth/register antes de pagamento e
// criava tenant 'pending_payment' + user 'admin'. Se o usuário desistia, o
// orfão ficava no banco (mais reports de "email já cadastrado" no retry,
// audit poluído, suporte). Agora se o pagamento falha, ZERO efeito colateral.
//
// Toda a info do onboarding viaja na metadata da Checkout Session do Stripe
// (limites: 50 keys, 40 char keys, 500 char values). Hash bcrypt = 60 chars.
// Stripe é trusted third party pra PII (já recebe email + name); transmitir
// password_hash bcrypt(12) é aceitável — atacker que comprometer Stripe já
// tem dados muito piores.

const bcrypt = require('bcrypt');
const { VALID_MODULES, VALID_AGENT_TYPES } = require('../constants');
const stripeClient = require('../services/stripe-client');

module.exports = async function (fastify) {
  fastify.post('/onboarding/checkout', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const { clinic_name, email: rawEmail, password, module: mod, specialties } = request.body || {};

    if (!clinic_name || !rawEmail || !password || !mod || !Array.isArray(specialties)) {
      return reply.status(400).send({ error: 'Campos obrigatórios: clinic_name, email, password, module, specialties' });
    }
    const email = rawEmail.toLowerCase().trim();
    const cleanClinicName = String(clinic_name).trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.status(400).send({ error: 'Formato de email inválido' });
    }
    if (password.length < 8) {
      return reply.status(400).send({ error: 'Senha deve ter no mínimo 8 caracteres' });
    }
    if (!VALID_MODULES.includes(mod)) {
      return reply.status(400).send({ error: 'Módulo inválido. Use: human ou veterinary' });
    }
    if (specialties.length === 0) {
      return reply.status(400).send({ error: 'Selecione ao menos 1 especialidade' });
    }
    const invalid = specialties.filter(s => !VALID_AGENT_TYPES.includes(s));
    if (invalid.length > 0) {
      return reply.status(400).send({ error: `Especialidades inválidas: ${invalid.join(', ')}` });
    }
    if (!cleanClinicName || cleanClinicName.length > 100) {
      return reply.status(400).send({ error: 'Nome da clínica deve ter entre 1 e 100 caracteres' });
    }

    // Pré-checagem antes do Stripe — evita usuário pagar e ficar travado no
    // login depois (webhook abortaria por email duplicado).
    const existing = await fastify.pg.query(
      'SELECT id FROM users WHERE LOWER(email) = $1',
      [email]
    );
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: 'Email já cadastrado. Faça login ou use outro email.' });
    }

    const priceId = process.env.STRIPE_PRICE_SUBSCRIPTION;
    if (!priceId) {
      fastify.log.error('STRIPE_PRICE_SUBSCRIPTION não configurada');
      return reply.status(500).send({ error: 'Pagamento indisponível — configuração ausente' });
    }
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.genomaflow.com.br';

    const password_hash = await bcrypt.hash(password, 12);

    // Specialties como CSV cabe em metadata (8 agentes max ~120 chars).
    const specialtiesStr = specialties.join(',');
    if (specialtiesStr.length > 500) {
      return reply.status(400).send({ error: 'Especialidades excedem limite de tamanho' });
    }

    // Customer novo a cada onboarding — não tentamos reusar via search por
    // email pq o email pode ter sido usado em onboarding cancelado anterior
    // (Customer Stripe órfão é barato; tenant órfão no DB era o problema).
    const stripe = stripeClient.getClient();
    const customer = await stripe.customers.create({
      email,
      name: cleanClinicName,
      metadata: { origin: 'onboarding' },
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_types: ['card'],
      metadata: {
        origin: 'onboarding',
        email,
        clinic_name: cleanClinicName,
        password_hash,
        module: mod,
        specialties: specialtiesStr,
      },
      // Subscription metadata replicada pra invoice.paid futuro encontrar tenant.
      // Mas tenant_id ainda não existe — preenchemos depois via Stripe Update API
      // no handleOnboardingSubscriptionCompleted.
      subscription_data: {
        metadata: { origin: 'onboarding', email },
      },
      success_url: `${frontendUrl}/login?activated=true`,
      cancel_url: `${frontendUrl}/onboarding?cancelled=true`,
    });

    return { url: session.url, session_id: session.id };
  });
};
