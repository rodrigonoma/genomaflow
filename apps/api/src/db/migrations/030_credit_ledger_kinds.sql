ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_kind_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_kind_check
  CHECK (kind = ANY (ARRAY[
    'subscription_bonus','topup','topup_recurring','agent_usage','adjustment',
    'purchase','chat_query'
  ]));
