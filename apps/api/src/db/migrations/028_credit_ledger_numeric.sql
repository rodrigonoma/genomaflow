DROP VIEW IF EXISTS tenant_credit_balance;

ALTER TABLE credit_ledger ALTER COLUMN amount TYPE NUMERIC(10,4) USING amount::NUMERIC(10,4);

CREATE OR REPLACE VIEW tenant_credit_balance AS
  SELECT tenant_id, COALESCE(SUM(amount), 0) AS balance
  FROM credit_ledger
  GROUP BY tenant_id;
