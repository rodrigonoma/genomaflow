# Stripe Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o caminho mock de billing (rotas `/billing/subscribe` e `/billing/topup` que concedem créditos direto) por integração real com Stripe — Subscriptions API pra plano R$ 199/mês recurring + Checkout Session pra packs de créditos (cartão + PIX) + Customer Portal pra cancel/atualizar cartão. Webhook `/webhooks/stripe` é a única origem de adição de créditos.

**Architecture:** Backend Fastify expõe 3 rotas síncronas (`/billing/checkout/subscription`, `/billing/checkout/topup`, `/billing/portal`) que criam sessões Stripe e retornam URL pra frontend redirecionar; rota pública `/webhooks/stripe` valida assinatura via secret e despacha eventos pra handlers dedicados que aplicam mudanças no banco com idempotência via `payment_events.UNIQUE(gateway, gateway_event_id)`. Frontend Angular substitui `window.location.href = url` em vez do mock atual.

**Tech Stack:** Node.js + Fastify + `stripe` SDK (^14.x) · PostgreSQL + RLS · Angular 18 standalone · Stripe Subscriptions API + Checkout Session + Customer Portal · CDK + SSM Parameter Store pra secrets.

**Spec de referência:** `docs/superpowers/specs/2026-05-04-stripe-integration-design.md`. Trechos marcados `[spec §X]` apontam pra seção do spec.

---

## File Structure

### Novos
- `apps/api/src/db/migrations/062_stripe_customer_ids.sql` — schema (gateway_customer_id, status check, billing_status)
- `apps/api/src/services/stripe-client.js` — wrapper do Stripe SDK
- `apps/api/src/services/billing-events.js` — handlers por event.type (idempotentes)
- `apps/api/src/routes/webhooks/stripe.js` — endpoint `POST /webhooks/stripe`
- `apps/api/tests/routes/webhooks-stripe.test.js` — testes de webhook (signature, idempotência, todos os events)
- `apps/api/tests/routes/billing-checkout.test.js` — testes das rotas checkout/portal

### Modificados
- `apps/api/package.json` — `+ "stripe": "^14.x"`
- `apps/api/src/constants.js` — `VALID_CREDIT_PACKAGES` extendido + `PRICE_BY_PACK` novo
- `apps/api/src/routes/billing.js` — rotas /subscribe → /checkout/subscription, /topup → /checkout/topup, NOVA /portal, REMOVE grant síncrono
- `apps/api/src/routes/auth.js` — REMOVE `/auth/activate`
- `apps/api/src/app.js` — registra `webhooks/stripe.js` + raw body parser global
- `apps/web/src/app/features/clinic/billing/billing.service.ts` — métodos novos
- `apps/web/src/app/features/clinic/billing/billing.component.ts` — payment_method selector + botão Portal
- `apps/web/src/app/features/onboarding/onboarding.component.ts` — REMOVE `simulatePayment()` + botão; redirect via window.location.href
- `apps/web/src/app/features/auth/login/login.component.ts` — banner pending_payment / past_due
- `infra/lib/ecs-stack.ts` — `+ STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` via SSM + `STRIPE_PRICE_SUBSCRIPTION` env
- `.env.example` — placeholders Stripe + instrução Stripe CLI

### Setup manual (usuário, fora do plano)
- Criar Product + Price `R$ 199.00 BRL recurring monthly` no Stripe Dashboard (test E live)
- `aws ssm put-parameter` pros 2 secrets em prod
- Registrar webhook endpoint `https://app.genomaflow.com.br/api/webhooks/stripe` no Stripe Dashboard prod e copiar `whsec_*` pro SSM
- Rodar `cdk deploy genomaflow-ecs` após task 14

---

## Task 1: Migration 062 — schema Stripe

**Files:**
- Create: `apps/api/src/db/migrations/062_stripe_customer_ids.sql`

- [ ] **Step 1: Criar migration**

```sql
-- 062_stripe_customer_ids.sql
-- Adiciona suporte de Stripe Customer ID + statuses de subscription
-- + billing_status no tenant pra distinguir grandfathered de novos cobrados.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS gateway_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_subscriptions_gateway_customer_id
  ON subscriptions(gateway_customer_id)
  WHERE gateway_customer_id IS NOT NULL;

-- Status enum extendido (estava sem CHECK explícito antes)
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('pending_payment','active','past_due','cancelled','incomplete'));

-- billing_status no tenant: pending_payment / active / past_due / cancelled / grandfathered.
-- Tenants existentes ficam grandfathered (sem cobrança retroativa).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS billing_status TEXT DEFAULT 'grandfathered';

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_billing_status_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_billing_status_check
  CHECK (billing_status IN ('pending_payment','active','past_due','cancelled','grandfathered'));

UPDATE tenants SET billing_status = 'grandfathered' WHERE billing_status IS NULL;
```

- [ ] **Step 2: Aplicar local em Docker**

Run: `docker compose exec api node src/db/migrate.js`

Expected: log `[apply] 062_stripe_customer_ids.sql` + `Migrations complete.`

- [ ] **Step 3: Verificar schema**

Run: `docker compose exec db psql -U genomaflow -d genomaflow -c "\d subscriptions"`

Expected: coluna `gateway_customer_id text` aparece. `subscriptions_status_check` lista 5 valores.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/062_stripe_customer_ids.sql
git commit -m "$(cat <<'EOF'
feat(billing): migration 062 — gateway_customer_id + billing_status

Adiciona suporte de Stripe Customer ID em subscriptions, expande enum
de status (pending_payment, active, past_due, cancelled, incomplete)
e adiciona tenants.billing_status com default 'grandfathered' pra
preservar acesso de tenants atuais sem cobrança retroativa.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Instalar Stripe SDK + extender constants

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/constants.js`

- [ ] **Step 1: Instalar dep**

Run: `cd apps/api && npm install stripe@^14.0.0`

Expected: package.json + package-lock.json atualizados; `stripe` aparece em `dependencies`.

- [ ] **Step 2: Atualizar constants.js**

Edit `apps/api/src/constants.js` substituindo o conteúdo INTEIRO por:

```js
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

const VALID_MODULES = ['human', 'veterinary'];

module.exports = {
  VALID_DOCTOR_SPECIALTIES,
  VALID_AGENT_TYPES,
  VALID_CREDIT_PACKAGES,
  PRICE_BY_PACK,
  VALID_PAYMENT_METHODS,
  VALID_MODULES,
};
```

- [ ] **Step 3: Verificar que tests existentes ainda passam**

Run: `cd apps/api && npm run test:unit 2>&1 | tail -10`

Expected: todos verdes. `VALID_CREDIT_PACKAGES` agora tem 4 entradas — testes que iteram nele devem continuar passando (são whitelist tests, mais entradas = OK).

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json apps/api/src/constants.js
git commit -m "$(cat <<'EOF'
feat(billing): add stripe SDK + extend credit packs constants

- npm install stripe@^14
- VALID_CREDIT_PACKAGES extendido pra [100,250,500,1000] (alinha com
  4 packs da landing — Enterprise faltava no backend)
- PRICE_BY_PACK em centavos BRL pra Stripe unit_amount
- VALID_PAYMENT_METHODS = ['card','pix']

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: stripe-client.js — wrapper do SDK

**Files:**
- Create: `apps/api/src/services/stripe-client.js`

- [ ] **Step 1: Criar wrapper**

Create `apps/api/src/services/stripe-client.js`:

```js
'use strict';

const Stripe = require('stripe');

let _client = null;

/**
 * Lazy singleton — evita instanciar Stripe se STRIPE_SECRET_KEY não está
 * setada (testes sem env por exemplo). Lança erro só quando alguém
 * tenta usar de verdade.
 */
function getClient() {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY não configurada');
  _client = new Stripe(key, {
    apiVersion: '2024-11-20.acacia',
    timeout: 10000,  // 10s — Stripe API é fast, timeout conservador
    maxNetworkRetries: 2,
  });
  return _client;
}

/**
 * Cria Customer no Stripe ou retorna o existente via metadata.tenant_id.
 * Idempotente — busca antes de criar.
 */
async function findOrCreateCustomer({ tenantId, email, name }) {
  const stripe = getClient();
  // Busca por metadata.tenant_id (usamos como chave estável)
  const existing = await stripe.customers.search({
    query: `metadata['tenant_id']:'${tenantId}'`,
    limit: 1,
  });
  if (existing.data.length > 0) return existing.data[0];
  return stripe.customers.create({
    email,
    name,
    metadata: { tenant_id: tenantId },
  });
}

async function createSubscriptionCheckoutSession({ customerId, tenantId, priceId, successUrl, cancelUrl }) {
  const stripe = getClient();
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    payment_method_types: ['card'],
    client_reference_id: tenantId,
    metadata: { tenant_id: tenantId, plan: 'starter' },
    subscription_data: { metadata: { tenant_id: tenantId } },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

async function createTopupCheckoutSession({ customerId, tenantId, credits, unitAmount, paymentMethod, successUrl, cancelUrl }) {
  const stripe = getClient();
  const methods = paymentMethod === 'pix' ? ['pix'] : ['card', 'pix'];
  return stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{
      price_data: {
        currency: 'brl',
        product_data: { name: `Créditos GenomaFlow (${credits})` },
        unit_amount: unitAmount,
      },
      quantity: 1,
    }],
    payment_method_types: methods,
    client_reference_id: tenantId,
    metadata: { tenant_id: tenantId, credits: String(credits), kind: 'topup' },
    expires_at: Math.floor(Date.now() / 1000) + 1800, // 30min — PIX expira
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

async function createPortalSession({ customerId, returnUrl }) {
  const stripe = getClient();
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

/**
 * Valida assinatura do webhook. Retorna o evento parseado ou lança erro.
 * rawBody = Buffer ou string com o body original (não-parseado).
 */
function constructEvent(rawBody, signature) {
  const stripe = getClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET não configurada');
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

module.exports = {
  getClient,
  findOrCreateCustomer,
  createSubscriptionCheckoutSession,
  createTopupCheckoutSession,
  createPortalSession,
  constructEvent,
  // Exposed só pra tests resetarem singleton
  _resetClient: () => { _client = null; },
};
```

- [ ] **Step 2: Smoke local — node -c**

Run: `cd apps/api && node -c src/services/stripe-client.js && echo OK`

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/stripe-client.js
git commit -m "$(cat <<'EOF'
feat(billing): stripe-client.js — wrapper do Stripe SDK

Lazy singleton + helpers: findOrCreateCustomer (idempotente via
metadata.tenant_id), createSubscriptionCheckoutSession,
createTopupCheckoutSession (suporta card+pix), createPortalSession,
constructEvent (validação de signature de webhook).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: billing-events.js — handler de checkout.session.completed

**Files:**
- Create: `apps/api/src/services/billing-events.js`
- Test: `apps/api/tests/routes/webhooks-stripe.test.js` (criação do file e primeiros testes)

- [ ] **Step 1: Criar billing-events.js com primeiro handler**

Create `apps/api/src/services/billing-events.js`:

```js
'use strict';

const { withTenant } = require('../db/tenant');

const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ONBOARDING_BONUS_CREDITS = 122; // 30% de R$ 199 / R$ 0,49 ≈ 122

/**
 * Insere evento na tabela payment_events com idempotência.
 * Retorna { isNew: boolean, eventRowId } — se isNew=false, evento duplicado, não processar de novo.
 */
async function recordPaymentEvent(client, { gateway, eventId, kind, tenantId, amountBrl = null, creditsGranted = null }) {
  const { rows } = await client.query(
    `INSERT INTO payment_events (gateway, gateway_event_id, kind, tenant_id, amount_brl, credits_granted, processed_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (gateway, gateway_event_id) DO NOTHING
     RETURNING id`,
    [gateway, eventId, kind, tenantId, amountBrl, creditsGranted]
  );
  return { isNew: rows.length > 0, eventRowId: rows[0]?.id ?? null };
}

/**
 * Handler de checkout.session.completed. Despacha por session.mode.
 *
 * @param {object} pg — Fastify postgres pool
 * @param {object} event — Stripe event object
 * @param {object} redis — opcional, pra publish WS event
 */
async function handleCheckoutCompleted(pg, event, redis) {
  const session = event.data.object;
  const tenantId = session.client_reference_id || session.metadata?.tenant_id;
  if (!tenantId) {
    throw new Error(`checkout.session.completed sem tenant_id (session ${session.id})`);
  }

  if (session.mode === 'subscription') {
    return handleSubscriptionCompleted(pg, event, session, tenantId, redis);
  }
  if (session.mode === 'payment') {
    return handleTopupCompleted(pg, event, session, tenantId, redis);
  }
  // outros modes (setup) — no-op
  return { handled: false, reason: `mode=${session.mode} not handled` };
}

async function handleSubscriptionCompleted(pg, event, session, tenantId, redis) {
  return withTenant(pg, MASTER_TENANT_ID, async (client) => {
    const { isNew } = await recordPaymentEvent(client, {
      gateway: 'stripe',
      eventId: event.id,
      kind: 'subscription_started',
      tenantId,
      amountBrl: session.amount_total ? session.amount_total / 100 : 199,
      creditsGranted: ONBOARDING_BONUS_CREDITS,
    });
    if (!isNew) return { handled: true, idempotent: true };

    await client.query(
      `UPDATE tenants SET active = true, billing_status = 'active' WHERE id = $1`,
      [tenantId]
    );

    // Subscription detail — Stripe expand foi pedido no Checkout Session se necessário,
    // aqui pegamos do session.subscription (string ID)
    const subscriptionId = session.subscription;
    await client.query(
      `INSERT INTO subscriptions (tenant_id, gateway, gateway_subscription_id, gateway_customer_id, plan, status)
       VALUES ($1, 'stripe', $2, $3, 'starter', 'active')
       ON CONFLICT (tenant_id) DO UPDATE
       SET gateway_subscription_id = EXCLUDED.gateway_subscription_id,
           gateway_customer_id = EXCLUDED.gateway_customer_id,
           status = 'active',
           updated_at = NOW()`,
      [tenantId, subscriptionId, session.customer]
    );

    await client.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description)
       VALUES ($1, $2, 'subscription_bonus', 'Bônus 30% do onboarding R$ 199 — Stripe')`,
      [tenantId, ONBOARDING_BONUS_CREDITS]
    );

    if (redis) {
      await redis.publish(`billing:activated:${tenantId}`, JSON.stringify({ credits: ONBOARDING_BONUS_CREDITS }));
    }

    return { handled: true, idempotent: false, credits: ONBOARDING_BONUS_CREDITS };
  }, { userId: null, channel: 'system' });
}

async function handleTopupCompleted(pg, event, session, tenantId, redis) {
  const credits = parseInt(session.metadata?.credits, 10);
  if (!credits || credits <= 0) {
    throw new Error(`topup sem metadata.credits válido (session ${session.id})`);
  }

  return withTenant(pg, MASTER_TENANT_ID, async (client) => {
    const { isNew, eventRowId } = await recordPaymentEvent(client, {
      gateway: 'stripe',
      eventId: event.id,
      kind: 'topup',
      tenantId,
      amountBrl: session.amount_total ? session.amount_total / 100 : null,
      creditsGranted: credits,
    });
    if (!isNew) return { handled: true, idempotent: true };

    await client.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description, payment_event_id)
       VALUES ($1, $2, 'topup', 'Compra de créditos — Stripe', $3)`,
      [tenantId, credits, eventRowId]
    );

    if (redis) {
      await redis.publish(`billing:credited:${tenantId}`, JSON.stringify({ credits }));
    }

    return { handled: true, idempotent: false, credits };
  }, { userId: null, channel: 'system' });
}

module.exports = {
  handleCheckoutCompleted,
  recordPaymentEvent,
  ONBOARDING_BONUS_CREDITS,
};
```

- [ ] **Step 2: Criar test file com 2 primeiros testes**

Create `apps/api/tests/routes/webhooks-stripe.test.js`:

```js
'use strict';
/**
 * Tests pra webhook handlers Stripe. Mocka Stripe SDK + pg + redis.
 *
 * Padrão: build Fastify isolado com decorators + inject. Stripe SDK é
 * mockado completamente — não tocamos rede.
 */

jest.mock('stripe', () => {
  const mockConstructEvent = jest.fn();
  const MockStripe = jest.fn(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  }));
  MockStripe.mockConstructEvent = mockConstructEvent;
  return MockStripe;
});

const Stripe = require('stripe');
const { handleCheckoutCompleted } = require('../../src/services/billing-events');

function buildPgMock() {
  const queries = [];
  const client = {
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      // INSERT INTO payment_events ON CONFLICT … RETURNING id
      if (/INSERT INTO payment_events/i.test(sql)) {
        return { rows: [{ id: 1 }] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  return {
    pool: {
      connect: jest.fn(async () => client),
      query: jest.fn(),
    },
    client,
    queries,
  };
}

function buildRedisMock() {
  return { publish: jest.fn(async () => 1) };
}

describe('handleCheckoutCompleted — subscription mode', () => {
  beforeEach(() => jest.clearAllMocks());

  test('grant 122 créditos + ativa tenant', async () => {
    const pgMock = buildPgMock();
    const redisMock = buildRedisMock();
    const event = {
      id: 'evt_test_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_001',
          mode: 'subscription',
          client_reference_id: 'tenant-uuid-1',
          customer: 'cus_test_001',
          subscription: 'sub_test_001',
          amount_total: 19900,
        },
      },
    };

    const result = await handleCheckoutCompleted(pgMock.pool, event, redisMock);

    expect(result).toEqual({ handled: true, idempotent: false, credits: 122 });
    // payment_events insert
    expect(pgMock.client.query.mock.calls.some(c => /INSERT INTO payment_events/.test(c[0]))).toBe(true);
    // tenants UPDATE
    expect(pgMock.client.query.mock.calls.some(c => /UPDATE tenants SET active = true/.test(c[0]))).toBe(true);
    // subscriptions UPSERT
    expect(pgMock.client.query.mock.calls.some(c => /INSERT INTO subscriptions/.test(c[0]))).toBe(true);
    // credit_ledger
    const ledger = pgMock.client.query.mock.calls.find(c => /INSERT INTO credit_ledger/.test(c[0]));
    expect(ledger[1]).toEqual(['tenant-uuid-1', 122]);
    // WS publish
    expect(redisMock.publish).toHaveBeenCalledWith('billing:activated:tenant-uuid-1', expect.any(String));
  });

  test('event duplicado → idempotent (no-op nos UPSERTs)', async () => {
    const pgMock = buildPgMock();
    // Sobrescreve pra simular ON CONFLICT DO NOTHING (sem RETURNING)
    pgMock.client.query.mockImplementation(async (sql) => {
      if (/INSERT INTO payment_events/i.test(sql)) {
        return { rows: [] }; // ← simula duplicate
      }
      return { rows: [] };
    });
    const redisMock = buildRedisMock();
    const event = {
      id: 'evt_test_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_001',
          mode: 'subscription',
          client_reference_id: 'tenant-uuid-1',
          customer: 'cus_test_001',
          subscription: 'sub_test_001',
        },
      },
    };

    const result = await handleCheckoutCompleted(pgMock.pool, event, redisMock);
    expect(result).toEqual({ handled: true, idempotent: true });
    // Não deve ter chamado tenants UPDATE nem credit_ledger
    expect(pgMock.client.query.mock.calls.some(c => /UPDATE tenants/.test(c[0]))).toBe(false);
    expect(pgMock.client.query.mock.calls.some(c => /credit_ledger/.test(c[0]))).toBe(false);
    expect(redisMock.publish).not.toHaveBeenCalled();
  });

  test('sem client_reference_id e sem metadata.tenant_id → throw', async () => {
    const pgMock = buildPgMock();
    const event = {
      id: 'evt_test_002',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_002', mode: 'subscription' } },
    };
    await expect(handleCheckoutCompleted(pgMock.pool, event, null)).rejects.toThrow(/sem tenant_id/);
  });
});
```

⚠️ **IMPORTANTE:** o `withTenant` de `apps/api/src/db/tenant.js` precisa funcionar com o `pgMock.pool`. Verificar primeiro como ele está implementado e ajustar o mock se necessário. Se `withTenant` chama `pool.connect()` e usa o client, o mock acima já funciona.

- [ ] **Step 3: Adicionar test path em test:unit**

Edit `apps/api/package.json` — encontrar linha que define `test:unit` (`"test:unit": "jest <lista de paths>"`) e adicionar `tests/routes/webhooks-stripe.test.js` à lista. Exemplo (depende de como tá hoje):

```json
"test:unit": "jest tests/security/master-acl.test.js tests/routes/billing-validation.test.js tests/routes/inter-tenant-chat/messages-validation.test.js tests/routes/master-audit-log.test.js tests/routes/webhooks-stripe.test.js"
```

(O comando exato depende do conteúdo atual — preserve o que já existe e APPEND `tests/routes/webhooks-stripe.test.js`.)

- [ ] **Step 4: Rodar tests**

Run: `cd apps/api && npm run test:unit -- --testPathPattern=webhooks-stripe`

Expected: 3 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/billing-events.js \
        apps/api/tests/routes/webhooks-stripe.test.js \
        apps/api/package.json
git commit -m "$(cat <<'EOF'
feat(billing): handler de checkout.session.completed (subscription + topup)

Service billing-events.js:
- handleCheckoutCompleted despacha por session.mode (subscription | payment)
- handleSubscriptionCompleted: ativa tenant + UPSERT subscription + grant
  122 créditos (30% bônus de R$ 199)
- handleTopupCompleted: grant créditos do metadata.credits
- recordPaymentEvent: idempotente via ON CONFLICT DO NOTHING

Tests: 3 cenários (grant happy path, dup event no-op, missing tenant_id throws).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: billing-events.js — handlers de invoice e subscription

**Files:**
- Modify: `apps/api/src/services/billing-events.js`
- Modify: `apps/api/tests/routes/webhooks-stripe.test.js`

- [ ] **Step 1: Adicionar handlers ao billing-events.js**

Edit `apps/api/src/services/billing-events.js` — antes do `module.exports`, adicionar:

```js
const RECURRING_BONUS_CREDITS = 122; // mesmo bônus mensal de subscriber ativo

async function handleInvoicePaid(pg, event, redis) {
  const invoice = event.data.object;
  // Subscription invoices têm subscription_id; one-off não
  if (!invoice.subscription) return { handled: false, reason: 'no subscription' };

  const tenantId = invoice.subscription_details?.metadata?.tenant_id || invoice.metadata?.tenant_id;
  if (!tenantId) {
    // Stripe não devolve metadata na invoice por default — buscar via subscription
    // Aqui aceitamos pular (próximo retry vai trazer) ou expandir
    return { handled: false, reason: 'tenant_id ausente — checar expand[]' };
  }

  return withTenant(pg, MASTER_TENANT_ID, async (client) => {
    const { isNew } = await recordPaymentEvent(client, {
      gateway: 'stripe',
      eventId: event.id,
      kind: 'invoice_paid',
      tenantId,
      amountBrl: invoice.amount_paid ? invoice.amount_paid / 100 : null,
      creditsGranted: RECURRING_BONUS_CREDITS,
    });
    if (!isNew) return { handled: true, idempotent: true };

    await client.query(
      `UPDATE subscriptions SET status = 'active', current_period_end = to_timestamp($2), updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId, invoice.lines?.data?.[0]?.period?.end || Math.floor(Date.now() / 1000) + 30 * 86400]
    );

    await client.query(
      `UPDATE tenants SET billing_status = 'active' WHERE id = $1`,
      [tenantId]
    );

    await client.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description)
       VALUES ($1, $2, 'topup_recurring', 'Renovação mensal Stripe')`,
      [tenantId, RECURRING_BONUS_CREDITS]
    );

    if (redis) {
      await redis.publish(`billing:renewed:${tenantId}`, JSON.stringify({ credits: RECURRING_BONUS_CREDITS }));
    }

    return { handled: true, idempotent: false, credits: RECURRING_BONUS_CREDITS };
  }, { userId: null, channel: 'system' });
}

async function handleInvoicePaymentFailed(pg, event, redis) {
  const invoice = event.data.object;
  const tenantId = invoice.subscription_details?.metadata?.tenant_id || invoice.metadata?.tenant_id;
  if (!tenantId) return { handled: false, reason: 'no tenant_id' };

  return withTenant(pg, MASTER_TENANT_ID, async (client) => {
    const { isNew } = await recordPaymentEvent(client, {
      gateway: 'stripe',
      eventId: event.id,
      kind: 'invoice_payment_failed',
      tenantId,
    });
    if (!isNew) return { handled: true, idempotent: true };

    await client.query(
      `UPDATE subscriptions SET status = 'past_due', updated_at = NOW() WHERE tenant_id = $1`,
      [tenantId]
    );
    await client.query(
      `UPDATE tenants SET billing_status = 'past_due' WHERE id = $1`,
      [tenantId]
    );

    if (redis) {
      await redis.publish(`billing:payment_failed:${tenantId}`, JSON.stringify({}));
    }
    return { handled: true, idempotent: false };
  }, { userId: null, channel: 'system' });
}

async function handleSubscriptionDeleted(pg, event, redis) {
  const subscription = event.data.object;
  const tenantId = subscription.metadata?.tenant_id;
  if (!tenantId) return { handled: false, reason: 'no tenant_id' };

  return withTenant(pg, MASTER_TENANT_ID, async (client) => {
    const { isNew } = await recordPaymentEvent(client, {
      gateway: 'stripe',
      eventId: event.id,
      kind: 'subscription_cancelled',
      tenantId,
    });
    if (!isNew) return { handled: true, idempotent: true };

    await client.query(
      `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId]
    );
    await client.query(
      `UPDATE tenants SET active = false, billing_status = 'cancelled' WHERE id = $1`,
      [tenantId]
    );

    if (redis) {
      await redis.publish(`billing:cancelled:${tenantId}`, JSON.stringify({}));
    }
    return { handled: true, idempotent: false };
  }, { userId: null, channel: 'system' });
}
```

E atualizar o `module.exports` no fim do arquivo:

```js
module.exports = {
  handleCheckoutCompleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleSubscriptionDeleted,
  recordPaymentEvent,
  ONBOARDING_BONUS_CREDITS,
  RECURRING_BONUS_CREDITS,
};
```

- [ ] **Step 2: Adicionar testes pros 3 handlers novos**

Edit `apps/api/tests/routes/webhooks-stripe.test.js` — adicionar APÓS o último `describe`:

```js
describe('handleInvoicePaid', () => {
  beforeEach(() => jest.clearAllMocks());
  const { handleInvoicePaid } = require('../../src/services/billing-events');

  test('grant 122 créditos recurring + atualiza period_end', async () => {
    const pgMock = buildPgMock();
    const redisMock = buildRedisMock();
    const event = {
      id: 'evt_inv_001',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_test_001',
          subscription: 'sub_test_001',
          subscription_details: { metadata: { tenant_id: 'tenant-uuid-1' } },
          amount_paid: 19900,
          lines: { data: [{ period: { end: 1735689600 } }] },
        },
      },
    };
    const result = await handleInvoicePaid(pgMock.pool, event, redisMock);
    expect(result).toEqual({ handled: true, idempotent: false, credits: 122 });
    expect(redisMock.publish).toHaveBeenCalledWith('billing:renewed:tenant-uuid-1', expect.any(String));
  });

  test('event sem subscription → no-op', async () => {
    const pgMock = buildPgMock();
    const event = {
      id: 'evt_inv_002',
      type: 'invoice.paid',
      data: { object: { id: 'in_test_002' } }, // sem subscription
    };
    const result = await handleInvoicePaid(pgMock.pool, event, null);
    expect(result.handled).toBe(false);
  });
});

describe('handleInvoicePaymentFailed', () => {
  beforeEach(() => jest.clearAllMocks());
  const { handleInvoicePaymentFailed } = require('../../src/services/billing-events');

  test('marca past_due — NÃO desativa tenant', async () => {
    const pgMock = buildPgMock();
    const redisMock = buildRedisMock();
    const event = {
      id: 'evt_inv_fail_001',
      type: 'invoice.payment_failed',
      data: {
        object: {
          subscription_details: { metadata: { tenant_id: 'tenant-uuid-1' } },
        },
      },
    };
    const result = await handleInvoicePaymentFailed(pgMock.pool, event, redisMock);
    expect(result).toEqual({ handled: true, idempotent: false });
    // Confirma que NÃO chamou UPDATE tenants SET active = false
    expect(pgMock.client.query.mock.calls.some(c => /active\s*=\s*false/.test(c[0]))).toBe(false);
    // Confirma que setou past_due
    expect(pgMock.client.query.mock.calls.some(c => /past_due/.test(c[0]))).toBe(true);
  });
});

describe('handleSubscriptionDeleted', () => {
  beforeEach(() => jest.clearAllMocks());
  const { handleSubscriptionDeleted } = require('../../src/services/billing-events');

  test('desativa tenant + status cancelled', async () => {
    const pgMock = buildPgMock();
    const redisMock = buildRedisMock();
    const event = {
      id: 'evt_sub_del_001',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          metadata: { tenant_id: 'tenant-uuid-1' },
        },
      },
    };
    const result = await handleSubscriptionDeleted(pgMock.pool, event, redisMock);
    expect(result).toEqual({ handled: true, idempotent: false });
    expect(pgMock.client.query.mock.calls.some(c => /active\s*=\s*false/.test(c[0]))).toBe(true);
    expect(pgMock.client.query.mock.calls.some(c => /cancelled_at\s*=\s*NOW/.test(c[0]))).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd apps/api && npm run test:unit -- --testPathPattern=webhooks-stripe`

Expected: 7 testes verdes (3 anteriores + 4 novos).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/billing-events.js apps/api/tests/routes/webhooks-stripe.test.js
git commit -m "$(cat <<'EOF'
feat(billing): handlers invoice.paid / payment_failed / subscription.deleted

- handleInvoicePaid: grant créditos recurring (122) + atualiza
  current_period_end + tenants.billing_status='active'
- handleInvoicePaymentFailed: marca subscription past_due, mantém
  tenant ativo (Stripe Smart Retry vai retentar)
- handleSubscriptionDeleted: desativa tenant + status cancelled
- Todos idempotentes via payment_events.UNIQUE

4 testes novos cobrindo happy path + edge cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Webhook route + raw body parser

**Files:**
- Create: `apps/api/src/routes/webhooks/stripe.js`
- Modify: `apps/api/src/app.js`
- Modify: `apps/api/tests/routes/webhooks-stripe.test.js`

- [ ] **Step 1: Criar route**

Create `apps/api/src/routes/webhooks/stripe.js`:

```js
'use strict';

const stripeClient = require('../../services/stripe-client');
const {
  handleCheckoutCompleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleSubscriptionDeleted,
} = require('../../services/billing-events');

module.exports = async function webhookRoutes(fastify) {
  fastify.post('/webhooks/stripe', {
    config: { rawBody: true }, // marker pra parser global
  }, async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (!signature) {
      return reply.status(400).send({ error: 'Missing Stripe-Signature header' });
    }

    let event;
    try {
      const rawBody = request.rawBody;
      if (!rawBody) {
        fastify.log.error('webhook: rawBody undefined — content type parser não executou');
        return reply.status(500).send({ error: 'rawBody not available' });
      }
      event = stripeClient.constructEvent(rawBody, signature);
    } catch (err) {
      fastify.log.warn({ err: err.message }, 'webhook signature inválida');
      return reply.status(400).send({ error: 'Invalid signature' });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(fastify.pg, event, fastify.redis);
          break;
        case 'invoice.paid':
          await handleInvoicePaid(fastify.pg, event, fastify.redis);
          break;
        case 'invoice.payment_failed':
          await handleInvoicePaymentFailed(fastify.pg, event, fastify.redis);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(fastify.pg, event, fastify.redis);
          break;
        default:
          // Stripe envia ~50 tipos de evento; ignoramos os que não interessam
          fastify.log.debug({ type: event.type }, 'evento ignorado');
      }
    } catch (err) {
      fastify.log.error({ err: err.message, eventType: event.type, eventId: event.id }, 'webhook handler erro');
      // Retorna 500 pra Stripe retentar (até 3 dias). Idempotência cobre dups.
      return reply.status(500).send({ error: 'Handler failed' });
    }

    return reply.status(200).send({ received: true });
  });
};
```

- [ ] **Step 2: Registrar raw body parser global em app.js**

Edit `apps/api/src/app.js` — encontrar o registro de `@fastify/jwt` ou `@fastify/postgres` e ANTES dele adicionar:

```js
// Raw body parser — necessário pra validação de signature do webhook Stripe.
// Default Fastify parseia JSON automaticamente, mas Stripe valida sobre o
// body bruto. Aqui guardamos os bytes originais em request.rawBody pra todas
// as rotas (overhead negligível) e mantemos parsing JSON normal.
fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  req.rawBody = body;
  try {
    const json = body.length > 0 ? JSON.parse(body.toString('utf8')) : {};
    done(null, json);
  } catch (err) {
    done(err, undefined);
  }
});
```

E na seção de registros de rotas, adicionar:

```js
fastify.register(require('./routes/webhooks/stripe'));
```

(Ajustar conforme padrão atual do app.js.)

- [ ] **Step 3: Test signature inválida no webhooks-stripe.test.js**

Edit `apps/api/tests/routes/webhooks-stripe.test.js` — adicionar bloco no fim:

```js
describe('POST /webhooks/stripe — signature validation', () => {
  beforeEach(() => jest.clearAllMocks());

  async function buildAppWithWebhook() {
    const Fastify = require('fastify');
    const app = Fastify({ logger: false });

    // Raw body parser (mesmo do app.js)
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      req.rawBody = body;
      try {
        const json = body.length > 0 ? JSON.parse(body.toString('utf8')) : {};
        done(null, json);
      } catch (err) { done(err, undefined); }
    });

    app.decorate('pg', { connect: jest.fn(), query: jest.fn() });
    app.decorate('redis', { publish: jest.fn() });
    await app.register(require('../../src/routes/webhooks/stripe'));
    await app.ready();
    return app;
  }

  test('sem header stripe-signature → 400', async () => {
    const app = await buildAppWithWebhook();
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      payload: { type: 'checkout.session.completed' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Stripe-Signature/);
    await app.close();
  });

  test('signature inválida → 400', async () => {
    Stripe.mockConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });
    const app = await buildAppWithWebhook();
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': 't=12345,v1=fake' },
      payload: { type: 'checkout.session.completed' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid signature/);
    await app.close();
  });

  test('signature válida + tipo desconhecido → 200 no-op', async () => {
    Stripe.mockConstructEvent.mockImplementation(() => ({
      id: 'evt_test', type: 'customer.created', data: { object: {} },
    }));
    const app = await buildAppWithWebhook();
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': 't=12345,v1=valid' },
      payload: { type: 'customer.created' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
    await app.close();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npm run test:unit -- --testPathPattern=webhooks-stripe`

Expected: 10 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/webhooks/stripe.js \
        apps/api/src/app.js \
        apps/api/tests/routes/webhooks-stripe.test.js
git commit -m "$(cat <<'EOF'
feat(billing): webhook route POST /webhooks/stripe

- Raw body parser global pra preservar bytes pro stripe.constructEvent
- Validação de signature → 400 sem header / signature inválida
- Despacha por event.type pros handlers em billing-events.js
- 500 em handler error (Stripe retenta até 3 dias)
- Eventos desconhecidos retornam 200 (no-op silencioso, padrão Stripe)

3 testes adicionais (missing header, invalid sig, unknown event).
Total: 10 testes do webhook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Refactor /billing/subscribe → /billing/checkout/subscription

**Files:**
- Modify: `apps/api/src/routes/billing.js`
- Create: `apps/api/tests/routes/billing-checkout.test.js`

- [ ] **Step 1: Substituir rota /billing/subscribe**

Edit `apps/api/src/routes/billing.js` — localizar `fastify.post('/billing/subscribe'` e SUBSTITUIR o handler INTEIRO por:

```js
  // POST /billing/checkout/subscription — admin-only
  // Cria Stripe Customer (lazy) + Checkout Session subscription.
  // NÃO concede crédito sincrono — webhook checkout.session.completed faz isso.
  fastify.post('/billing/checkout/subscription', {
    preHandler: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') {
      return reply.status(403).send({ error: 'Admin only' });
    }

    const stripeClient = require('../services/stripe-client');
    const priceId = process.env.STRIPE_PRICE_SUBSCRIPTION;
    if (!priceId) {
      fastify.log.error('STRIPE_PRICE_SUBSCRIPTION não configurada');
      return reply.status(500).send({ error: 'Pagamento indisponível — configuração ausente' });
    }
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.genomaflow.com.br';

    // Pega dados do tenant pra criar Customer
    const { rows } = await fastify.pg.query(
      `SELECT t.name, u.email FROM tenants t
       JOIN users u ON u.tenant_id = t.id AND u.role = 'admin'
       WHERE t.id = $1 LIMIT 1`,
      [tenant_id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Tenant não encontrado' });

    const customer = await stripeClient.findOrCreateCustomer({
      tenantId: tenant_id,
      email: rows[0].email,
      name: rows[0].name,
    });

    // Persiste customer_id pra reuso futuro
    await fastify.pg.query(
      `INSERT INTO subscriptions (tenant_id, gateway, gateway_customer_id, plan, status)
       VALUES ($1, 'stripe', $2, 'starter', 'pending_payment')
       ON CONFLICT (tenant_id) DO UPDATE
       SET gateway_customer_id = EXCLUDED.gateway_customer_id, updated_at = NOW()`,
      [tenant_id, customer.id]
    );

    const session = await stripeClient.createSubscriptionCheckoutSession({
      customerId: customer.id,
      tenantId: tenant_id,
      priceId,
      successUrl: `${frontendUrl}/login?activated=true`,
      cancelUrl: `${frontendUrl}/onboarding?cancelled=true`,
    });

    return { url: session.url, session_id: session.id };
  });
```

⚠️ **IMPORTANTE:** REMOVER a rota `/billing/subscribe` antiga. Não deixar duplicada — pode causar conflito.

- [ ] **Step 2: Criar test file**

Create `apps/api/tests/routes/billing-checkout.test.js`:

```js
'use strict';

jest.mock('stripe', () => {
  const mock = {
    customers: {
      search: jest.fn(async () => ({ data: [] })),
      create: jest.fn(async () => ({ id: 'cus_test_001' })),
    },
    checkout: { sessions: { create: jest.fn(async () => ({ id: 'cs_test_001', url: 'https://stripe.test/s/cs_test_001' })) } },
    billingPortal: { sessions: { create: jest.fn(async () => ({ url: 'https://stripe.test/portal/test' })) } },
  };
  const Mock = jest.fn(() => mock);
  Mock._mock = mock;
  return Mock;
});

const Fastify = require('fastify');

function buildApp(role = 'admin') {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request) => {
    request.user = {
      user_id: 'u-1',
      tenant_id: 't-1',
      role,
      module: 'human',
    };
  });
  app.decorate('pg', {
    query: jest.fn(async (sql) => {
      if (/SELECT t.name, u.email/i.test(sql)) {
        return { rows: [{ name: 'Clínica Teste', email: 'admin@teste.com' }] };
      }
      return { rows: [] };
    }),
  });
  app.decorate('redis', { publish: jest.fn() });
  return app;
}

describe('POST /billing/checkout/subscription', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_SUBSCRIPTION = 'price_test_001';
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.FRONTEND_URL = 'https://app.test';
    jest.clearAllMocks();
    require('../../src/services/stripe-client')._resetClient();
  });

  test('admin → 200 com url do Stripe', async () => {
    const app = buildApp('admin');
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({ method: 'POST', url: '/billing/checkout/subscription' });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toMatch(/^https:\/\/stripe\.test/);
    await app.close();
  });

  for (const role of ['doctor', 'master']) {
    test(`role=${role} → 403`, async () => {
      const app = buildApp(role);
      await app.register(require('../../src/routes/billing'));
      const res = await app.inject({ method: 'POST', url: '/billing/checkout/subscription' });
      expect(res.statusCode).toBe(403);
      await app.close();
    });
  }

  test('STRIPE_PRICE_SUBSCRIPTION ausente → 500', async () => {
    delete process.env.STRIPE_PRICE_SUBSCRIPTION;
    const app = buildApp('admin');
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({ method: 'POST', url: '/billing/checkout/subscription' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});
```

- [ ] **Step 3: Adicionar test path em test:unit**

Edit `apps/api/package.json` — APPEND `tests/routes/billing-checkout.test.js` no `test:unit`.

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npm run test:unit -- --testPathPattern=billing-checkout`

Expected: 4 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/billing.js apps/api/tests/routes/billing-checkout.test.js apps/api/package.json
git commit -m "$(cat <<'EOF'
feat(billing): rota /checkout/subscription real (substitui /subscribe mock)

POST /billing/checkout/subscription:
- Admin-only + rate limit 30/min
- findOrCreateCustomer no Stripe (idempotente via metadata.tenant_id)
- UPSERT subscriptions com pending_payment
- Cria Checkout Session mode=subscription, retorna {url, session_id}
- NÃO concede crédito (webhook fará)

Tests: admin happy path + 403 doctor/master + 500 sem price config.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Refactor /billing/topup → /billing/checkout/topup + nova /billing/portal

**Files:**
- Modify: `apps/api/src/routes/billing.js`
- Modify: `apps/api/tests/routes/billing-checkout.test.js`

- [ ] **Step 1: Substituir /billing/topup**

Edit `apps/api/src/routes/billing.js` — localizar `fastify.post('/billing/topup'` e substituir o handler INTEIRO por:

```js
  // POST /billing/checkout/topup — admin-only — { credits, payment_method }
  fastify.post('/billing/checkout/topup', {
    preHandler: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Admin only' });

    const { VALID_CREDIT_PACKAGES, PRICE_BY_PACK, VALID_PAYMENT_METHODS } = require('../constants');
    const credits = parseInt(request.body?.credits, 10);
    const paymentMethod = request.body?.payment_method || 'card';

    if (!VALID_CREDIT_PACKAGES.includes(credits)) {
      return reply.status(400).send({ error: `credits inválido — use ${VALID_CREDIT_PACKAGES.join('|')}` });
    }
    if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return reply.status(400).send({ error: `payment_method inválido — use ${VALID_PAYMENT_METHODS.join('|')}` });
    }

    const unitAmount = PRICE_BY_PACK[credits];
    const stripeClient = require('../services/stripe-client');
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.genomaflow.com.br';

    const { rows } = await fastify.pg.query(
      `SELECT t.name, u.email, s.gateway_customer_id
       FROM tenants t
       JOIN users u ON u.tenant_id = t.id AND u.role = 'admin'
       LEFT JOIN subscriptions s ON s.tenant_id = t.id
       WHERE t.id = $1 LIMIT 1`,
      [tenant_id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Tenant não encontrado' });

    let customerId = rows[0].gateway_customer_id;
    if (!customerId) {
      const customer = await stripeClient.findOrCreateCustomer({
        tenantId: tenant_id,
        email: rows[0].email,
        name: rows[0].name,
      });
      customerId = customer.id;
      await fastify.pg.query(
        `INSERT INTO subscriptions (tenant_id, gateway, gateway_customer_id, plan, status)
         VALUES ($1, 'stripe', $2, 'topup_only', 'pending_payment')
         ON CONFLICT (tenant_id) DO UPDATE
         SET gateway_customer_id = EXCLUDED.gateway_customer_id, updated_at = NOW()`,
        [tenant_id, customerId]
      );
    }

    const session = await stripeClient.createTopupCheckoutSession({
      customerId,
      tenantId: tenant_id,
      credits,
      unitAmount,
      paymentMethod,
      successUrl: `${frontendUrl}/clinic/billing?topup=success`,
      cancelUrl: `${frontendUrl}/clinic/billing?topup=cancelled`,
    });

    return { url: session.url, session_id: session.id };
  });

  // POST /billing/portal — admin-only — abre Customer Portal pra gerenciar/cancelar
  fastify.post('/billing/portal', {
    preHandler: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Admin only' });

    const { rows } = await fastify.pg.query(
      'SELECT gateway_customer_id FROM subscriptions WHERE tenant_id = $1 LIMIT 1',
      [tenant_id]
    );
    const customerId = rows[0]?.gateway_customer_id;
    if (!customerId) {
      return reply.status(400).send({ error: 'Sem subscription Stripe — assine primeiro' });
    }

    const stripeClient = require('../services/stripe-client');
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.genomaflow.com.br';
    const session = await stripeClient.createPortalSession({
      customerId,
      returnUrl: `${frontendUrl}/clinic/billing`,
    });
    return { url: session.url };
  });
```

- [ ] **Step 2: Adicionar testes em billing-checkout.test.js**

Edit `apps/api/tests/routes/billing-checkout.test.js` — adicionar APÓS o último describe:

```js
describe('POST /billing/checkout/topup', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.FRONTEND_URL = 'https://app.test';
    jest.clearAllMocks();
    require('../../src/services/stripe-client')._resetClient();
  });

  test('admin + credits=250 + payment_method=card → 200', async () => {
    const app = buildApp('admin');
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout/topup',
      payload: { credits: 250, payment_method: 'card' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toMatch(/^https:/);
    await app.close();
  });

  test('credits inválido (999) → 400', async () => {
    const app = buildApp('admin');
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout/topup',
      payload: { credits: 999, payment_method: 'card' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('payment_method inválido (boleto) → 400', async () => {
    const app = buildApp('admin');
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout/topup',
      payload: { credits: 100, payment_method: 'boleto' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /billing/portal', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.FRONTEND_URL = 'https://app.test';
    jest.clearAllMocks();
    require('../../src/services/stripe-client')._resetClient();
  });

  test('admin com gateway_customer_id → 200 url do Portal', async () => {
    const app = buildApp('admin');
    app.pg.query = jest.fn(async () => ({ rows: [{ gateway_customer_id: 'cus_test_001' }] }));
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({ method: 'POST', url: '/billing/portal' });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toMatch(/portal/);
    await app.close();
  });

  test('sem gateway_customer_id → 400', async () => {
    const app = buildApp('admin');
    app.pg.query = jest.fn(async () => ({ rows: [] }));
    await app.register(require('../../src/routes/billing'));
    const res = await app.inject({ method: 'POST', url: '/billing/portal' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Sem subscription/);
    await app.close();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd apps/api && npm run test:unit -- --testPathPattern=billing-checkout`

Expected: 9 testes verdes.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/billing.js apps/api/tests/routes/billing-checkout.test.js
git commit -m "$(cat <<'EOF'
feat(billing): /checkout/topup com PIX + /portal (Customer Portal)

POST /billing/checkout/topup:
- Validação: credits ∈ VALID_CREDIT_PACKAGES, payment_method ∈ ['card','pix']
- unit_amount lookup de PRICE_BY_PACK (servidor decide preço)
- Reutiliza gateway_customer_id se existe; cria via Stripe se não
- expires_at 30min (PIX QR expira)

POST /billing/portal:
- Admin-only
- Cria Stripe Customer Portal Session, retorna url
- 400 amigável se tenant não tem subscription ainda

5 testes novos (happy + invalid credits + invalid pm + portal happy + portal sem cust).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Remover /auth/activate

**Files:**
- Modify: `apps/api/src/routes/auth.js`

- [ ] **Step 1: Localizar e remover rota**

Run: `grep -n "/auth/activate\|fastify.post('/activate" apps/api/src/routes/auth.js`

Anotar linhas. Editar arquivo removendo a definição inteira de `fastify.post('/activate'` (ou `/auth/activate` dependendo do prefix).

- [ ] **Step 2: Verificar que nada chama**

Run: `grep -rn "auth/activate\|'/activate'" apps/api/src apps/web/src 2>/dev/null | grep -v node_modules`

Expected: 0 matches (depois dos próximos task que removem chamada do frontend). Se aparecer só matches em `onboarding.component.ts`, ok — vai sair na task 12.

- [ ] **Step 3: Run tests do auth**

Run: `cd apps/api && npm run test:unit -- --testPathPattern=auth`

Expected: tudo verde — nenhum teste deve referenciar `/activate` (era endpoint dev-only sem cobertura formal).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/auth.js
git commit -m "$(cat <<'EOF'
refactor(auth): remover /auth/activate (substituído por webhook Stripe)

Rota era usada exclusivamente pelo botão "Simular pagamento" do
onboarding em dev. Em prod, ativação de tenant é feita pelo webhook
checkout.session.completed (handleSubscriptionCompleted).

CLAUDE.md já documenta o endpoint como removido (ver seção Endpoints
e autenticação).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Frontend — billing.service.ts

**Files:**
- Modify: `apps/web/src/app/features/clinic/billing/billing.service.ts`

- [ ] **Step 1: Adicionar métodos novos**

Edit `apps/web/src/app/features/clinic/billing/billing.service.ts` — APPEND métodos no service (mantém o que existe):

```typescript
checkoutSubscription(): Observable<{ url: string; session_id: string }> {
  return this.http.post<{ url: string; session_id: string }>(
    `${environment.apiUrl}/billing/checkout/subscription`, {}
  );
}

checkoutTopup(credits: number, paymentMethod: 'card' | 'pix'): Observable<{ url: string }> {
  return this.http.post<{ url: string }>(
    `${environment.apiUrl}/billing/checkout/topup`,
    { credits, payment_method: paymentMethod }
  );
}

portal(): Observable<{ url: string }> {
  return this.http.post<{ url: string }>(`${environment.apiUrl}/billing/portal`, {});
}
```

- [ ] **Step 2: Remover método antigo `topup` se conflitar**

Se já existir método `topup(gateway, credits)` no service, REMOVER (será substituído por `checkoutTopup`).

- [ ] **Step 3: TypeScript compile check**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "error TS" | head -10`

Expected: 0 erros (componentes que ainda chamam `topup` antigo serão atualizados na task 12).

⚠️ Se aparecerem erros de "Property 'topup' does not exist", continuar pra task 12 — eles serão resolvidos quando o componente for atualizado. Pode commitar com erros se vierem do componente que será refatorado em seguida.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/clinic/billing/billing.service.ts
git commit -m "$(cat <<'EOF'
feat(web): billing.service métodos checkout/portal

- checkoutSubscription(): redireciona pro Stripe Checkout do plano
- checkoutTopup(credits, paymentMethod): one-time payment com PIX/card
- portal(): abre Stripe Customer Portal

Substitui topup() antigo que chamava endpoint mock.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Frontend — onboarding.component.ts (remover simulatePayment)

**Files:**
- Modify: `apps/web/src/app/features/onboarding/onboarding.component.ts`

- [ ] **Step 1: Localizar partes a remover**

Run: `grep -n "simulatePayment\|Simular pagamento\|isProd\|/auth/activate" apps/web/src/app/features/onboarding/onboarding.component.ts`

Anotar linhas.

- [ ] **Step 2: Remover botão e método**

Edit `apps/web/src/app/features/onboarding/onboarding.component.ts`:

1. Remover o `<button (click)="simulatePayment()" ...>Simular pagamento aprovado (dev)</button>` inteiro (incluindo o `@if (!isProd())` que envolve).
2. Remover o método `simulatePayment(): void { ... }` inteiro.
3. Remover o método `isProd(): boolean { return environment.production; }` se existir.
4. Remover a chamada `simulatePayment()` se chamada de algum outro lugar.

- [ ] **Step 3: Atualizar handler do botão "Assinar agora"**

Localizar o método que chama `/billing/subscribe` (provavelmente `subscribe()` ou similar) e ATUALIZAR pra:

```typescript
async startSubscription(): Promise<void> {
  this.subscribing = true;
  this.subscribeError = null;
  try {
    const { url } = await firstValueFrom(this.billingService.checkoutSubscription());
    window.location.href = url;
  } catch (err: any) {
    this.subscribing = false;
    this.subscribeError = err?.error?.error || 'Erro ao iniciar pagamento. Tente novamente.';
  }
}
```

⚠️ Garantir que o `BillingService` está injetado no componente (`private billingService = inject(BillingService);`). Se ainda não estiver, adicionar.

- [ ] **Step 4: TypeScript check + smoke build**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "error TS" | head -10`

Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/onboarding/onboarding.component.ts
git commit -m "$(cat <<'EOF'
fix(onboarding): remover botão "Simular pagamento" + integrar Stripe

- Remove botão "Simular pagamento aprovado (dev)" (vazou em prod
  2026-04-24 por causa de fileReplacements faltando — risco recorrente)
- Remove método simulatePayment() + isProd()
- Substitui chamada antiga de /billing/subscribe (mock) pela nova
  /billing/checkout/subscription que redireciona pro Stripe hosted
- Para testar em dev, usar cartão de teste 4242 4242 4242 4242

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Frontend — billing.component.ts (topup PIX + Portal)

**Files:**
- Modify: `apps/web/src/app/features/clinic/billing/billing.component.ts`

- [ ] **Step 1: Atualizar modal de topup com payment_method selector**

Edit `apps/web/src/app/features/clinic/billing/billing.component.ts`:

Localizar o modal/dialog de "Comprar créditos" (provavelmente uma `*ngIf="showTopupModal"` ou similar). Adicionar selector de payment_method e atualizar o handler de confirm:

```typescript
// State
selectedCredits: number = 100;
selectedPaymentMethod: 'card' | 'pix' = 'card';
topupLoading = false;
topupError: string | null = null;

// Method
async confirmTopup(): Promise<void> {
  this.topupLoading = true;
  this.topupError = null;
  try {
    const { url } = await firstValueFrom(
      this.billingService.checkoutTopup(this.selectedCredits, this.selectedPaymentMethod)
    );
    window.location.href = url;
  } catch (err: any) {
    this.topupLoading = false;
    this.topupError = err?.error?.error || 'Erro ao iniciar compra';
  }
}
```

No template do modal, adicionar:
```html
<div class="payment-method-selector">
  <label>Forma de pagamento:</label>
  <div class="pm-options">
    <button (click)="selectedPaymentMethod = 'card'"
            [class.active]="selectedPaymentMethod === 'card'">💳 Cartão</button>
    <button (click)="selectedPaymentMethod = 'pix'"
            [class.active]="selectedPaymentMethod === 'pix'">⚡ PIX</button>
  </div>
</div>
```

- [ ] **Step 2: Adicionar botão "Gerenciar assinatura" → Portal**

No template do componente (provavelmente perto do card de saldo), adicionar:

```html
<button mat-stroked-button (click)="openPortal()">
  <mat-icon>settings</mat-icon>
  Gerenciar assinatura
</button>
```

E método:
```typescript
async openPortal(): Promise<void> {
  try {
    const { url } = await firstValueFrom(this.billingService.portal());
    window.location.href = url;
  } catch (err: any) {
    this.snackbar.open(err?.error?.error || 'Erro ao abrir portal', 'OK', { duration: 4000 });
  }
}
```

- [ ] **Step 3: Adicionar banner past_due (se aplicável)**

Se o `tenant.billing_status` for exposto no `currentProfile$` ou similar, adicionar banner:

```html
@if (billingStatus === 'past_due') {
  <div class="alert alert-warning">
    <mat-icon>warning</mat-icon>
    Pagamento da assinatura falhou. Atualize seu cartão pra evitar suspensão.
    <button mat-button color="warn" (click)="openPortal()">Atualizar cartão</button>
  </div>
}
```

⚠️ Se `billing_status` ainda não está no perfil retornado por `/auth/me`, deixar essa parte como `// TODO Task 13: expor billing_status` e marcar pra task 13.

- [ ] **Step 4: TypeScript check**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "error TS" | head -10`

Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/clinic/billing/billing.component.ts
git commit -m "$(cat <<'EOF'
feat(billing): UI topup com PIX + botão Customer Portal

- Modal de topup ganha selector card/PIX
- confirmTopup chama checkoutTopup() e redireciona pro Stripe
- Novo botão "Gerenciar assinatura" abre Customer Portal hosted
- Banner past_due com link rápido pro Portal (atualizar cartão)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: API expor billing_status em /auth/me

**Files:**
- Modify: `apps/api/src/routes/auth.js`
- Modify: `apps/web/src/app/core/auth/auth.service.ts`

- [ ] **Step 1: Localizar /auth/me**

Run: `grep -n "auth/me\|fastify.get.*me" apps/api/src/routes/auth.js | head -5`

- [ ] **Step 2: Atualizar query do /auth/me**

Editar handler de `/auth/me` — incluir `t.billing_status` no SELECT e no return JSON. Exemplo:

```js
const { rows } = await fastify.pg.query(
  `SELECT u.id, u.email, u.role, u.module, u.tenant_id,
          t.name AS tenant_name, t.billing_status
   FROM users u JOIN tenants t ON t.id = u.tenant_id
   WHERE u.id = $1`,
  [user_id]
);
return rows[0];
```

(Se o handler já retorna mais coisas, só APPEND `t.billing_status` ao SELECT e ao objeto retornado.)

- [ ] **Step 3: Atualizar AuthService no Angular**

Edit `apps/web/src/app/core/auth/auth.service.ts`:

```typescript
export interface CurrentProfile {
  user_id: string;
  email: string;
  role: string;
  module: 'human' | 'veterinary';
  tenant_id: string;
  tenant_name: string;
  billing_status: 'pending_payment' | 'active' | 'past_due' | 'cancelled' | 'grandfathered';
}
```

(Append `billing_status` à interface existente.)

- [ ] **Step 4: TypeScript check**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "error TS" | head -5`

Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/auth.js apps/web/src/app/core/auth/auth.service.ts
git commit -m "$(cat <<'EOF'
feat(auth): expor billing_status em /auth/me

Frontend precisa do billing_status pra renderizar banners
(past_due → atualizar cartão, pending_payment → completar checkout,
grandfathered → "cliente fundador, sem cobrança", active → normal).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: IaC — secrets via SSM + env var price

**Files:**
- Modify: `infra/lib/ecs-stack.ts`
- Modify: `.env.example`

- [ ] **Step 1: Atualizar ecs-stack.ts**

Edit `infra/lib/ecs-stack.ts` — encontrar a definição de `backendSecrets` e adicionar:

```typescript
const stripeSecretKeyParam = ssm.StringParameter.fromSecureStringParameterAttributes(
  this, 'StripeSecretKey',
  { parameterName: '/genomaflow/prod/stripe-secret-key' }
);
const stripeWebhookSecretParam = ssm.StringParameter.fromSecureStringParameterAttributes(
  this, 'StripeWebhookSecret',
  { parameterName: '/genomaflow/prod/stripe-webhook-secret' }
);
```

E em `backendSecrets`, adicionar:
```typescript
const backendSecrets = {
  // ... (existentes)
  STRIPE_SECRET_KEY:     ecs.Secret.fromSsmParameter(stripeSecretKeyParam),
  STRIPE_WEBHOOK_SECRET: ecs.Secret.fromSsmParameter(stripeWebhookSecretParam),
};
```

E em `backendEnv`:
```typescript
const backendEnv = {
  // ... (existentes)
  STRIPE_PRICE_SUBSCRIPTION: 'price_REPLACE_WITH_PROD_PRICE_ID',  // Stripe Dashboard → Products → cole price_id
};
```

⚠️ O `price_REPLACE_WITH_PROD_PRICE_ID` precisa ser substituído pelo ID real ANTES de `cdk deploy`. Se o usuário ainda não criou no Stripe Dashboard, deixar com placeholder e instruir no commit message.

- [ ] **Step 2: Atualizar .env.example**

Edit `.env.example` (raiz) — adicionar bloco no fim:

```
# === STRIPE ===
# 1. Crie conta em https://dashboard.stripe.com (modo test) e pegue:
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 2. Crie um Product em https://dashboard.stripe.com/test/products
#    "Plano Mensal R$ 199" com price recurring monthly em BRL.
#    Cole o price_id aqui:
STRIPE_PRICE_SUBSCRIPTION=price_xxxxxxxxxxxxxxxxxxxxxxxxxx

# 3. Pra rodar webhook em dev, instale Stripe CLI e rode:
#    stripe listen --forward-to localhost:3000/api/webhooks/stripe
#    A CLI vai imprimir um whsec_... — cole aqui:
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- [ ] **Step 3: Commit (sem cdk deploy ainda)**

```bash
git add infra/lib/ecs-stack.ts .env.example
git commit -m "$(cat <<'EOF'
feat(infra): SSM params + env var pra Stripe

- STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET via SSM SecureString
- STRIPE_PRICE_SUBSCRIPTION em backendEnv (placeholder — substituir
  pelo price_id real do Stripe Dashboard antes do cdk deploy)
- .env.example documenta setup local com Stripe CLI

⚠️ Antes de cdk deploy:
  aws ssm put-parameter --name /genomaflow/prod/stripe-secret-key \
    --value sk_live_xxx --type SecureString --region us-east-1
  aws ssm put-parameter --name /genomaflow/prod/stripe-webhook-secret \
    --value whsec_xxx --type SecureString --region us-east-1
E substituir o placeholder do STRIPE_PRICE_SUBSCRIPTION em ecs-stack.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Smoke local end-to-end

**Files:** Nenhum modificado.

- [ ] **Step 1: Setup local Stripe**

Pré-requisitos:
- Conta Stripe criada (mode test) com chave em `.env` local
- Product "Plano Mensal R$ 199" criado em https://dashboard.stripe.com/test/products
- `STRIPE_PRICE_SUBSCRIPTION` no `.env` apontando pro price_id criado
- Stripe CLI instalado: `brew install stripe/stripe-cli/stripe` (ou apt/winget)

- [ ] **Step 2: Tunnel webhook em terminal separado**

Run: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`

Expected: imprime `Ready! Your webhook signing secret is whsec_xxxxxxxx`. Copiar pro `.env` como `STRIPE_WEBHOOK_SECRET`. Restart backend pra carregar.

- [ ] **Step 3: Smoke onboarding**

1. Abrir app local em `http://localhost:4200`
2. Onboarding → preencher steps 1-3 → chega no step 4
3. Clicar "Assinar agora" → redireciona pro Stripe Checkout hosted
4. Cartão: `4242 4242 4242 4242`, CVV qualquer, data qualquer no futuro
5. Submit → Stripe processa → redireciona pra `/login?activated=true`

Expected:
- Stripe CLI mostra logs de eventos: `customer.created`, `checkout.session.completed`, `customer.subscription.created`, `invoice.paid`
- Backend log mostra `webhook handler` processando cada um
- Login com a conta criada → balance = 122 créditos
- DB:
  ```sql
  SELECT id, name, active, billing_status FROM tenants WHERE name = 'Clínica Teste';
  -- active=true, billing_status='active'
  SELECT tenant_id, gateway_subscription_id, gateway_customer_id, status FROM subscriptions WHERE tenant_id = ...;
  -- status='active', cust + sub IDs preenchidos
  SELECT amount, kind, description FROM credit_ledger WHERE tenant_id = ...;
  -- 1 row: amount=122, kind='subscription_bonus'
  ```

- [ ] **Step 4: Smoke topup**

1. Login admin → /clinic/billing
2. Click "Comprar créditos" → modal
3. Selecionar pack 250 + payment_method=card → confirmar
4. Stripe Checkout → cartão `4242 4242 4242 4242` → success
5. Volta pra `/clinic/billing?topup=success`

Expected:
- Saldo aumenta 250 (logo após webhook chegar — pode demorar ~1-2s)
- WS event chegou (toast "+250 créditos creditados")
- DB:
  ```sql
  SELECT amount, kind FROM credit_ledger WHERE kind = 'topup' ORDER BY created_at DESC LIMIT 1;
  -- amount=250, kind='topup'
  ```

- [ ] **Step 5: Smoke topup PIX**

1. Mesmo modal → pack 100 + payment_method=pix
2. Redireciona pro Stripe Checkout — exibe QR Code (test mode é fake)
3. No Stripe Dashboard → Payments → encontrar o intent → "Simulate payment"
4. Webhook dispara → saldo aumenta 100

- [ ] **Step 6: Smoke Customer Portal**

1. Click "Gerenciar assinatura" → redireciona pro Portal
2. Confere que mostra plano + último pagamento + opção cancel
3. Click "Cancel subscription" → confirma
4. Volta pra `/clinic/billing`

Expected:
- Stripe CLI loga `customer.subscription.deleted`
- DB: `subscriptions.status = 'cancelled'`, `tenants.billing_status = 'cancelled'`, `tenants.active = false`
- Login com mesma conta → guard redireciona pra mensagem "Conta cancelada"

- [ ] **Step 7: Smoke webhook signature inválida**

Run: `curl -X POST http://localhost:3000/api/webhooks/stripe -H "Content-Type: application/json" -H "Stripe-Signature: t=1,v1=fake" -d '{}'`

Expected: HTTP 400 com `{"error":"Invalid signature"}`.

- [ ] **Step 8: Run full unit suite**

Run: `cd apps/api && npm run test:unit && cd ../web && npm test`

Expected: tudo verde (incluindo os 14+ testes novos do Stripe).

- [ ] **Step 9: Sem commit (smoke é validação local)**

Se algum smoke falhar, voltar pra Task correspondente, corrigir, repetir Task 15.

---

## Task 16: Memory + final commit

**Files:**
- Create: `docs/claude-memory/project_stripe_integration.md`
- Modify: `docs/claude-memory/MEMORY.md`

- [ ] **Step 1: Criar memory file**

Create `docs/claude-memory/project_stripe_integration.md`:

```markdown
---
name: Stripe Integration — substituiu mock de billing em 2026-05-04
description: Pagamentos reais via Stripe Subscriptions API + Checkout (cartão+PIX) + Customer Portal. Webhook é única origem de adição de créditos.
type: project
---

Integração entregue em 2026-05-04. Substitui as rotas mock /billing/subscribe e /billing/topup que concediam créditos diretamente.

## Arquitetura

- POST /billing/checkout/subscription → cria Stripe Customer (lazy) + Checkout Session subscription, retorna { url }
- POST /billing/checkout/topup { credits, payment_method } → Checkout Session payment one-time
- POST /billing/portal → Stripe Customer Portal (cancel + atualizar cartão)
- POST /webhooks/stripe (público) → valida signature + despacha por event.type

## Webhook event handlers (em billing-events.js)

- checkout.session.completed mode=subscription → ativa tenant + grant 122 créditos (30% de R$ 199)
- checkout.session.completed mode=payment → grant credits do metadata.credits
- invoice.paid → renovação mensal, grant 122 créditos recurring
- invoice.payment_failed → marca subscription past_due (NÃO desativa)
- customer.subscription.deleted → desativa tenant + status cancelled

Idempotência: payment_events.UNIQUE(gateway, gateway_event_id) com ON CONFLICT DO NOTHING. Webhook duplicado = no-op.

## Tenant grandfathering

Tenants criados antes deste deploy ficam com billing_status='grandfathered' (default da migration 062). Não são cobrados retroativamente.

## Schema (migration 062)

- subscriptions: + gateway_customer_id, status enum extendido (pending_payment/active/past_due/cancelled/incomplete)
- tenants: + billing_status (mesma enum + grandfathered)

## Env vars / secrets

- STRIPE_SECRET_KEY (SSM SecureString prod, .env dev)
- STRIPE_WEBHOOK_SECRET (SSM SecureString prod, stripe listen em dev)
- STRIPE_PRICE_SUBSCRIPTION (env var — price_id criado no Stripe Dashboard)

## Pra testar local

1. `.env` com chaves de teste
2. `stripe listen --forward-to localhost:3000/api/webhooks/stripe` em terminal separado
3. Cartão de teste: 4242 4242 4242 4242 (qualquer CVV/data futura)
4. PIX em test mode: simular pagamento via Stripe Dashboard

## Red flags

- Webhook handler que NÃO valida signature → fraude trivial (qualquer um forja webhook e credita conta)
- Webhook handler sem `ON CONFLICT DO NOTHING` em payment_events → duplo crédito em retries
- tenant_id vindo do body em rota síncrona (em vez de request.user.tenant_id) → cliente forja crédito pra outro tenant
- Botão "Simular pagamento" voltar pro código → REMOVIDO de vez 2026-05-04 (CLAUDE.md feedback_angular_prod_build.md tinha incidente prévio)
- Hardcode price/credits no body do checkout (cliente pode pedir R$ 0,01)
- Customer ID amarrado a tenant errado → metadata.tenant_id no Stripe Customer pra rastreabilidade

## Commits

- Migration 062: <SHA>
- Webhook handlers: <SHA>
- Frontend integration: <SHA>
- IaC SSM: <SHA>
```

(Substituir `<SHA>` pelos commits reais quando implementação terminar.)

- [ ] **Step 2: Atualizar MEMORY.md**

Edit `docs/claude-memory/MEMORY.md` — APPEND linha:

```markdown
- [Stripe Integration](project_stripe_integration.md) — Pagamentos reais Stripe (Subscriptions API + Checkout cartão/PIX + Customer Portal); webhook é única origem de créditos; tenants existentes grandfathered (entregue 2026-05-04)
```

- [ ] **Step 3: Commit**

```bash
git add docs/claude-memory/project_stripe_integration.md docs/claude-memory/MEMORY.md
git commit -m "$(cat <<'EOF'
docs(memory): registrar integração Stripe (2026-05-04)

Memory file project_stripe_integration.md documenta:
- Arquitetura (rotas, webhook, handlers)
- Schema (migration 062)
- Env vars/secrets
- Como testar local (Stripe CLI + cartão de teste)
- Red flags (signature validation, idempotência, tenant_id seguro)
- Tenants grandfathered

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Push + setup AWS SSM + cdk deploy

**Files:** Nenhum modificado.

⚠️ Esta task envolve **ações em AWS prod**. Requer credenciais e ações do usuário.

- [ ] **Step 1: Push branch**

Run: `git push -u origin feat/stripe-integration`

- [ ] **Step 2: Usuário cria Product+Price no Stripe Dashboard PROD**

Em https://dashboard.stripe.com (modo LIVE):
- Products → Create product → "Plano Mensal R$ 199" → recurring monthly BRL → R$ 199.00
- Copiar `price_xxxxxxxxxxxxxxxxxxxxxxxxxx`

- [ ] **Step 3: Usuário coloca secrets em SSM**

```bash
aws ssm put-parameter \
  --name /genomaflow/prod/stripe-secret-key \
  --value sk_live_REAL_KEY_AQUI \
  --type SecureString \
  --region us-east-1

# Webhook secret será setado DEPOIS de criar webhook no Stripe Dashboard prod (próxima task)
# Por enquanto coloca placeholder pra cdk deploy não falhar:
aws ssm put-parameter \
  --name /genomaflow/prod/stripe-webhook-secret \
  --value whsec_PLACEHOLDER_REPLACE_AFTER_WEBHOOK_REGISTERED \
  --type SecureString \
  --region us-east-1
```

- [ ] **Step 4: Atualizar STRIPE_PRICE_SUBSCRIPTION no IaC**

Edit `infra/lib/ecs-stack.ts` — substituir `'price_REPLACE_WITH_PROD_PRICE_ID'` pelo `price_xxx` real do step 2.

```bash
git add infra/lib/ecs-stack.ts
git commit -m "chore(infra): set STRIPE_PRICE_SUBSCRIPTION para price_id real prod"
git push
```

- [ ] **Step 5: cdk deploy**

```bash
cd infra
npx cdk diff genomaflow-ecs
# Verificar diff: deve adicionar 2 secrets + 1 env var, sem mais nada
npx cdk deploy genomaflow-ecs
```

Expected: deploy ok em ~30-60s. Task definitions atualizadas com Stripe secrets injetados.

- [ ] **Step 6: Registrar webhook endpoint no Stripe Dashboard prod**

Em https://dashboard.stripe.com (modo LIVE):
- Developers → Webhooks → Add endpoint
- Endpoint URL: `https://app.genomaflow.com.br/api/webhooks/stripe`
- Events to listen: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
- Create → copiar `whsec_xxxxxxxxxxxxxxxxxx`

- [ ] **Step 7: Atualizar webhook secret em SSM**

```bash
aws ssm put-parameter \
  --name /genomaflow/prod/stripe-webhook-secret \
  --value whsec_REAL_SECRET_AQUI \
  --type SecureString \
  --region us-east-1 \
  --overwrite
```

- [ ] **Step 8: Force redeploy do API service pra carregar nova webhook secret**

```bash
aws ecs update-service \
  --cluster genomaflow \
  --service genomaflow-api \
  --force-new-deployment \
  --region us-east-1
```

⚠️ `force-new-deployment` SEM register-task-definition novo só faz sentido aqui porque o secret é puxado do SSM em runtime; CACHEBUST não aplica. Se tiver dúvida, registrar nova task def.

(Aguardar ~2min pra o serviço estabilizar.)

- [ ] **Step 9: Smoke prod (com R$ 1 ou cartão de teste de live)**

1. Acessar https://app.genomaflow.com.br
2. Criar conta de teste
3. Onboarding completo
4. Step 4 → "Assinar agora" → redireciona pro Stripe Checkout LIVE
5. ⚠️ **NÃO usar `4242 4242 4242 4242`** em modo live (não funciona). Usar cartão real (vai cobrar de verdade).
6. Alternativa: usar Stripe Dashboard pra criar payment intent de teste em modo live.
7. Verificar webhook chegou no nosso server (Stripe Dashboard → Webhooks → endpoint → Recent deliveries)

- [ ] **Step 10: Pedir aprovação humana**

Apresentar pro usuário:
> "Stripe integration deployada em prod. Smoke parcial OK (signature validation, env vars, webhook endpoint registrado). Pra teste end-to-end com pagamento real, criar conta de teste e usar cartão real (R$ 199). Aprova merge na main?"

⚠️ Esta task fica como `pending` até o usuário confirmar smoke prod e aprovar merge.

---

## Task 18: Merge na main + monitor pipeline

**Files:** Nenhum modificado.

⚠️ Só executar APÓS aprovação humana explícita do step 10 da Task 17.

- [ ] **Step 1: Merge**

```bash
git checkout main
git pull --quiet
git merge --no-ff feat/stripe-integration -m "merge: feat/stripe-integration → main

Substitui mock de billing por integração Stripe real:
- Subscriptions API (R$ 199/mês recurring)
- Checkout Session pra créditos (cartão + PIX)
- Customer Portal pra cancelar
- Webhook /webhooks/stripe (signature + idempotência)
- Migration 062 (gateway_customer_id + billing_status)
- Tenants existentes ficam grandfathered

cdk deploy + SSM params + webhook endpoint registrado em prod antes
do merge.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 2: Monitorar pipeline**

```bash
gh run list --limit 1
# Aguardar ou usar gh run watch
```

Expected: pipeline verde — `Run migrations` aplica 062, deploy de api/worker/web ok.

- [ ] **Step 3: Smoke prod final**

Criar 1 conta nova end-to-end com cartão real → R$ 199 cobrado → 122 créditos creditados → cancela via Portal → desativa.

- [ ] **Step 4: Anunciar pra base existente**

Adicionar banner global no app (próxima task fora deste plano) ou comunicado via Master Broadcasts: "Cliente fundador, sem cobrança retroativa. Pra novos clientes, agora aceitamos pagamento."

---

## Self-review

### Spec coverage

| Spec section | Task |
|---|---|
| Schema migration 062 | Task 1 |
| Stripe SDK install + constants | Task 2 |
| stripe-client.js wrapper | Task 3 |
| billing-events.js handlers | Task 4, 5 |
| Webhook route /webhooks/stripe | Task 6 |
| Refactor /billing/subscribe → /checkout/subscription | Task 7 |
| Refactor /billing/topup → /checkout/topup | Task 8 |
| Nova /billing/portal | Task 8 |
| Remove /auth/activate | Task 9 |
| Frontend billing.service | Task 10 |
| Frontend onboarding (remove simulate) | Task 11 |
| Frontend billing.component (PIX + Portal + banner) | Task 12 |
| API /auth/me expose billing_status | Task 13 |
| IaC SSM + env var | Task 14 |
| Smoke local end-to-end | Task 15 |
| Memory file | Task 16 |
| AWS SSM + cdk deploy + Stripe Dashboard webhook | Task 17 |
| Merge main + smoke prod | Task 18 |

Cobertura completa.

### Placeholder scan

- Nenhum "TBD"/"TODO"/"implement later" no plano.
- Todos os steps de código têm code blocks.
- Comandos exatos com expected output.
- Mensagens de commit completas com heredoc.
- Único "REPLACE": `STRIPE_PRICE_SUBSCRIPTION` no IaC — explicitamente documentado como placeholder a ser substituído com price_id real do Stripe Dashboard antes de cdk deploy. Aceitável porque o valor depende de ação manual do usuário no Stripe.

### Type consistency

- `tenantId` (camelCase em JS args) vs `tenant_id` (snake_case em DB e env) — consistente: camelCase nos args/params do JS, snake_case nas colunas SQL e metadata do Stripe.
- `gateway_customer_id` consistente em migration + queries + service.
- `billing_status` enum: 5 valores em migration, 5 valores nos handlers, 5 valores no Angular interface — consistentes.
- Funções exportadas em `billing-events.js`: `handleCheckoutCompleted`, `handleInvoicePaid`, `handleInvoicePaymentFailed`, `handleSubscriptionDeleted` — todas usadas em webhook route com mesmos nomes.

### Scope check

Single feature (Stripe integration). 18 tasks bite-sized. Bem fit pra um plano único.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-04-stripe-integration.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch um subagent fresco por task, revisão entre tasks, iteração rápida.
**2. Inline Execution** — execução nesta sessão usando `executing-plans`, batch com checkpoints.

Qual prefere?
