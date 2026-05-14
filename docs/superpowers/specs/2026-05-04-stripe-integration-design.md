# Stripe Integration — Design Spec

**Data:** 2026-05-04
**Branch alvo:** `feat/stripe-integration`
**Spec antiga relacionada:** `2026-04-17-billing-credits-design.md` (arquitetura geral de billing — schema, rotas mock, dashboard). Esta spec **substitui** os trechos sobre integração de gateway daquela.

## Contexto e objetivo

O usuário habilitou conta no Stripe e quer que **todo fluxo de cobrança em produção** passe pelo Stripe — tanto a assinatura mensal de R$ 199 (no onboarding de novo cliente) quanto a compra de pacotes de créditos avulsos (no dashboard de billing). Hoje (2026-05-04) o sistema tem schema + rotas + UI prontos, mas todas as cobranças são **mock**: `/billing/subscribe` e `/billing/topup` concedem créditos diretamente sem cobrar nada. Stripe SDK não está instalado.

**Objetivo:** trocar o caminho mock por integração real com Stripe (Subscriptions API + Checkout Session) e remover de vez o botão de simulação que vazou pra produção em incidentes anteriores (ver `feedback_angular_prod_build.md`).

**Não-objetivo:**
- Mercado Pago (oculto até decidir suportar)
- Refund automático (manual via suporte por enquanto)
- Boleto (UX confuso por demora de confirmação)
- Cobrar retroativo de tenants existentes (grandfathered)
- Multi-currency (só BRL)

## Decisões já tomadas

| # | Decisão | Trade-off aceito |
|---|---|---|
| 1 | Stripe only; Mercado Pago oculto da UI | Schema dual-rail mantido pra futuro; menos código agora |
| 2 | Stripe Subscriptions API (recurring nativo) | Customer Portal + Smart Retry vêm prontos; mais eventos pra tratar |
| 3 | Cartão obrigatório pra subscription, cartão+PIX pra créditos avulsos | Sem boleto; PIX suportado em compras one-time |
| 4 | Botão "Simular pagamento" REMOVIDO de vez | Dev usa cartão de teste do Stripe (`4242 4242 4242 4242`) |
| 5 | Self-service cancel via Stripe Customer Portal, sem refund automático | Refund vira processo manual de suporte |
| 6 | Server-created Checkout Session (hosted UI), não Stripe Elements client-side | Sem PCI compliance burden; menos controle de UX |
| 7 | Tenant criado em `pending_payment` antes do checkout; ativado por webhook | Risco de tenants em limbo (mitigação via banner "reativar conta") |
| 8 | Stripe Customer criado lazy (no momento do primeiro Checkout) | Sem customers órfãos no Stripe |
| 9 | Tenants existentes: grandfathered (sem subscription Stripe, mas mantêm acesso) | Sem cobrança retroativa |

## Arquitetura

```
┌─ FRONTEND (Angular) ─────────────────────────────────────────────────┐
│ OnboardingComponent (step 4) / BillingComponent                      │
│   POST /billing/checkout/subscription { tenant_id }                  │
│   POST /billing/checkout/topup { credits, payment_method }           │
│   POST /billing/portal (admin)                                        │
│   ↓ recebe { url } → window.location.href = url                      │
└──────────────────────────────────────────────────────────────────────┘
                  ↓
┌─ BACKEND API (Fastify) ──────────────────────────────────────────────┐
│ apps/api/src/routes/billing.js (modificado)                          │
│   /billing/checkout/subscription   admin-only, gera Checkout Session │
│   /billing/checkout/topup          admin-only, gera Checkout Session │
│   /billing/portal                  admin-only, gera Portal Session   │
│                                                                       │
│ apps/api/src/routes/webhooks/stripe.js (NOVO)                        │
│   POST /webhooks/stripe            público, valida signature,        │
│                                    despacha por event.type           │
│                                                                       │
│ apps/api/src/services/stripe-client.js (NOVO)                        │
│   wrapper do Stripe SDK + helpers (createCustomer, createSession,    │
│   createPortalSession, constructEvent)                                │
│                                                                       │
│ apps/api/src/services/billing-events.js (NOVO)                       │
│   handlers por event.type, todos idempotentes via payment_events     │
└──────────────────────────────────────────────────────────────────────┘
                  ↓
┌─ STRIPE (hosted) ────────────────────────────────────────────────────┐
│ Checkout Session (subscription | payment mode)                       │
│ Customer Portal (atualizar cartão / cancelar)                        │
│ Webhooks → POST /api/webhooks/stripe                                 │
└──────────────────────────────────────────────────────────────────────┘
```

**Princípio de segurança core:** créditos só são adicionados via webhook (após pagamento confirmado), nunca pela rota síncrona de checkout. Isso elimina o caminho duplo de hoje (rota mock concede + webhook concederia de novo) e protege contra fraude.

## Schema (migration 062)

```sql
-- 062_stripe_customer_ids.sql
ALTER TABLE subscriptions
  ADD COLUMN gateway_customer_id TEXT;

CREATE INDEX idx_subscriptions_gateway_customer_id
  ON subscriptions(gateway_customer_id)
  WHERE gateway_customer_id IS NOT NULL;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('pending_payment','active','past_due','cancelled','incomplete'));

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS billing_status TEXT
  CHECK (billing_status IN ('pending_payment','active','past_due','cancelled','grandfathered'))
  DEFAULT 'grandfathered';

UPDATE tenants SET billing_status = 'grandfathered' WHERE billing_status IS NULL;
```

**Tabelas reutilizadas (já existem em migration 016):**
- `subscriptions` — uma por tenant (UNIQUE tenant_id), agora com `gateway_customer_id` populado
- `payment_events` — append-only, dedup via UNIQUE(gateway, gateway_event_id), guarda raw payload pra auditoria
- `credit_ledger` — append-only, kinds `subscription_bonus`, `topup`, `topup_recurring` já existem em migration 030

## Fluxos

### Fluxo 1 — Onboarding novo cliente

```
Step 1-3 (sem mudança):
  /auth/check-email → /auth/register
  registra tenant com active=false, billing_status='pending_payment'
  envia email de verificação

Step 4 (Pagamento):
  FE: POST /billing/checkout/subscription { tenant_id }
  BE:
    1. Auth gate: request.user.tenant_id === body.tenant_id
    2. Lazy create Stripe Customer:
         await stripe.customers.create({
           email: tenant.email,
           name:  tenant.clinic_name,
           metadata: { tenant_id }
         })
       UPDATE subscriptions SET gateway_customer_id = customer.id
    3. Cria Checkout Session:
         stripe.checkout.sessions.create({
           mode: 'subscription',
           customer: customer.id,
           line_items: [{ price: STRIPE_PRICE_SUBSCRIPTION, quantity: 1 }],
           payment_method_types: ['card'],
           client_reference_id: tenant_id,
           metadata: { tenant_id, plan: 'starter' },
           subscription_data: { metadata: { tenant_id } },
           success_url: `${FRONTEND_URL}/login?activated=true`,
           cancel_url:  `${FRONTEND_URL}/onboarding?cancelled=true&tenant_id=${tenant_id}`,
         })
    4. Returns { url }
  FE: window.location.href = url

Stripe checkout: cliente paga (cartão obrigatório)

Webhook checkout.session.completed (mode=subscription):
    1. Valida assinatura via STRIPE_WEBHOOK_SECRET
    2. INSERT payment_events ON CONFLICT DO NOTHING
    3. tenant_id = session.client_reference_id
    4. UPDATE tenants SET active=true, billing_status='active'
    5. INSERT/UPDATE subscriptions:
         gateway='stripe', gateway_subscription_id, plan='starter',
         status='active', current_period_end (de session.subscription)
    6. Calcula créditos: 30% de 199 = 122 (arredondado)
    7. INSERT credit_ledger (+122, kind='subscription_bonus',
         description='30% de bônus do onboarding R$ 199',
         payment_event_id=<id>)
    8. fastify.redis.publish('billing:activated:'+tenant_id, ...)

Redirect → /login?activated=true → user loga → banner verde
```

### Fluxo 2 — Renovação mensal (sem ação do user)

```
Stripe (todo mês na current_period_end):
  cobra cartão salvo
  ├─ ok:    invoice.paid
  ├─ falha: invoice.payment_failed (1ª, 2ª, 3ª tentativa)
  └─ 3 falhas: customer.subscription.deleted

Webhook invoice.paid:
  1. INSERT payment_events
  2. tenant_id = subscription.metadata.tenant_id
  3. UPDATE subscriptions SET current_period_end, status='active'
  4. INSERT credit_ledger (+122, kind='topup_recurring',
       description='Renovação mensal Stripe — <período>')
  5. Redis publish 'billing:renewed:'+tenant_id

Webhook invoice.payment_failed:
  1. INSERT payment_events
  2. UPDATE subscriptions SET status='past_due'
  3. UPDATE tenants SET billing_status='past_due'
  4. Redis publish 'billing:payment_failed:'+tenant_id
  → frontend mostra banner amarelo com link pro Customer Portal

Webhook customer.subscription.deleted:
  1. INSERT payment_events
  2. UPDATE subscriptions SET status='cancelled', cancelled_at=NOW()
  3. UPDATE tenants SET active=false, billing_status='cancelled'
  4. Redis publish 'billing:cancelled:'+tenant_id
```

### Fluxo 3 — Compra de créditos avulsos

```
FE: BillingComponent → modal "Comprar créditos"
    cliente escolhe pack (100/250/500) + payment_method ('card'|'pix')
    POST /billing/checkout/topup { credits, payment_method }
BE:
  1. Validação: credits ∈ VALID_CREDIT_PACKAGES (constante existente)
  2. Validação: payment_method ∈ ['card','pix']
  3. Lookup ou criar gateway_customer_id
  4. Cria Checkout Session:
       mode: 'payment',
       customer: customer.id,
       line_items: [{ price_data: {
         currency: 'brl',
         product_data: { name: `Créditos GenomaFlow (${credits})` },
         unit_amount: PRICE_BY_PACK[credits]  // {100: 4990, 250: 10990, 500: 19990}
       }, quantity: 1 }],
       payment_method_types: payment_method === 'pix' ? ['pix'] : ['card', 'pix'],
       client_reference_id: tenant_id,
       metadata: { tenant_id, credits, kind: 'topup' },
       expires_at: Math.floor(Date.now()/1000) + 1800,  // 30min (PIX expira)
       success_url: `${FRONTEND_URL}/clinic/billing?topup=success`,
       cancel_url:  `${FRONTEND_URL}/clinic/billing?topup=cancelled`,
  5. Returns { url }
FE: window.location.href = url
Stripe: cliente paga (card instant ou PIX QR)

Webhook checkout.session.completed (mode=payment):
  1. INSERT payment_events
  2. credits = parseInt(session.metadata.credits, 10)
  3. INSERT credit_ledger (+credits, kind='topup',
       description='Compra de créditos — Stripe',
       payment_event_id=<id>)
  4. Redis publish 'billing:credited:'+tenant_id

FE: WS event chega → toast "+250 créditos creditados"
    Atualiza saldo no header em tempo real
```

### Fluxo 4 — Customer Portal (cancelamento + atualização de cartão)

```
FE: BillingComponent → botão "Gerenciar assinatura"
    POST /billing/portal
BE:
  1. Auth gate: admin-only
  2. Recupera gateway_customer_id da subscription
  3. Cria Portal Session:
       stripe.billingPortal.sessions.create({
         customer: gateway_customer_id,
         return_url: `${FRONTEND_URL}/clinic/billing`,
       })
  4. Returns { url }
FE: window.location.href = url

Stripe Portal: cliente vê seu plano, pode atualizar cartão / cancelar
  → cancelamento dispara customer.subscription.deleted (Fluxo 2)
  → atualização de cartão é silenciosa (próxima invoice.paid usa novo cartão)
```

## Mudanças de código

### Novos arquivos

```
apps/api/src/services/stripe-client.js         (~80 LOC)
apps/api/src/services/billing-events.js        (~200 LOC)
apps/api/src/routes/webhooks/stripe.js         (~80 LOC)
apps/api/src/db/migrations/062_stripe_customer_ids.sql  (~25 LOC)
apps/api/tests/routes/webhooks-stripe.test.js  (~250 LOC)
```

### Arquivos modificados

```
apps/api/package.json                          + dep: stripe ^14.x
apps/api/src/routes/billing.js                 -100 / +250 LOC
                                                rota /subscribe → /checkout/subscription
                                                rota /topup    → /checkout/topup
                                                NOVA /portal
                                                REMOVE grant síncrono de créditos
apps/api/src/app.js                            + register webhooks/stripe (raw body parser)
apps/api/src/constants.js                      + PRICE_BY_PACK { 100: 4990, 250: 10990, 500: 19990, 1000: 37990 }
                                                EXTEND VALID_CREDIT_PACKAGES = [100, 250, 500, 1000]
                                                (alinha com 4 packs anunciados na landing — Enterprise faltava)
apps/api/src/routes/auth.js                    REMOVE /auth/activate (substituído por webhook)
apps/web/src/app/features/onboarding/onboarding.component.ts
                                                REMOVE botão "Simular pagamento"
                                                REMOVE simulatePayment()
                                                checkout passa por window.location.href
apps/web/src/app/features/clinic/billing/billing.service.ts
                                                topup passa { credits, payment_method }
                                                NOVA portalUrl()
apps/web/src/app/features/clinic/billing/billing.component.ts
                                                modal de topup escolhe payment_method
                                                NOVO botão "Gerenciar assinatura" → portal
                                                Banner amarelo "past_due" + link portal
infra/lib/ecs-stack.ts                         + 2 secrets via SSM (Stripe key + webhook secret)
                                                + 1 env var STRIPE_PRICE_SUBSCRIPTION
.github/workflows/deploy.yml                   sem mudança (migration roda automaticamente)
.env.example                                   + STRIPE_* placeholders + comentário
```

## Env vars e secrets

| Variável | Tipo | Onde | Origem |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | secret | API task def via SSM | Dashboard Stripe → API keys → Secret key |
| `STRIPE_WEBHOOK_SECRET` | secret | API task def via SSM | Dashboard Stripe → Webhooks → endpoint signing secret |
| `STRIPE_PRICE_SUBSCRIPTION` | env var | API task def | Dashboard Stripe → Products → criar "Plano Mensal R$ 199" → price_id |
| `FRONTEND_URL` | env var (já existe) | API task def | success_url / cancel_url base |

**Modo dev:** `.env.example` ganha placeholders + instrução pra usar Stripe CLI:
```
# === STRIPE ===
# Pegue em https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxx
# Crie um Product em https://dashboard.stripe.com/test/products
# (R$ 199.00 / mês recurring) e cole o price_id aqui:
STRIPE_PRICE_SUBSCRIPTION=price_xxxxxxxxxxxxxx
# Em dev local, rode: stripe listen --forward-to localhost:3000/api/webhooks/stripe
# A CLI vai imprimir o whsec_ — cole aqui:
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxx
```

**Setup prod (manual antes do deploy):**
```bash
aws ssm put-parameter --name /genomaflow/prod/stripe-secret-key \
  --value sk_live_xxxx --type SecureString --region us-east-1
aws ssm put-parameter --name /genomaflow/prod/stripe-webhook-secret \
  --value whsec_xxxx --type SecureString --region us-east-1
# Price ID via env var no CDK (não precisa SecureString — não é secret)
```

## Segurança

| Risco | Mitigação |
|---|---|
| Webhook forjado credita conta | `stripe.webhooks.constructEvent(body, sig, SECRET)` valida assinatura. Sem isso, retorna 400. Fastify usa `addContentTypeParser` pra preservar raw body só nessa rota. |
| Webhook duplicado credita 2x | `INSERT INTO payment_events ON CONFLICT DO NOTHING` (UNIQUE em `gateway, gateway_event_id`). Idempotência total. |
| Cliente manipula `tenant_id` no body do checkout | `tenant_id` SEMPRE de `request.user.tenant_id` (JWT verificado), NUNCA do body. Body só carrega `credits` + `payment_method` (validados via whitelist). |
| Cliente pede checkout de R$ 0,01 | `credits ∈ VALID_CREDIT_PACKAGES` e `unit_amount` lookup de `PRICE_BY_PACK` (servidor decide preço). |
| Customer ID amarrado ao tenant errado | `subscriptions.gateway_customer_id` é UNIQUE por tenant_id; ao criar Customer no Stripe, metadata.tenant_id pra rastreabilidade. |
| Spam de checkout | Rate limit 30/min/tenant em `/billing/checkout/*` (mesmo padrão de `/auth/login`). |
| Webhook sem auth gate | Endpoint `/webhooks/stripe` é público (Stripe chama de fora do VPC). Validação é via signature, não via JWT. |
| Audit gap | Toda mudança em `subscriptions`, `tenants.billing_status`, `credit_ledger` passa por `withTenant(MASTER_TENANT_ID, fn, { userId: null, channel: 'system' })` no webhook. Audit trigger registra `actor_user_id=NULL` + `actor_channel='system'`, distinguindo de UI/copilot. |

## Testing

### Unit (CI gate — apps/api/npm run test:unit)

Novos testes em `tests/routes/webhooks-stripe.test.js`:

- ✅ Webhook com signature inválida → 400
- ✅ Webhook com signature válida + event_id duplicado → 200 mas sem efeito (idempotência)
- ✅ `checkout.session.completed` mode=subscription → grant 122 créditos + ativa tenant
- ✅ `checkout.session.completed` mode=payment com metadata.credits=250 → grant 250 créditos
- ✅ `checkout.session.completed` sem metadata.tenant_id → 400 (defesa)
- ✅ `invoice.paid` → grant créditos recorrentes + atualiza current_period_end
- ✅ `invoice.payment_failed` → marca subscription past_due, NÃO desativa tenant
- ✅ `customer.subscription.deleted` → desativa tenant + status=cancelled
- ✅ event.type desconhecido → 200 (no-op silencioso, padrão Stripe)

Novos testes em `tests/routes/billing-checkout.test.js`:
- ✅ POST /billing/checkout/topup com credits inválido → 400
- ✅ POST /billing/checkout/topup com payment_method inválido → 400
- ✅ POST /billing/checkout/subscription role!=admin → 403
- ✅ POST /billing/portal sem gateway_customer_id → 400 com mensagem amigável

Mock do Stripe SDK via `jest.mock('stripe')` retornando objetos fake com os métodos esperados.

### Manual (smoke local + dev)

```bash
# Terminal 1 — backend
cd apps/api && npm run dev

# Terminal 2 — Stripe CLI (faz tunnel webhook → localhost)
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Copia o whsec_ que ela imprime → cola em .env como STRIPE_WEBHOOK_SECRET

# Terminal 3 — frontend
cd apps/web && npm start

# No browser:
# 1. Onboarding completo até step 4 com cartão de teste 4242 4242 4242 4242
# 2. Conferir: tenant ativado, 122 créditos no ledger, invoice no Stripe Dashboard
# 3. Topup com PIX: Stripe gera QR fake em modo test
# 4. Customer Portal: clicar "Gerenciar assinatura"
```

## Rollout

| Fase | Ação | Quem |
|---|---|---|
| 0 | Criar Product "Plano Mensal R$ 199" no Stripe Dashboard (modo test E live) | usuário |
| 0 | Copiar price_id (test) e settar em `.env` local | dev |
| 1 | Implementar backend (rotas, webhook, services, migration) + tests | dev |
| 2 | Smoke local com Stripe CLI + cartão de teste | dev |
| 3 | `aws ssm put-parameter` pros 2 secrets de prod | usuário |
| 4 | `cd infra && npx cdk diff genomaflow-ecs && npx cdk deploy genomaflow-ecs` | usuário |
| 5 | Frontend: trocar rotas + remover botão simular | dev |
| 6 | Merge na main → CI/CD deploy + roda migration 062 | dev |
| 7 | Stripe Dashboard prod: registrar webhook endpoint `https://app.genomaflow.com.br/api/webhooks/stripe` + copiar `whsec_*` pro SSM | usuário |
| 8 | Smoke em prod com cartão real (R$ 1 charge + refund manual) | usuário |
| 9 | Anunciar pra base existente (banner): "Agora aceitamos pagamentos. Tenants atuais ficam grandfathered." | dev |

## Out of scope

- Mercado Pago (deferido)
- Boleto (UX confuso pelo delay)
- Refund automático (manual via suporte)
- Cobrança retroativa de tenants existentes
- Multi-currency
- Cupons / códigos promocionais
- Trial period (cliente paga já no signup)
- Plano anual com desconto (deferido)
- Faturamento por NFe (deferido — Stripe entrega invoice mas não NFe brasileira)

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Tenants em "limbo" pending_payment se cliente desiste no checkout | Tela de login detecta `tenant.billing_status='pending_payment'` e mostra banner amarelo "Conta criada mas pagamento pendente — completar agora" com botão que reabre checkout via mesmo endpoint (Stripe deduplica via customer.id já existente) |
| Webhook nunca chega (rede flutuante) | Stripe tem retry policy de 3 dias; fallback é evento aparece no Dashboard pra retry manual |
| Migration 062 falha em prod (lifecycle de constraints) | Migration testada local primeiro; ALTER TABLE com `IF NOT EXISTS` defensivo |
| Stripe muda preço do plano e não atualizamos `STRIPE_PRICE_SUBSCRIPTION` | Stripe permite múltiplos prices ativos no mesmo Product — versão antiga continua válida pra subscriptions ativas; deploy de nova versão usa novo price_id |
| Cliente compra crédito via PIX, paga, mas a sessão expirou (>30min) | Stripe não cobra após expiração; cliente precisa abrir nova sessão. Frontend mostra "Sessão expirou, gere novo PIX" no cancel_url |
| Audit log não captura mudança via webhook | Webhook handler usa `withTenant(MASTER_TENANT_ID, fn, { userId: null, channel: 'system' })` — trigger registra ação como `actor_channel='system'` (`actor_user_id` NULL é aceito por design pra eventos de sistema) |
| Tenants grandfathered ficam confusos sobre se devem ou não pagar | Banner único "Você é cliente fundador, sem cobrança" no dashboard de billing pra `billing_status='grandfathered'` |

## Critérios de aceite

1. ✅ `apps/api/src/routes/billing.js` não concede créditos sincronicamente em nenhuma rota
2. ✅ Webhook `/webhooks/stripe` valida signature e é idempotente (event duplicado = no-op)
3. ✅ Botão "Simular pagamento" REMOVIDO do `OnboardingComponent`; `simulatePayment()` removido; `/auth/activate` removido
4. ✅ Onboarding completo com cartão de teste do Stripe credita 122 créditos via webhook
5. ✅ Topup com cartão de teste credita os créditos do pack via webhook
6. ✅ Topup com PIX (em test mode) gera QR e simula pagamento via Stripe Dashboard
7. ✅ Customer Portal abre via `/billing/portal` e permite cancelar
8. ✅ `customer.subscription.deleted` desativa tenant
9. ✅ Audit log mostra `actor_channel='system'` nas mudanças via webhook
10. ✅ Migration 062 aplicada em dev e prod sem erro
11. ✅ Tests CI passam (15+ testes novos)
12. ✅ Lighthouse onboarding ≥ 90 (sem regressão)

## Próximos passos

1. Revisar este spec
2. Após aprovação, invocar `superpowers:writing-plans` pra detalhar o plano de implementação task-by-task
3. Implementar via subagent-driven-development
4. Smoke local com Stripe CLI antes de pedir aprovação humana pra merge

---

## Amendments post-implementação (2026-05-05)

Os pontos abaixo foram acordados após o smoke prod inicial revelar problemas de fluxo/UX que não estavam no spec original. Implementados direto na `main`.

### A1. Option E — defer DB writes até pagamento confirmado

**Problema:** spec previa `/auth/register` criando tenant `pending_payment` antes do checkout. No smoke prod o usuário desistiu várias vezes do Stripe e ficaram tenants órfãos no banco. Bloqueava retry com mesmo email ("Email já cadastrado") e poluía audit log.

**Decisão:** rota nova `POST /onboarding/checkout` (público) que **não grava nada** no banco — só valida, hasha senha e cria Stripe Customer + Checkout Session com toda a info na metadata da Session (`origin`, `email`, `clinic_name`, `password_hash`, `module`, `specialties`).

**Webhook:** `handleCheckoutCompleted` detecta `metadata.origin === 'onboarding'` e dispara `handleOnboardingSubscriptionCompleted` que cria `tenants` + `users` + `tenant_specialties` + `subscriptions` + `credit_ledger` + `payment_events` em uma transação `withTenant(newTenantId)`. Idempotência via `payment_events UNIQUE(gateway, gateway_event_id)` (race vencedora).

**Considerações:**
- Email é **auto-verificado** no webhook (paid signup = ID via Stripe + cartão real)
- Stripe metadata limits OK (50 keys / 40 char keys / 500 char values; bcrypt = 60 chars)
- Cleanup: `/auth/register` continua existindo para a rota legada `/register` (que não passa por pagamento), mas auto-login (token + jti + Redis session) foi **removido** — não era usado por mais ninguém
- Frontend: `goToPayment()` agora é single-shot pra `/onboarding/checkout`; `nextStep3()` virou só transição de UI

**Commit:** `11be1b85`

### A2. Bônus de 122 créditos só no 1º mês

**Problema:** spec original concedia 122 créditos `topup_recurring` em todo `invoice.paid` mensal. PO revisou: faz mais sentido o bônus ser apenas no 1º mês (onboarding) — renovações mensais não precisam de bônus extra; assinante que precisar compra topup avulso.

**Decisão:** `handleInvoicePaid` agora só atualiza `current_period_end` + `billing_status='active'` + grava `payment_events` (audit). **NÃO** insere mais em `credit_ledger`.

**Cleanup:** constante `RECURRING_BONUS_CREDITS` removida (não usada em lugar nenhum).

**Test atualizado:** `tests/routes/webhooks-stripe.test.js` — assertion mudou de `{credits: 122}` pra `{handled: true, idempotent: false}` + `expect(... 'INSERT INTO credit_ledger' ...).toBe(false)`.

**Commit:** `00fe3405`

### A3. Schema fixes descobertos no smoke prod 2026-05-04

Migrations 063 e 064 (já aplicadas em prod manualmente):
- 063: `subscriptions` + `updated_at` / `cancelled_at` + `gateway_subscription_id` NULLABLE (registro `pending_payment` ainda não tem subscription_id)
- 064: `subscriptions` UNIQUE(`tenant_id`) (código usava ON CONFLICT) + `payment_events.amount_brl` e `credits_granted` NULLABLE (handlers de failed/cancelled não têm valor associado)
