# GenomaFlow — Sistema de Billing: Mensalidade + Créditos Pré-pagos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementar um sistema de billing híbrido — mensalidade recorrente + créditos pré-pagos para consumo de agentes de IA — com suporte a Stripe e Mercado Pago, saldo isolado por tenant, bloqueio gracioso ao esgotar créditos e alertas visuais.

**Architecture:** Ledger interno append-only (`credit_ledger`) é a fonte de verdade do saldo. Stripe e Mercado Pago são trilhos de pagamento — confirmam via webhook, o sistema credita. O worker debita 1 crédito por agente executado com sucesso. Especialidades configuradas no onboarding determinam quais agentes rodam, tornando o custo por exame previsível.

**Tech Stack:** PostgreSQL 15 (ledger + idempotência), Fastify (rotas + webhooks), BullMQ worker (débito por agente), Angular 17+ (billing dashboard + alertas), Stripe SDK, Mercado Pago SDK, WebSocket (notificações em tempo real via Redis pub/sub existente).

---

## 1. Banco de Dados

### 1.1 `tenant_specialties` — agentes configurados por tenant

```sql
CREATE TABLE tenant_specialties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL
    CHECK (agent_type IN ('metabolic','cardiovascular','hematology',
                          'small_animals','equine','bovine',
                          'therapeutic','nutrition')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, agent_type)
);

ALTER TABLE tenant_specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_specialties FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_specialties
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Mínimo 1 especialidade por tenant. Editável via Configurações após onboarding.

**Especialidades válidas por módulo:**

| `module=human` | `module=veterinary` | Ambos os módulos |
|---|---|---|
| `metabolic` | `small_animals` | `therapeutic` |
| `cardiovascular` | `equine` | `nutrition` |
| `hematology` | `bovine` | |

`therapeutic` e `nutrition` são agentes de síntese — rodam na Fase 2, após os agentes de especialidade, e consomem 1 crédito cada.

### 1.2 `subscriptions` — assinatura ativa por tenant

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  gateway TEXT NOT NULL CHECK (gateway IN ('stripe','mercadopago')),
  gateway_subscription_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','past_due','cancelled')),
  onboarding_bonus_pct INTEGER NOT NULL DEFAULT 30,
  recurring_credits INTEGER NOT NULL DEFAULT 0,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- `onboarding_bonus_pct`: percentual da 1ª mensalidade convertido em créditos (default 30%)
- `recurring_credits`: créditos adicionados automaticamente a cada renovação (pode ser 0 se o tenant não configurou recorrência de créditos)

### 1.3 `credit_ledger` — ledger append-only

```sql
CREATE TABLE credit_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL, -- positivo = crédito, negativo = débito
  kind TEXT NOT NULL
    CHECK (kind IN (
      'subscription_bonus',  -- bônus da 1ª assinatura
      'topup',               -- recarga avulsa
      'topup_recurring',     -- recarga recorrente automática
      'agent_usage',         -- débito por agente executado
      'adjustment'           -- correção manual pelo suporte
    )),
  description TEXT,
  exam_id UUID REFERENCES exams(id),   -- preenchido em agent_usage
  payment_event_id UUID,               -- preenchido em créditos vindos de pagamento
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_ledger
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- View de saldo atual
CREATE VIEW tenant_credit_balance AS
  SELECT tenant_id, COALESCE(SUM(amount), 0) AS balance
  FROM credit_ledger
  GROUP BY tenant_id;
```

### 1.4 `payment_events` — idempotência de webhooks

```sql
CREATE TABLE payment_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gateway TEXT NOT NULL CHECK (gateway IN ('stripe','mercadopago')),
  gateway_event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
    -- 'subscription_created' | 'subscription_renewed' | 'topup_paid'
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  amount_brl NUMERIC(10,2) NOT NULL,
  credits_granted INTEGER NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gateway, gateway_event_id) -- chave de idempotência
);
```

O `UNIQUE (gateway, gateway_event_id)` garante que o mesmo evento processado duas vezes (retry do gateway) não credita duas vezes.

---

## 2. Backend

### 2.1 Rotas de billing

Todas as rotas de billing exigem JWT válido. Operações de escrita e visualização completa exigem `role=admin`.

```
POST /billing/subscribe          → cria assinatura no gateway + registra em subscriptions
POST /billing/topup              → cria cobrança avulsa ou recorrente no gateway
GET  /billing/balance            → saldo atual do tenant
GET  /billing/history?page=&limit= → histórico paginado do credit_ledger
GET  /billing/specialties        → especialidades configuradas do tenant
PUT  /billing/specialties        → atualiza especialidades (array de agent_type)
```

**`POST /billing/subscribe` — body:**
```json
{
  "gateway": "stripe" | "mercadopago",
  "plan": "starter" | "pro",
  "recurring_credits": 50
}
```
Cria a assinatura no gateway e registra em `subscriptions`. O crédito de bônus só é concedido via webhook `subscription_created` — nunca na chamada direta.

**`POST /billing/topup` — body:**
```json
{
  "gateway": "stripe" | "mercadopago",
  "credits": 100,
  "recurring": false
}
```
Cria cobrança avulsa (ou recorrente separada da mensalidade) no gateway. Créditos só são concedidos após confirmação via webhook `topup_paid`.

### 2.2 Webhooks

Endpoints públicos (sem JWT), validados por assinatura do gateway.

```
POST /webhooks/stripe
POST /webhooks/mercadopago
```

**Fluxo de processamento — idêntico para ambos:**

1. Valida assinatura do payload
   - Stripe: header `stripe-signature` + `stripe.webhooks.constructEvent()`
   - Mercado Pago: header `x-signature` + chave secreta
2. Extrai `gateway_event_id` e verifica `payment_events` — se já existe, retorna `200 OK` (idempotência)
3. Identifica `kind` e calcula `credits_granted`:

| `kind` | `credits_granted` |
|---|---|
| `subscription_created` | `floor(amount_brl * onboarding_bonus_pct / 100)` convertido em créditos pelo preço do plano |
| `subscription_renewed` | `subscription.recurring_credits` |
| `topup_paid` | créditos do pacote comprado |

4. Em uma transação:
   - INSERT em `payment_events`
   - INSERT em `credit_ledger` com `amount = credits_granted`, `kind` correspondente, `payment_event_id`
5. Publica `billing:topup:{tenantId}` no Redis
6. Retorna `200 OK`

### 2.3 Lógica de alerta de 20%

Executada após cada débito no worker:

```js
async function checkLowCreditAlert(tenantId, pg) {
  const { balance } = await pg.query(
    'SELECT balance FROM tenant_credit_balance WHERE tenant_id = $1', [tenantId]
  );
  const { granted } = await pg.query(`
    SELECT COALESCE(SUM(amount), 0) AS granted
    FROM credit_ledger
    WHERE tenant_id = $1
      AND amount > 0
      AND created_at >= NOW() - INTERVAL '30 days'
  `, [tenantId]);

  if (granted > 0 && balance / granted <= 0.20) {
    redis.publish(`billing:alert:${tenantId}`, JSON.stringify({ balance, granted }));
  }
  if (balance <= 0) {
    redis.publish(`billing:exhausted:${tenantId}`, JSON.stringify({ balance }));
  }
}
```

---

## 3. Worker — integração com billing

### 3.1 Roteamento por especialidades

O processor busca especialidades antes de iniciar o job:

```js
const rows = await pg.query(
  'SELECT agent_type FROM tenant_specialties WHERE tenant_id = $1', [tenantId]
);
const agents = rows.map(r => AGENT_MAP[r.agent_type]);
// AGENT_MAP: { metabolic: runMetabolicAgent, cardiovascular: ..., small_animals: ..., etc. }
```

### 3.2 Verificação de saldo antes de processar

```js
const { balance } = await getBalance(tenantId, pg);
if (balance < agents.length) {
  await markExamError(examId, 'Saldo de créditos insuficiente');
  redis.publish(`billing:exhausted:${tenantId}`, {});
  return;
}
```

### 3.3 Débito atômico por agente

```js
for (const agent of agents) {
  const result = await agent(ctx);
  await persistResult(result, pg);
  await pg.query(
    `INSERT INTO credit_ledger (tenant_id, amount, kind, exam_id, description)
     VALUES ($1, -1, 'agent_usage', $2, $3)`,
    [tenantId, examId, `Agent: ${agent.type}`]
  );
  await checkLowCreditAlert(tenantId, pg);
}
```

### 3.4 Job em andamento quando saldo zera

- O job que já começou **completa normalmente** — saldo pode ficar negativo por no máximo `agents.length - 1` créditos durante a execução
- Próximo job da fila: verificação no passo 3.2 bloqueia o processamento
- O exame bloqueado fica com `status='pending'` na fila — é reprocessado automaticamente quando créditos são recarregados (o admin aciona manualmente ou via webhook de `topup_paid`)

---

## 4. Frontend

### 4.1 Onboarding — seleção de especialidades

Nova etapa após seleção do módulo (etapa 2 do onboarding):

- Checkboxes das especialidades disponíveis para o módulo selecionado
- Mínimo 1 obrigatório, máximo: todas disponíveis
- Exibe estimativa: "Com 2 especialidades, cada exame consome 2 créditos"
- Editável depois em `/clinic/settings` (admin)

### 4.2 Onboarding — assinatura

Etapa 3 do onboarding:

- Seleção de plano (cards com preço e features)
- Seleção de gateway: "Cartão de crédito (Stripe)" ou "PIX / Boleto (Mercado Pago)"
- Toggle "Adicionar recarga automática de créditos" com campo de quantidade
- Banner: "Na sua primeira assinatura, 30% do valor é convertido em créditos de bônus"

### 4.3 Tela de Billing (`/clinic/billing` — admin only)

Três blocos:

**Saldo atual:**
- Número de créditos disponíveis
- Estimativa: "~X exames com Y agentes"
- Barra de progresso visual do saldo
- Botão "Recarregar Créditos"

**Assinatura ativa:**
- Plano + status + próxima renovação
- Créditos recorrentes configurados
- Botão "Gerenciar" (redireciona para portal do gateway)

**Histórico:**
- Tabela paginada: data, descrição, tipo (crédito/débito), quantidade, saldo resultante
- Filtro por período

### 4.4 Modal de recarga

Aberto pelo botão "Recarregar Créditos":

1. Seleção de pacote (ex: 50, 100, 200 créditos com preço por crédito decrescente)
2. Toggle "Tornar recorrente (mensal)"
3. Seleção de gateway: Stripe ou Mercado Pago
4. Redireciona para checkout do gateway selecionado

### 4.5 Alertas globais (admin)

**Banner amarelo — saldo ≤ 20%** (persistente, dismissível por sessão):
```
⚠ Atenção: seu saldo está chegando ao fim (X créditos restantes).
Recarregue para não interromper as análises. [Recarregar agora]
```

**Banner vermelho — saldo zerado** (persistente, não dismissível):
```
🔴 Análises pausadas. Recarregue seus créditos para retomar o processamento.
[Recarregar agora]
```

Ambos recebidos via WebSocket no canal `billing:alert:{tenantId}` e `billing:exhausted:{tenantId}`.

**Para lab_tech:** upload continua funcionando normalmente. O exame entra na fila com `status='pending'`. O bloqueio é só no processamento — a clínica não perde o exame.

---

## 5. Fora de Escopo (MVP)

- Portal de autoatendimento do gateway (Stripe Customer Portal / MP) — link externo por ora
- NFS-e automática — roadmap
- Planos com features diferenciadas além de créditos — roadmap
- Dashboard de custo por agente/especialidade para o GenomaFlow (interno) — roadmap
- Reprocessamento automático de exames bloqueados ao recarregar — roadmap (MVP: manual)
