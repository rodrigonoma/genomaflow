-- 063_subscriptions_audit_columns.sql
-- Adiciona updated_at + cancelled_at em subscriptions (faltavam no schema 016
-- mas código de webhook handlers e routes do Stripe assumem que existem).
-- Também torna gateway_subscription_id NULLABLE — o registro inicial em
-- /checkout/subscription (status='pending_payment') ainda não tem o sub_id;
-- o webhook checkout.session.completed preenche depois.
-- Incidente 2026-05-04: 500 "column updated_at does not exist" no smoke prod.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE subscriptions
  ALTER COLUMN gateway_subscription_id DROP NOT NULL;
