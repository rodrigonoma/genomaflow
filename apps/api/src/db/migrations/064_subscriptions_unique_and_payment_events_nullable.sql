-- 064 — corrige 3 bugs de schema descobertos no smoke prod 2026-05-04:
--
-- 1. subscriptions falta UNIQUE(tenant_id) — código usa ON CONFLICT (tenant_id)
--    DO UPDATE em /checkout/subscription e em handleSubscriptionCompleted.
--    Sem unique constraint o INSERT falha 42P10.
--
-- 2. payment_events.amount_brl é NOT NULL — handlers de invoice.payment_failed
--    e customer.subscription.deleted não têm valor BRL associado, passam null.
--    Schema bombava com NOT NULL violation no INSERT.
--
-- 3. payment_events.credits_granted é NOT NULL — mesmo motivo de #2.

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_tenant_id_unique UNIQUE (tenant_id);

ALTER TABLE payment_events
  ALTER COLUMN amount_brl DROP NOT NULL;

ALTER TABLE payment_events
  ALTER COLUMN credits_granted DROP NOT NULL;
