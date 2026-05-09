-- 084_error_log_details.sql
-- Adiciona campos de detalhe pra master conseguir investigar erros
-- (stack trace, user-agent, body parcial). Tudo nullable — não afeta inserts existentes.

ALTER TABLE error_log ADD COLUMN IF NOT EXISTS stack_trace TEXT;
ALTER TABLE error_log ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE error_log ADD COLUMN IF NOT EXISTS request_body TEXT;

-- Índice para filtro do dashboard master (5xx + null)
CREATE INDEX IF NOT EXISTS idx_error_log_severity_recent
  ON error_log (created_at DESC)
  WHERE status_code IS NULL OR status_code >= 500;
