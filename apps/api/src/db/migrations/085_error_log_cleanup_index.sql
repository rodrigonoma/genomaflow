-- 085_error_log_cleanup_index.sql
-- Índice full-table em created_at pra suportar cleanup eficiente do worker.
-- O índice 084 (idx_error_log_severity_recent) é parcial — não cobre DELETE de
-- entradas não-críticas antigas. Sem este, o tick diário do scheduler faria
-- seq scan na tabela inteira a cada execução.

CREATE INDEX IF NOT EXISTS idx_error_log_created_at
  ON error_log (created_at);
