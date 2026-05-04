---
name: Stripe Integration — substituiu mock de billing em 2026-05-04
description: Pagamentos reais via Stripe Subscriptions API + Checkout (cartão+PIX) + Customer Portal. Webhook é única origem de adição de créditos. Tenants existentes ficam grandfathered.
type: project
---

Integração entregue em 2026-05-04 (branch `feat/stripe-integration`). Substitui as rotas mock `/billing/subscribe` e `/billing/topup` que concediam créditos diretamente no banco sem cobrar.

## Princípio de segurança core

**Créditos só são adicionados via webhook (após pagamento confirmado).** As rotas síncronas só criam Checkout Sessions e retornam URL — nunca inserem em `credit_ledger`. Isso elimina o caminho duplo do mock antigo (rota concedia + webhook concederia de novo) e protege contra fraude.

## Arquitetura

```
FRONTEND (Angular) → POST /billing/checkout/{subscription,topup} ou /portal
  ↓ recebe { url } → window.location.href = url

BACKEND (Fastify):
  /billing/checkout/subscription  admin-only, cria Stripe Customer + Checkout Session subscription
  /billing/checkout/topup         admin-only, cria Checkout Session payment com card|pix
  /billing/portal                 admin-only, cria Stripe Customer Portal Session
  /webhooks/stripe                público, valida signature, despacha por event.type

STRIPE: Checkout hosted UI + Customer Portal hosted + envia webhooks → API
```

## Schema (migration 062)

- `subscriptions`: + `gateway_customer_id` TEXT (idx parcial), status enum extendido (`pending_payment | active | past_due | cancelled | incomplete`)
- `tenants`: + `billing_status` TEXT default `'grandfathered'` — distingue tenants pré-cobrança de novos cobrados pelo Stripe
- `payment_events` (já existia da 016): UNIQUE(gateway, gateway_event_id) é a chave de idempotência

## Webhook event handlers (em `apps/api/src/services/billing-events.js`)

| Event | Handler | O que faz |
|---|---|---|
| `checkout.session.completed` mode=subscription | `handleCheckoutCompleted` → `handleSubscriptionCompleted` | Ativa tenant + UPSERT subscription + grant 122 créditos `subscription_bonus` |
| `checkout.session.completed` mode=payment | `handleCheckoutCompleted` → `handleTopupCompleted` | Grant `metadata.credits` créditos `topup` |
| `invoice.paid` | `handleInvoicePaid` | Renovação mensal: grant 122 `topup_recurring` + atualiza `current_period_end` |
| `invoice.payment_failed` | `handleInvoicePaymentFailed` | Marca subscription `past_due` + tenant `billing_status='past_due'`. NÃO desativa (Stripe Smart Retry) |
| `customer.subscription.deleted` | `handleSubscriptionDeleted` | Desativa tenant + status `cancelled` |
| outros | no-op | Stripe envia ~50 tipos; ignoramos os irrelevantes |

Idempotência: `INSERT INTO payment_events ON CONFLICT (gateway, gateway_event_id) DO NOTHING RETURNING id`. Se `rows.length === 0`, evento já processado, retorna `{ idempotent: true }` sem fazer mais nada.

Audit: handlers usam `withTenant(MASTER_TENANT_ID, fn, { userId: null, channel: 'system' })` — trigger registra `actor_channel='system'` (distingue de UI/copilot).

## Bonus de 30%

Onboarding novo: 122 créditos `subscription_bonus` (30% de R$ 199 / R$ 0,49 ≈ 122).
Renovação mensal: 122 créditos `topup_recurring`.

Constantes em `billing-events.js`: `ONBOARDING_BONUS_CREDITS` e `RECURRING_BONUS_CREDITS` (ambos = 122).

## Tenant grandfathering

Tenants criados antes deste deploy ficam com `billing_status='grandfathered'` (default da migration 062). **Não são cobrados retroativamente.** Podem comprar créditos avulsos sem virar subscriber. Se quiserem virar subscribers, abre `/billing/checkout/subscription` normalmente — o handler de webhook substitui o status pra `active`.

UI (Task 13 deste plano): `/auth/me` retorna `billing_status`. Frontend pode renderizar:
- `grandfathered` → chip "cliente fundador, sem cobrança"
- `pending_payment` → banner "completar pagamento" com botão pra reabrir checkout
- `past_due` → banner amarelo "atualizar cartão" com link pro Customer Portal
- `cancelled` → bloqueio de acesso (já desativado via webhook)
- `active` → normal

## Env vars / secrets

| Variável | Tipo | Onde |
|---|---|---|
| `STRIPE_SECRET_KEY` | secret | API task def via SSM SecureString `/genomaflow/prod/stripe-secret-key` |
| `STRIPE_WEBHOOK_SECRET` | secret | API task def via SSM SecureString `/genomaflow/prod/stripe-webhook-secret` |
| `STRIPE_PRICE_SUBSCRIPTION` | env var | API task def — price_id criado no Stripe Dashboard ("Plano Mensal R$ 199") |

Setup prod (manual antes do `cdk deploy`):
```bash
aws ssm put-parameter --name /genomaflow/prod/stripe-secret-key \
  --value sk_live_xxxx --type SecureString --overwrite --region us-east-1
aws ssm put-parameter --name /genomaflow/prod/stripe-webhook-secret \
  --value whsec_xxxx --type SecureString --overwrite --region us-east-1
```

E substituir `'price_REPLACE_WITH_PROD_PRICE_ID'` em `infra/lib/ecs-stack.ts` pelo price_id real.

## Pra testar local (Stripe CLI)

```bash
# Terminal 1
cd apps/api && npm run dev

# Terminal 2 — tunnel webhook → localhost
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Copia o whsec_ que ela imprime → cola em .env como STRIPE_WEBHOOK_SECRET, restart API

# Terminal 3
cd apps/web && npm start

# Browser:
# - Onboarding completo até step 4
# - Cartão de teste: 4242 4242 4242 4242, qualquer CVV, qualquer data futura
# - Confere: tenant ativado, 122 créditos no ledger, invoice no Stripe Dashboard
```

PIX em test mode: Stripe gera QR fake; simular pagamento via Stripe Dashboard → Payments → "Simulate payment".

## Red flags

- **Webhook handler que NÃO valida signature** → fraude trivial (qualquer um forja webhook e credita conta)
- **Webhook handler sem `ON CONFLICT DO NOTHING`** em `payment_events` → duplo crédito em retries (Stripe retenta até 3 dias em failure)
- **`tenant_id` vindo do body em rota síncrona** (em vez de `request.user.tenant_id`) → cliente forja crédito pra outro tenant
- **Botão "Simular pagamento" voltar pro código** → REMOVIDO de vez 2026-05-04 (incidente prévio em `feedback_angular_prod_build.md`)
- **Hardcode price/credits no body do checkout** (cliente pode pedir R$ 0,01) — servidor decide preço via `PRICE_BY_PACK` lookup
- **Customer ID amarrado a tenant errado** → `metadata.tenant_id` no Stripe Customer pra rastreabilidade + busca via `customers.search` antes de criar
- **Raw body parser global** (`addContentTypeParser('application/json', { parseAs: 'buffer' })`) é load-bearing pro webhook — sem ele, `stripe.webhooks.constructEvent(rawBody, ...)` falha porque body já foi parsed em objeto
- **Mercado Pago oculto da UI** — schema dual-rail (`gateway IN ('stripe','mercadopago')`) preservado pro futuro, mas só Stripe está implementado

## Constantes / packs alinhados com a landing

| Pack | Credits | Price (centavos) | Price (R$) |
|---|---|---|---|
| Starter | 100 | 4990 | R$ 49,90 |
| Pro | 250 | 10990 | R$ 109,90 |
| Clínica | 500 | 19990 | R$ 199,90 |
| Enterprise | 1000 | 37990 | R$ 379,90 |

Em `apps/api/src/constants.js`: `VALID_CREDIT_PACKAGES` + `PRICE_BY_PACK` + `VALID_PAYMENT_METHODS = ['card', 'pix']`.

## Commits relevantes (branch `feat/stripe-integration`)

- `5aef99f0` migration 062
- `f53034d4` SDK install + constants
- `9e68b48b` stripe-client.js wrapper
- `43ee3d10` handler checkout.session.completed
- `d0d122bb` handlers invoice + subscription deleted
- `4a375289` webhook route + raw body parser
- `009b5d49` /checkout/subscription
- `fb61ba2e` /checkout/topup + /portal
- `cd1f8c76` frontend billing.service
- `e482fa07` onboarding (remove simulate)
- `eac9ca15` billing UI PIX + Portal
- `8537753e` /auth/me expose billing_status
- `7c48ead8` IaC SSM + env var
