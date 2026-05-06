---
name: Onboarding pago via /onboarding/checkout — não /auth/register
description: Onboarding real do GenomaFlow é Stripe single-shot via /onboarding/checkout. Tenant + user só são criados pelo webhook após pagamento confirmado. /auth/register é legado/admin
type: feedback
---

# Onboarding pago é via /onboarding/checkout (Stripe single-shot)

**Descoberto durante F1 Aesthetic (2026-05-06).** O plano F1 inicial assumia que o frontend onboarding postava em `/auth/register` — errado. O fluxo real é:

1. Frontend `apps/web/src/app/features/onboarding/onboarding.component.ts` método `goToPayment()` posta em `POST /onboarding/checkout` (não `/auth/register`)
2. Backend `apps/api/src/routes/onboarding-checkout.js` cria Stripe Checkout Session com **toda a info do user na metadata** — tenant + user ainda NÃO existem no DB
3. Cliente paga via Stripe (cartão/PIX)
4. Stripe dispara webhook `checkout.session.completed` → `apps/api/src/services/billing-events.js` `handleOnboardingSubscriptionCompleted`
5. Handler lê metadata + cria tenant + user via INSERT

**Por que importa:** se uma feature nova precisa que algum campo do user/tenant seja capturado no onboarding, **3 lugares** precisam atualizar:
- `routes/onboarding-checkout.js` — extrai do body, valida, passa pra Stripe metadata
- `services/billing-events.js` `handleOnboardingSubscriptionCompleted` — lê metadata, inclui no INSERT
- `routes/auth.js` `/register` — mantém compat retro pra admin/internal flows (legado)

`/auth/register` ainda existe e funciona, mas só é usado por `apps/web/src/app/features/auth/register.component.ts` que NÃO é o fluxo de onboarding pago padrão. É admin/legado.

## Pattern de 3-camadas fail-closed em campos sensíveis

Quando o campo controla feature gating (ex: `professional_type` controla acesso a prescription via middleware), aplicar **3 camadas de fail-closed default seguro**:

1. **Body extraction (handler /onboarding/checkout)**: validar contra whitelist + default seguro
   ```js
   const professional_type = ptype && VALID_PROFESSIONAL_TYPES.includes(ptype) ? ptype : 'medico';
   ```

2. **Metadata read (webhook handler billing-events.js)**: re-validar (defesa contra tampering improvável mas barato)
   ```js
   const ptype = session.metadata?.professional_type;
   const professional_type = ptype && VALID_PROFESSIONAL_TYPES.includes(ptype) ? ptype : 'medico';
   ```

3. **DB default (migration)**: coluna NOT NULL DEFAULT 'medico' garante que mesmo INSERT sem o campo cai no default seguro.

Erro de digitação na landing → falha gracioso pro default mais restritivo. **Nunca abrir feature sensível por descuido.**

## Memo pra próximas fases

Toda feature nova de F2-F5 (módulo estética) que precisar de novo campo de onboarding/user deve:
- [ ] Atualizar onboarding.component.ts payload
- [ ] Atualizar `routes/onboarding-checkout.js` body validation + Stripe metadata
- [ ] Atualizar `services/billing-events.js` webhook handler INSERT
- [ ] (Se applicable) Atualizar `routes/auth.js` `/register` legacy compat
- [ ] DB default seguro
- [ ] Tests pra cada camada
