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
