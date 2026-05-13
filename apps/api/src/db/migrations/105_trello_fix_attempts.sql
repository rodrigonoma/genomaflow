-- 105_trello_fix_attempts.sql
-- Audit trail do Trello QA Agent. 1 row por triagem ou tentativa de fix.
-- attempt=0 é triagem; attempt=1,2,... são tentativas de fix.
-- Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §5

CREATE TABLE IF NOT EXISTS trello_fix_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id         TEXT NOT NULL,
  card_short_id   TEXT NOT NULL,
  attempt         INT NOT NULL,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN
                    ('triage','fix','retry','detalhe','cancel')),
  triggered_by    TEXT NOT NULL,
  hint            TEXT,
  status          TEXT NOT NULL CHECK (status IN
                    ('queued','running','pr_opened','tests_failed','llm_failed',
                     'cancelled','limit_reached','completed')),
  pr_url          TEXT,
  branch_name     TEXT,
  test_summary    JSONB,
  llm_tokens_input   INT,
  llm_tokens_output  INT,
  llm_cost_usd    NUMERIC(10, 4),
  processing_ms   INT,
  error_code      TEXT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trello_attempts_card
  ON trello_fix_attempts (card_id, attempt DESC);

CREATE INDEX IF NOT EXISTS idx_trello_attempts_status
  ON trello_fix_attempts (status, created_at)
  WHERE status IN ('queued', 'running');
