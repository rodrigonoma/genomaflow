-- Migration 017: token tracking in clinical_results

ALTER TABLE clinical_results
  ADD COLUMN IF NOT EXISTS input_tokens  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens INT NOT NULL DEFAULT 0;

CREATE OR REPLACE VIEW tenant_token_usage AS
  SELECT
    cr.tenant_id,
    DATE_TRUNC('month', cr.created_at) AS month,
    cr.agent_type,
    COUNT(*)                                AS executions,
    SUM(cr.input_tokens)                    AS total_input_tokens,
    SUM(cr.output_tokens)                   AS total_output_tokens,
    SUM(cr.input_tokens + cr.output_tokens) AS total_tokens
  FROM clinical_results cr
  GROUP BY cr.tenant_id, DATE_TRUNC('month', cr.created_at), cr.agent_type;
