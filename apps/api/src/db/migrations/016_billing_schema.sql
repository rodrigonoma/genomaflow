-- Migration 016: billing schema

CREATE TABLE IF NOT EXISTS tenant_specialties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL
    CHECK (agent_type IN ('metabolic','cardiovascular','hematology',
                          'small_animals','equine','bovine',
                          'therapeutic','nutrition')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, agent_type)
);

CREATE TABLE IF NOT EXISTS subscriptions (
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

CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('subscription_bonus','topup','topup_recurring','agent_usage','adjustment')),
  description TEXT,
  exam_id UUID REFERENCES exams(id),
  payment_event_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gateway TEXT NOT NULL CHECK (gateway IN ('stripe','mercadopago')),
  gateway_event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  amount_brl NUMERIC(10,2) NOT NULL,
  credits_granted INTEGER NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gateway, gateway_event_id)
);

CREATE OR REPLACE VIEW tenant_credit_balance AS
  SELECT tenant_id, COALESCE(SUM(amount), 0) AS balance
  FROM credit_ledger
  GROUP BY tenant_id;
