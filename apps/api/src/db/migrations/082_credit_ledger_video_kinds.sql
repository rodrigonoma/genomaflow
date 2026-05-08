-- 082_credit_ledger_video_kinds.sql
-- Adiciona kinds de vídeo ao CHECK constraint do credit_ledger.
--
-- A migration 081 comentou incorretamente que "kind é TEXT livre" —
-- o CHECK constraint existe desde a migration 078. Resultado: POST /end
-- falhava com constraint violation ao tentar inserir video_simple/video_complete.

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_kind_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_kind_check
  CHECK (kind = ANY (ARRAY[
    'subscription_bonus','topup','topup_recurring','agent_usage','adjustment',
    'purchase','chat_query',
    'ocr_usage',
    'ai_suggestion',
    'encounter_copilot',
    'video_simple',               -- consulta vídeo simples (-2 créditos)
    'video_complete',             -- consulta vídeo completa (-6 créditos)
    'video_transcription_refund'  -- estorno em falha de transcrição (+4 créditos)
  ]));
